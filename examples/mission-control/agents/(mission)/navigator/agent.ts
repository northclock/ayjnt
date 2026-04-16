import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

export type Vec3 = { x: number; y: number; z: number };

export type NavigatorStatus = {
  position: Vec3;
  target: Vec3 | null;
  fuel: number;          // 0..100
  speed: number;         // units/tick
  heading: Vec3;         // unit vector
  arrived: boolean;
  trail: Vec3[];         // recent positions for the UI radar
};

type State = NavigatorStatus & {
  lastUpdate: number;
};

const MAX_TRAIL = 40;

/**
 * NavigatorAgent — per-mission. /navigator/main-mission is one, /navigator/
 * backup is another. Knows where the rover is, where it's going, and how
 * much fuel it has.
 *
 * Callable RPC methods (typed via getAgent<NavigatorAgent>):
 *   setCourse(target)     — pick a destination, heading recomputed
 *   report()              — return current state for aggregation
 *   refuel()              — top up fuel for demo resets
 *
 * On every onRequest we advance the sim one tick. The commander kicks a
 * tick loop through setInterval, which simulates time passing.
 */
export default class NavigatorAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    position: { x: 0, y: 0, z: 0 },
    target: null,
    fuel: 100,
    speed: 1.4,
    heading: { x: 1, y: 0, z: 0 },
    arrived: false,
    trail: [],
    lastUpdate: 0,
  };

  /** Pick a destination. Recompute heading from current position. */
  async setCourse(target: Vec3): Promise<NavigatorStatus> {
    const heading = unit(sub(target, this.state.position));
    this.setState({
      ...this.state,
      target,
      heading,
      arrived: false,
    });
    return this.report();
  }

  async refuel(): Promise<NavigatorStatus> {
    this.setState({ ...this.state, fuel: 100 });
    return this.report();
  }

  /** Advance the sim by one tick. Called by the commander's tick loop. */
  async tick(): Promise<NavigatorStatus> {
    if (!this.state.target || this.state.arrived || this.state.fuel <= 0) {
      return this.report();
    }
    const toTarget = sub(this.state.target, this.state.position);
    const d = magnitude(toTarget);
    if (d < this.state.speed) {
      // Snap to target — we arrived this tick.
      this.setState({
        ...this.state,
        position: this.state.target,
        arrived: true,
        fuel: Math.max(0, this.state.fuel - 0.5),
        lastUpdate: Date.now(),
        trail: [...this.state.trail, this.state.target].slice(-MAX_TRAIL),
      });
      return this.report();
    }
    const step = scale(unit(toTarget), this.state.speed);
    const position = add(this.state.position, step);
    this.setState({
      ...this.state,
      position,
      heading: unit(toTarget),
      fuel: Math.max(0, this.state.fuel - 0.25),
      lastUpdate: Date.now(),
      trail: [...this.state.trail, position].slice(-MAX_TRAIL),
    });
    return this.report();
  }

  async report(): Promise<NavigatorStatus> {
    const { lastUpdate, ...rest } = this.state;
    void lastUpdate;
    return rest;
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      this.setState(this.initialState);
      return Response.json({ ok: true });
    }
    if (request.method === "POST") {
      const body = (await request.json()) as {
        action?: "course" | "refuel" | "tick";
        target?: Vec3;
      };
      if (body.action === "course" && body.target) {
        return Response.json(await this.setCourse(body.target));
      }
      if (body.action === "refuel") {
        return Response.json(await this.refuel());
      }
      if (body.action === "tick") {
        return Response.json(await this.tick());
      }
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}

// -- tiny vector lib -------------------------------------------------------

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale(v: Vec3, k: number): Vec3 {
  return { x: v.x * k, y: v.y * k, z: v.z * k };
}
function magnitude(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function unit(v: Vec3): Vec3 {
  const m = magnitude(v);
  return m === 0 ? { x: 1, y: 0, z: 0 } : scale(v, 1 / m);
}
