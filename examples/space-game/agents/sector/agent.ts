import { Agent, type Connection, type WSMessage } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

const WORLD = { w: 800, h: 600 };
const TICK_HZ = 30;
const TICK_MS = 1000 / TICK_HZ;
const SHIP_THRUST = 0.18;
const SHIP_TURN = 0.08;
const SHIP_DRAG = 0.985;
const BULLET_SPEED = 7;
const BULLET_TTL_MS = 1500;
const BULLET_COOLDOWN_MS = 220;
const ASTEROID_COUNT = 12;

type Vec = { x: number; y: number };

type Ship = {
  id: string;        // matches the connection id
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** facing angle, radians; 0 = right. */
  a: number;
  /** input flags from this ship's pilot. */
  thrust: boolean;
  left: boolean;
  right: boolean;
  /** ms epoch of next allowed shot. */
  nextShotAt: number;
  /** total kills for this session. */
  kills: number;
  /** total deaths for this session. */
  deaths: number;
  /** ms epoch this ship respawned (used for invuln window). */
  respawnedAt: number;
};

type Bullet = {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** ms epoch when the bullet despawns. */
  expiresAt: number;
};

type Asteroid = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

type State = {
  ships: Ship[];
  bullets: Bullet[];
  asteroids: Asteroid[];
  /** Wall-clock ms of the last tick — purely informational. */
  lastTick: number;
};

type ClientFrame =
  | { kind: "hello"; name: string }
  | { kind: "input"; thrust: boolean; left: boolean; right: boolean }
  | { kind: "fire" };

const RESPAWN_INVULN_MS = 1500;

/**
 * Sector is the world. Each /sector/<name> URL is one independent room;
 * /sector/7-G and /sector/9 are different games with different ships.
 *
 * The agent owns physics. Clients send their input flags every frame
 * (or whenever they change), the agent integrates and broadcasts the
 * full state every tick. State broadcast is JSON via the `world`
 * envelope so we can co-exist with the SDK's own state-sync messages.
 *
 * 30Hz at ~12 ships gives ~5KB/frame — fine for the demo, you'd
 * compress / delta-encode for real production.
 */
