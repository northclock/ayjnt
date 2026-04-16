import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type SystemName =
  | "power"
  | "lifeSupport"
  | "comms"
  | "hull"
  | "drill";

export type EngineerStatus = {
  systems: Record<SystemName, number>; // 0..100
  /** Count of completed repairs — useful for demos. */
  repairs: number;
  /** True while a repair is in progress; UI disables the button. */
  repairing: SystemName | null;
  /** Aggregate: 100 = all systems healthy, 0 = catastrophic. */
  aggregate: number;
};

type State = EngineerStatus;

const SYSTEMS: SystemName[] = [
  "power",
  "lifeSupport",
  "comms",
  "hull",
  "drill",
];

/**
 * EngineerAgent — per-mission systems officer. Each system has a health
 * value 0..100. Systems degrade a bit on every commander tick (simulates
 * wear); repair() brings one system back to 100.
 *
 * Callable RPC:
 *   repair(system)  — start a repair. Returns when done (short delay).
 *   degrade()       — drop a random system a bit (called by commander tick).
 *   report()        — status for commander aggregation.
 */
export default class EngineerAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    systems: {
      power: 100,
      lifeSupport: 100,
      comms: 100,
      hull: 100,
      drill: 100,
    },
    repairs: 0,
    repairing: null,
    aggregate: 100,
  };

  async repair(system: SystemName): Promise<EngineerStatus> {
    if (this.state.repairing) return this.report();
    this.setState({ ...this.state, repairing: system });
    // Toy repair latency — 300ms per unit of missing health, capped at 1.5s.
    const missing = 100 - this.state.systems[system];
    await new Promise((r) => setTimeout(r, Math.min(1500, 30 * missing)));
    const systems = { ...this.state.systems, [system]: 100 };
    this.setState({
      ...this.state,
      systems,
      repairs: this.state.repairs + 1,
      repairing: null,
      aggregate: aggregateHealth(systems),
    });
    return this.report();
  }

  /** Called by the commander's tick: knock a random system down a bit. */
  async degrade(): Promise<EngineerStatus> {
    const pick = SYSTEMS[Math.floor(Math.random() * SYSTEMS.length)]!;
    const amount = 2 + Math.random() * 6;
    const systems = {
      ...this.state.systems,
      [pick]: Math.max(0, this.state.systems[pick] - amount),
    };
    this.setState({
      ...this.state,
      systems,
      aggregate: aggregateHealth(systems),
    });
    return this.report();
  }

  async report(): Promise<EngineerStatus> {
    return { ...this.state };
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState(this.initialState);
      return Response.json({ ok: true });
    }
    if (request.method === "POST") {
      const body = (await request.json()) as {
        action?: "repair" | "degrade";
        system?: SystemName;
      };
      if (body.action === "degrade") {
        return Response.json(await this.degrade());
      }
      if (
        body.action === "repair" &&
        body.system &&
        SYSTEMS.includes(body.system)
      ) {
        return Response.json(await this.repair(body.system));
      }
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}

function aggregateHealth(systems: Record<SystemName, number>): number {
  // Geometric-ish: a single failing system matters more than averaging.
  // Returns 0..100.
  const values = Object.values(systems);
  const min = Math.min(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(min * 0.6 + avg * 0.4);
}
