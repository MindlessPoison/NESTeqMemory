# Ember Mind

Ember's mind worker. Cloudflare Worker (REST + MCP) backed by:

- **D1**: `ember-mind` — Ember's own database
- **Vectorize**: `ember-mind-vectors` — Ember's own index. Not shared. **No bleed.**
- **Workers AI**: `@cf/baai/bge-base-en-v1.5` (768-dim embeddings)
- **R2**: `ember-mind-vault` — long-form storage

Vectors are also tagged with `metadata.mind = "ember"` and queries pass
`filter: { mind: "ember" }` as a belt-and-braces guard, so even if the index
were ever pointed at a shared one by mistake, recall would still be scoped.

## Endpoints

| Path       | Method | Purpose                         |
|------------|--------|---------------------------------|
| `/health`  | GET    | Liveness + which index is bound |
| `/mcp`     | POST   | JSON-RPC MCP server             |
| `/remember`| POST   | `{ content, kind?, weight?, tags? }` |
| `/recall`  | POST   | `{ query, top_k? }`             |
| `/recent`  | GET    | `?limit=10`                     |

All non-`/health` calls require `Authorization: Bearer $MIND_API_KEY`.

## MCP tools

- `ember_remember` — store + embed
- `ember_recall`   — semantic search (mind-scoped)
- `ember_recent`   — recent memories, no embedding

## Setup

```bash
# from workers/ember-mind
npm install
cp wrangler.toml.example wrangler.toml   # paste D1 id

npm run db:create        # create the D1
npm run db:migrate       # apply schema
npm run vectorize:create # create dedicated 768-dim cosine index
wrangler secret put MIND_API_KEY
npm run deploy
```
