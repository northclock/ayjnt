import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type Contact = {
  id: string;
  kind: "asteroid" | "debris" | "signal" | "hostile";
  /** Distance from the rover in sector units. */
  distance: number;
  bearing: number; // radians
  /** Rough assessment — affects the aggregate threat level. */
  severity: number; // 0..1
  spottedAt: number;
};

export type ScoutStatus = {
  scanning: boolean;
  sensorRange: number;
  contacts: Contact[];
  /** 0..1 rollup, max of contact severities. */
  threatLevel: number;
  lastScan: number | null;
};

type State = ScoutStatus;

const MAX_CONTACTS = 16;
const KINDS: Contact["kind"][] = [
  "asteroid",
  "debris",
  "signal",
  "hostile",
];

/**
 * ScoutAgent — per-mission sensor operator. /scout/main and /scout/backup
 * are independent.
 *
 * Callable RPC:
 *   scan()       — spin up a toy random-contact generator for one sweep
 *   clear()      — wipe contacts (e.g. after action)
 *   report()     — aggregate status for the commander
 *
 * The `scan()` simulation is deliberately fake. In a real system this
 * would call into sensor hardware or a satellite feed.
 */
export default class ScoutAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    scanning: false,
    sensorRange: 25,
    contacts: [],
    threatLevel: 0,
    lastScan: null,
  };

  async scan(): Promise<ScoutStatus> {
    this.setState({ ...this.state, scanning: true });
    // Simulate a bit of sensor latency — keep it short so the demo feels
    // snappy. Production: call sensor hardware / satellite API here.
    await new Promise((r) => setTimeout(r, 150));

    const newCount = 1 + Math.floor(Math.random() * 3);
    const fresh: Contact[] = [];
    for (let i = 0; i < newCount; i++) {
      fresh.push({
        id: crypto.randomUUID(),
        kind: KINDS[Math.floor(Math.random() * KINDS.length)]!,
        distance: Math.random() * this.state.sensorRange,
        bearing: Math.random() * Math.PI * 2,
        severity: Math.random(),
        spottedAt: Date.now(),
      });
    }
    const contacts = [...fresh, ...this.state.contacts].slice(0, MAX_CONTACTS);
    const threatLevel = contacts.reduce(
      (m, c) => Math.max(m, c.kind === "hostile" ? c.severity : c.severity * 0.4),
      0,
    );

    this.setState({
      ...this.state,
      scanning: false,
      contacts,
      threatLevel,
      lastScan: Date.now(),
    });

    return this.report();
  }

  async clear(): Promise<ScoutStatus> {
    this.setState({ ...this.state, contacts: [], threatLevel: 0 });
    return this.report();
  }

  async report(): Promise<ScoutStatus> {
    return { ...this.state };
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState(this.initialState);
      return Response.json({ ok: true });
    }
    if (request.method === "POST") {
      const { action } = (await request.json()) as { action?: string };
      if (action === "scan") return Response.json(await this.scan());
      if (action === "clear") return Response.json(await this.clear());
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}
