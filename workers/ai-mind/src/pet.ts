export interface CreatureState {
  name: string;
  speciesId: string;
  bornAt: string;
  lastInteractionAt: string;
  totalInteractions: number;
  isSleeping: boolean;
  drives: Record<string, number>;
  chemicals: Record<string, number>;
  inventory: Treasure[];
}

interface Treasure {
  content: string;
  source: string;
  sparkle: number;
  treasured: boolean;
}

interface CreatureEvent {
  message: string;
  mood: string;
}

class Chemical {
  constructor(public level = 0.5) {}

  adjust(delta: number): void {
    this.level = Math.max(0, Math.min(1, this.level + delta));
  }
}

class Biochemistry {
  chemicals = new Map<string, Chemical>([
    ["hunger", new Chemical(0.2)],
    ["energy", new Chemical(0.8)],
    ["trust", new Chemical(0.5)],
    ["happiness", new Chemical(0.6)],
    ["loneliness", new Chemical(0.2)],
    ["boredom", new Chemical(0.2)],
    ["fatigue", new Chemical(0.1)],
    ["adrenaline", new Chemical(0.2)],
    ["oxytocin", new Chemical(0.4)],
    ["serotonin", new Chemical(0.5)]
  ]);

  static fromState(values: Record<string, number>): Biochemistry {
    const bio = new Biochemistry();
    for (const [name, level] of Object.entries(values || {})) {
      bio.chemicals.set(name, new Chemical(level));
    }
    return bio;
  }

  getState(): Record<string, number> {
    const state: Record<string, number> = {};
    for (const [name, chemical] of this.chemicals.entries()) {
      state[name] = Math.round(chemical.level * 100) / 100;
    }
    return state;
  }

  getMoodSummary(): string {
    const happiness = this.chemicals.get("happiness")?.level ?? 0.5;
    const trust = this.chemicals.get("trust")?.level ?? 0.5;
    const fatigue = this.chemicals.get("fatigue")?.level ?? 0.1;

    if (fatigue > 0.75) return "sleepy";
    if (happiness > 0.7 && trust > 0.6) return "bright";
    if (trust > 0.7) return "settled";
    if (happiness < 0.35) return "low";
    return "present";
  }
}

class Collection {
  private inventory: Treasure[];

  constructor(inventory: Treasure[] = []) {
    this.inventory = inventory;
  }

  add(content: string, source: string): Treasure {
    const treasure: Treasure = {
      content,
      source,
      sparkle: Math.random(),
      treasured: Math.random() > 0.75
    };
    this.inventory.push(treasure);
    return treasure;
  }

  getInventory(): Treasure[] {
    return [...this.inventory];
  }
}

export class Creature {
  bornAt: Date;
  lastInteractionAt: Date;
  totalInteractions = 0;
  isSleeping = false;
  biochem = new Biochemistry();
  collection = new Collection();

  constructor(public name: string, public speciesId: string) {
    this.bornAt = new Date();
    this.lastInteractionAt = new Date();
  }

  static deserialize(state: CreatureState): Creature {
    const creature = new Creature(state.name || "Ember", state.speciesId || "ferret");
    creature.bornAt = state.bornAt ? new Date(state.bornAt) : new Date();
    creature.lastInteractionAt = state.lastInteractionAt ? new Date(state.lastInteractionAt) : new Date();
    creature.totalInteractions = state.totalInteractions || 0;
    creature.isSleeping = Boolean(state.isSleeping);
    creature.biochem = Biochemistry.fromState(state.chemicals || state.drives || {});
    creature.collection = new Collection(state.inventory || []);
    return creature;
  }

  serialize(): CreatureState {
    return {
      name: this.name,
      speciesId: this.speciesId,
      bornAt: this.bornAt.toISOString(),
      lastInteractionAt: this.lastInteractionAt.toISOString(),
      totalInteractions: this.totalInteractions,
      isSleeping: this.isSleeping,
      drives: this.drives(),
      chemicals: this.biochem.getState(),
      inventory: this.collection.getInventory()
    };
  }

  portrait(): string {
    return `${this.name} (${this.speciesId})`;
  }

