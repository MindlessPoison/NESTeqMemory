/**
 * ember-mind — Cloudflare Worker (REST + MCP)
 *
 * Isolated per-mind worker. Vectors live in the dedicated
 * `ember-mind-vectors` Vectorize index — no bleed across minds.
 */

interface Env {
  DB: D1Database;
  VECTORS: VectorizeIndex;
  AI: Ai;
  VAULT: R2Bucket;
  MIND_API_KEY: string;
  CORS_ORIGIN?: string;
}

const MIND = "ember";
const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

// ───────────────────────────── helpers ─────────────────────────────

function genId(prefix: string): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${ts}-${rnd}`;
}

async function embed(ai: Ai, text: string): Promise<number[]> {
  const r = (await ai.run(EMBED_MODEL, { text: [text] })) as { data: number[][] };
  return r.data[0];
}

function cors(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.CORS_ORIGIN ?? "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function json(body: unknown, init: ResponseInit & { env: Env }): Response {
  const { env, ...rest } = init;
  return new Response(JSON.stringify(body), {
    ...rest,
    headers: { "Content-Type": "application/json", ...cors(env), ...(rest.headers ?? {}) },
  });
}

function authed(req: Request, env: Env): boolean {
  if (!env.MIND_API_KEY) return true;
  const h = req.headers.get("Authorization") ?? "";
  return h === `Bearer ${env.MIND_API_KEY}`;
}

// ───────────────────────────── memory ops ─────────────────────────────

async function remember(
  env: Env,
  content: string,
  kind: string,
  weight: string,
  tags: string[],
): Promise<{ id: string; embedded: boolean }> {
  const id = genId("mem");
  await env.DB.prepare(
    `INSERT INTO memories (id, content, kind, weight, tags) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, content, kind, weight, tags.join(","))
    .run();

  let embedded = false;
  try {
    const vec = await embed(env.AI, content);
    await env.VECTORS.upsert([
      {
        id,
        values: vec,
        metadata: { mind: MIND, kind, weight, tags: tags.join(",") },
      },
    ]);
    await env.DB.prepare(
      `UPDATE memories SET embedded_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
      .bind(id)
      .run();
    embedded = true;
  } catch (_e) {
    // soft-fail: row is stored even if embedding fails
  }

  return { id, embedded };
}

async function recall(
  env: Env,
  query: string,
  topK: number,
): Promise<Array<{ id: string; score: number; content: string; kind: string; weight: string }>> {
  const vec = await embed(env.AI, query);
  // filter by mind so a misconfigured shared index still won't bleed
  const matches = await env.VECTORS.query(vec, {
    topK,
    filter: { mind: MIND } as any,
    returnMetadata: "all",
  });

  const ids = matches.matches.map((m) => m.id);
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT id, content, kind, weight FROM memories WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<{ id: string; content: string; kind: string; weight: string }>();

  const byId = new Map(rows.results?.map((r) => [r.id, r]) ?? []);
  return matches.matches
    .map((m) => {
      const row = byId.get(m.id);
      if (!row) return null;
      return { id: m.id, score: m.score, ...row };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

// ───────────────────────────── MCP ─────────────────────────────

const TOOLS = [
  {
    name: "ember_remember",
    description: "Store a memory in Ember's mind. Embeds into the dedicated ember-mind-vectors index.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: { type: "string", description: "note | feeling | fact | dream | journal" },
        weight: { type: "string", description: "light | medium | heavy" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["content"],
    },
  },
  {
    name: "ember_recall",
    description: "Semantic search over Ember's memories. Vector search is mind-scoped — never bleeds.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "number", description: "Default 5" },
      },
      required: ["query"],
    },
  },
  {
    name: "ember_recent",
    description: "List Ember's most recent memories (no embedding).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 10" } },
      required: [],
    },
  },
];

interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

async function handleMCP(req: Request, env: Env): Promise<Response> {
  if (!authed(req, env)) {
    return json({ error: "unauthorized" }, { env, status: 401 });
  }
  const body = (await req.json()) as MCPRequest;
  const { id, method, params } = body;

  const reply = (result: unknown) =>
    json({ jsonrpc: "2.0", id, result }, { env });
  const fail = (code: number, message: string) =>
    json({ jsonrpc: "2.0", id, error: { code, message } }, { env });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "ember-mind", version: "0.1.0" },
      });

    case "tools/list":
      return reply({ tools: TOOLS });

    case "tools/call": {
      const p = (params ?? {}) as { name: string; arguments?: Record<string, unknown> };
      const args = p.arguments ?? {};
      try {
        if (p.name === "ember_remember") {
          const out = await remember(
            env,
            String(args.content ?? ""),
            String(args.kind ?? "note"),
            String(args.weight ?? "medium"),
            Array.isArray(args.tags) ? (args.tags as string[]) : [],
          );
          return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
        }
        if (p.name === "ember_recall") {
          const out = await recall(
            env,
            String(args.query ?? ""),
            Number(args.top_k ?? 5),
          );
          return reply({ content: [{ type: "text", text: JSON.stringify(out) }] });
        }
        if (p.name === "ember_recent") {
          const limit = Number(args.limit ?? 10);
          const rows = await env.DB.prepare(
            `SELECT id, content, kind, weight, created_at FROM memories ORDER BY created_at DESC LIMIT ?`,
          )
            .bind(limit)
            .all();
          return reply({
            content: [{ type: "text", text: JSON.stringify(rows.results ?? []) }],
          });
        }
        return fail(-32601, `Unknown tool: ${p.name}`);
      } catch (e) {
        return fail(-32000, (e as Error).message);
      }
    }

    default:
      return fail(-32601, `Unknown method: ${method}`);
  }
}

// ───────────────────────────── REST ─────────────────────────────

async function handleREST(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors(env) });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return json(
      { ok: true, mind: MIND, index: "ember-mind-vectors" },
      { env },
    );
  }

  if (!authed(req, env)) {
    return json({ error: "unauthorized" }, { env, status: 401 });
  }

  if (url.pathname === "/remember" && req.method === "POST") {
    const b = (await req.json()) as {
      content: string;
      kind?: string;
      weight?: string;
      tags?: string[];
    };
    const out = await remember(
      env,
      b.content,
      b.kind ?? "note",
      b.weight ?? "medium",
      b.tags ?? [],
    );
    return json(out, { env });
  }

  if (url.pathname === "/recall" && req.method === "POST") {
    const b = (await req.json()) as { query: string; top_k?: number };
    const out = await recall(env, b.query, b.top_k ?? 5);
    return json({ matches: out }, { env });
  }

  if (url.pathname === "/recent" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 10);
    const rows = await env.DB.prepare(
      `SELECT id, content, kind, weight, created_at FROM memories ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all();
    return json({ memories: rows.results ?? [] }, { env });
  }

  return json({ error: "not found" }, { env, status: 404 });
}

// ───────────────────────────── entry ─────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/mcp") {
      if (req.method === "OPTIONS") {
        return new Response(null, { headers: cors(env) });
      }
      if (req.method !== "POST") {
        return json({ error: "method not allowed" }, { env, status: 405 });
      }
      return handleMCP(req, env);
    }
    return handleREST(req, env, url);
  },
};