export default class SectorAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    ships: [],
    bullets: [],
    asteroids: [],
    lastTick: 0,
  };

  /** Used to drive the sim loop; null when no game loop is active. */
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  /** Spawn a ship at a random edge with random heading. */
  private spawn(id: string, name: string): Ship {
    const margin = 60;
    return {
      id,
      name,
      x: margin + Math.random() * (WORLD.w - 2 * margin),
      y: margin + Math.random() * (WORLD.h - 2 * margin),
      vx: 0,
      vy: 0,
      a: Math.random() * Math.PI * 2,
      thrust: false,
      left: false,
      right: false,
      nextShotAt: 0,
      kills: 0,
      deaths: 0,
      respawnedAt: Date.now(),
    };
  }

  /** Re-seed asteroids if the sector is empty (e.g. fresh DO). */
  private seedAsteroids(): void {
    if (this.state.asteroids.length > 0) return;
    const asteroids: Asteroid[] = [];
    for (let i = 0; i < ASTEROID_COUNT; i++) {
      asteroids.push({
        id: crypto.randomUUID(),
        x: Math.random() * WORLD.w,
        y: Math.random() * WORLD.h,
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        r: 14 + Math.random() * 18,
      });
    }
    this.setState({ ...this.state, asteroids });
  }

  override async onConnect(conn: Connection): Promise<void> {
    this.seedAsteroids();
    // Place ship immediately so the client sees itself; name is bound on
    // the next `hello` frame.
    const ship = this.spawn(conn.id, "guest");
    this.setState({ ...this.state, ships: [...this.state.ships, ship] });
    this.ensureLoop();
  }

  override async onMessage(
    conn: Connection,
    message: WSMessage,
  ): Promise<void> {
    if (typeof message !== "string") return;
    const frame = JSON.parse(message) as ClientFrame;
    const ships = this.state.ships;
    const idx = ships.findIndex((s) => s.id === conn.id);
    if (idx < 0) return;
    const cur = ships[idx]!;

    switch (frame.kind) {
      case "hello": {
        const name = frame.name.trim().slice(0, 24) || "guest";
        const next = [...ships];
        next[idx] = { ...cur, name };
        this.setState({ ...this.state, ships: next });
        break;
      }
      case "input": {
        const next = [...ships];
        next[idx] = {
          ...cur,
          thrust: frame.thrust,
          left: frame.left,
          right: frame.right,
        };
        this.setState({ ...this.state, ships: next });
        break;
      }
      case "fire": {
        const now = Date.now();
        if (now < cur.nextShotAt) return;
        const bullet: Bullet = {
          id: crypto.randomUUID(),
          ownerId: cur.id,
          x: cur.x + Math.cos(cur.a) * 16,
          y: cur.y + Math.sin(cur.a) * 16,
          vx: cur.vx + Math.cos(cur.a) * BULLET_SPEED,
          vy: cur.vy + Math.sin(cur.a) * BULLET_SPEED,
          expiresAt: now + BULLET_TTL_MS,
        };
        const next = [...ships];
        next[idx] = { ...cur, nextShotAt: now + BULLET_COOLDOWN_MS };
        this.setState({
          ...this.state,
          ships: next,
          bullets: [...this.state.bullets, bullet],
        });
        break;
      }
    }
  }

  override async onClose(conn: Connection): Promise<void> {
    this.setState({
      ...this.state,
      ships: this.state.ships.filter((s) => s.id !== conn.id),
      bullets: this.state.bullets.filter((b) => b.ownerId !== conn.id),
    });
    if (this.state.ships.length === 0) this.stopLoop();
  }

  override async onRequest(): Promise<Response> {
    return Response.json({
      instance: this.name,
      ships: this.state.ships.length,
      bullets: this.state.bullets.length,
      asteroids: this.state.asteroids.length,
      world: WORLD,
    });
  }

  // -- physics loop --------------------------------------------------------
  //
  // Run as a real setInterval inside the DO. The DO is alive as long as
  // there's an open WebSocket, so the loop survives request boundaries.
  // On reconnect-from-cold-storage, the loop restarts from onConnect.

  private ensureLoop(): void {
    if (this.loopHandle) return;
    this.loopHandle = setInterval(() => this.tick(), TICK_MS);
  }

  private stopLoop(): void {
    if (this.loopHandle) clearInterval(this.loopHandle);
    this.loopHandle = null;
  }

  private tick(): void {
    const now = Date.now();
    const next: State = {
      ships: this.state.ships.map((s) => integrateShip(s)),
      bullets: this.state.bullets
        .filter((b) => b.expiresAt > now)
        .map((b) => ({ ...b, x: wrap(b.x + b.vx, WORLD.w), y: wrap(b.y + b.vy, WORLD.h) })),
      asteroids: this.state.asteroids.map((a) => ({
        ...a,
        x: wrap(a.x + a.vx, WORLD.w),
        y: wrap(a.y + a.vy, WORLD.h),
      })),
      lastTick: now,
    };

    // Bullet → ship collision (with respawn invulnerability window).
    const dead = new Set<string>();
    for (let bi = next.bullets.length - 1; bi >= 0; bi--) {
      const b = next.bullets[bi]!;
      for (const s of next.ships) {
        if (s.id === b.ownerId) continue; // no friendly fire to self
        if (now - s.respawnedAt < RESPAWN_INVULN_MS) continue;
        if (dist2(b, s) < 12 * 12) {
          dead.add(s.id);
          // Credit the shooter.
          const shooter = next.ships.find((x) => x.id === b.ownerId);
          if (shooter) shooter.kills++;
          next.bullets.splice(bi, 1);
          break;
        }
      }
    }

    if (dead.size > 0) {
      next.ships = next.ships.map((s) =>
        dead.has(s.id)
          ? {
              ...this.spawn(s.id, s.name),
              kills: s.kills,
              deaths: s.deaths + 1,
            }
          : s,
      );
    }

    // Pipe out the new state. Avoid setState if nothing observable changed
    // but keep it simple for demo legibility — we always set.
    this.setState(next);
  }
}

function integrateShip(s: Ship): Ship {
  let a = s.a;
  if (s.left) a -= SHIP_TURN;
  if (s.right) a += SHIP_TURN;
  let vx = s.vx * SHIP_DRAG;
  let vy = s.vy * SHIP_DRAG;
  if (s.thrust) {
    vx += Math.cos(a) * SHIP_THRUST;
    vy += Math.sin(a) * SHIP_THRUST;
  }
  return {
    ...s,
    a,
    vx,
    vy,
    x: wrap(s.x + vx, WORLD.w),
    y: wrap(s.y + vy, WORLD.h),
  };
}

function wrap(v: number, max: number): number {
  if (v < 0) return v + max;
  if (v >= max) return v - max;
  return v;
}

function dist2(a: Vec, b: Vec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