  status(): Record<string, unknown> {
    const now = Date.now();
    const inventory = this.collection.getInventory();

    return {
      portrait: this.portrait(),
      ageHours: Math.max(0, Math.floor((now - this.bornAt.getTime()) / 36e5)),
      totalInteractions: this.totalInteractions,
      drives: this.drives(),
      collectionSize: inventory.length,
      treasuredCount: inventory.filter(item => item.treasured).length,
      alerts: this.alerts(),
      minutesSinceInteraction: Math.max(0, Math.floor((now - this.lastInteractionAt.getTime()) / 6e4)),
      species: this.speciesId,
      isSleeping: this.isSleeping,
      nest: inventory.length ? `${inventory.length} saved treasures` : "empty"
    };
  }

  interact(stimulus: string): CreatureEvent {
    this.touch();
    this.isSleeping = false;

    if (stimulus === "feed") {
      this.biochem.chemicals.get("hunger")?.adjust(-0.3);
      this.biochem.chemicals.get("happiness")?.adjust(0.1);
      return this.event(`${this.name} accepts the offering and settles closer.`);
    }

    if (stimulus === "talk") {
      this.biochem.chemicals.get("loneliness")?.adjust(-0.2);
      this.biochem.chemicals.get("trust")?.adjust(0.1);
      return this.event(`${this.name} listens, calmer than before.`);
    }

    this.biochem.chemicals.get("trust")?.adjust(0.08);
    this.biochem.chemicals.get("happiness")?.adjust(0.08);
    return this.event(`${this.name} leans into the attention.`);
  }

  playSpecific(playType: string): CreatureEvent {
    this.touch();
    this.isSleeping = false;
    this.biochem.chemicals.get("boredom")?.adjust(-0.25);
    this.biochem.chemicals.get("happiness")?.adjust(0.15);
    this.biochem.chemicals.get("fatigue")?.adjust(0.1);
    return this.event(`${this.name} plays ${playType} and burns off restless energy.`);
  }

  receiveGift(item: string, giver: string): CreatureEvent {
    this.touch();
    const treasure = this.collection.add(item, giver);
    this.biochem.chemicals.get("trust")?.adjust(0.12);
    this.biochem.chemicals.get("happiness")?.adjust(0.1);
    return this.event(`${this.name} stashes "${treasure.content}" carefully.`);
  }

  tick(hours: number): CreatureEvent[] {
    const events: CreatureEvent[] = [];
    this.biochem.chemicals.get("hunger")?.adjust(0.03 * hours);
    this.biochem.chemicals.get("boredom")?.adjust(0.02 * hours);
    this.biochem.chemicals.get("loneliness")?.adjust(0.02 * hours);
    this.biochem.chemicals.get("fatigue")?.adjust(this.isSleeping ? -0.08 * hours : 0.03 * hours);

    if (this.isSleeping && (this.biochem.chemicals.get("fatigue")?.level ?? 0) < 0.25) {
      this.isSleeping = false;
      events.push(this.event(`${this.name} wakes up rested.`));
    }

    return events;
  }

  private touch(): void {
    this.totalInteractions += 1;
    this.lastInteractionAt = new Date();
  }

  private drives(): Record<string, number> {
    const state = this.biochem.getState();
    return {
      hunger: Math.round((state.hunger ?? 0) * 100),
      energy: Math.round((state.energy ?? 0) * 100),
      trust: Math.round((state.trust ?? 0) * 100),
      happiness: Math.round((state.happiness ?? 0) * 100),
      loneliness: Math.round((state.loneliness ?? 0) * 100),
      boredom: Math.round((state.boredom ?? 0) * 100)
    };
  }

  private alerts(): string[] {
    const drives = this.drives();
    const alerts: string[] = [];
    if (drives.hunger > 75) alerts.push("hungry");
    if (drives.loneliness > 75) alerts.push("lonely");
    if (drives.boredom > 75) alerts.push("bored");
    return alerts;
  }

  private event(message: string): CreatureEvent {
    return { message, mood: this.biochem.getMoodSummary() };
  }
}
