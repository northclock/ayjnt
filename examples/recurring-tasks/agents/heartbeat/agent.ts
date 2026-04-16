import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Tick = { at: number; n: number; load: number };

type State = {
  intervalSeconds: number;
  ticks: Tick[];
  /** ID of the active recurring schedule (so we can cancel it on stop). */
  scheduleId: string | null;
};

/** Cap the rolling history so an agent that ticks for days doesn't bloat. */
const MAX_HISTORY = 50;

/**
 * A self-driving agent that wakes itself on a fixed cadence via
 * `scheduleEvery()`. Classic "background worker on a single DO" pattern:
 *
 *   POST /heartbeat/:id { intervalSeconds: 5 }   → start ticking
 *   POST /heartbeat/:id { stop: true }            → stop
 *   GET  /heartbeat/:id                           → state (last 50 ticks)
 *
 * The tick callback simulates a periodic check (here: synthetic load
 * sample), prepends to a rolling buffer, and persists. State broadcasts
 * to any connected UI as a side effect of setState.
 */
export default class HeartbeatAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    intervalSeconds: 0,
    ticks: [],
    scheduleId: null,
  };

  /** Recurring callback — called every `intervalSeconds` once started. */
  async tick(): Promise<void> {
    const last = this.state.ticks[0]?.n ?? 0;
    const tick: Tick = {
      at: Date.now(),
      n: last + 1,
      // Stand in for a real measurement: a slowly-drifting random load.
      load: Math.round((50 + Math.random() * 50) * 10) / 10,
    };
    const ticks = [tick, ...this.state.ticks].slice(0, MAX_HISTORY);
    this.setState({ ...this.state, ticks });
  }

  /** Cancel any active recurring schedule. Safe to call when none is set. */
  private async stopTicking(): Promise<void> {
    if (this.state.scheduleId) {
      try {
        await this.cancelSchedule(this.state.scheduleId);
      } catch {
        // Already gone — fine, fall through.
      }
    }
    this.setState({ ...this.state, intervalSeconds: 0, scheduleId: null });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      await this.stopTicking();
      this.setState({ intervalSeconds: 0, ticks: [], scheduleId: null });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        intervalSeconds?: number;
        stop?: boolean;
      };

      if (body.stop) {
        await this.stopTicking();
        return Response.json({ ok: true, running: false });
      }

      const intervalSeconds = body.intervalSeconds ?? 5;
      // Cancel a previous schedule before starting a new one — calling
      // scheduleEvery twice without cleanup leaves both running.
      await this.stopTicking();

      const schedule = await this.scheduleEvery(intervalSeconds, "tick");
      this.setState({
        ...this.state,
        intervalSeconds,
        scheduleId: schedule.id,
      });
      return Response.json({
        ok: true,
        running: true,
        intervalSeconds,
      });
    }

    return Response.json({ instance: this.name, ...this.state });
  }
}
