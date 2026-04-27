import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

/**
 * One half-hour intensity sample as returned by
 * https://api.carbonintensity.org.uk/intensity (UK National Grid).
 *
 * `actual` is null until the period closes; `forecast` is always present.
 * `index` is the qualitative band — "very low" | "low" | "moderate" |
 * "high" | "very high".
 */
type Sample = {
  /** ms epoch when the agent fetched this sample. */
  fetchedAt: number;
  /** Half-hour window the sample describes (ISO from API). */
  from: string;
  to: string;
  forecast: number;
  actual: number | null;
  index: string;
};

type State = {
  /** Polling cadence. 0 means stopped. */
  intervalSeconds: number;
  /** ID of the active recurring schedule, so stop/restart can cancel it. */
  scheduleId: string | null;
  /** The most recent sample, surfaced separately for cheap "current" reads. */
  current: Sample | null;
  /** Rolling history, newest-first. Capped at MAX_HISTORY. */
  history: Sample[];
  /** Last fetch error (cleared on the next successful fetch). */
  error: string | null;
};

/** Cap so an agent that polls for days doesn't grow unbounded in DO storage. */
const MAX_HISTORY = 60;

/** Public, no-auth UK grid intensity endpoint. Cached server-side per
 *  half-hour, so polling more often than once a minute is wasted bytes — but
 *  we still default to 60s to keep the demo lively. */
const CARBON_URL = "https://api.carbonintensity.org.uk/intensity";

type CarbonResponse = {
  data: {
    from: string;
    to: string;
    intensity: { forecast: number; actual: number | null; index: string };
  }[];
};

/**
 * CarbonAgent — polls the UK National Grid carbon intensity API on a fixed
 * cadence using the Agents SDK's `scheduleEvery()` API. Demonstrates the
 * "self-driving recurring background job" pattern:
 *
 *   POST /carbon/:id   { intervalSeconds: 60 }   → start polling
 *   POST /carbon/:id   { stop: true }             → stop
 *   DELETE /carbon/:id                            → stop + clear history
 *   GET  /carbon/:id                              → state (current + history)
 *
 * The recurring callback (`tick`) makes the HTTP call, prepends to a
 * rolling buffer, and persists. Because `setState` broadcasts to every
 * connected `useAgent` client, the UI updates live without polling itself.
 */
export default class CarbonAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    intervalSeconds: 0,
    scheduleId: null,
    current: null,
    history: [],
    error: null,
  };

  /**
   * Recurring callback — fetches the latest grid sample and prepends to
   * `history`. The framework retries on its own if a tick handler throws,
   * so we swallow fetch errors into state instead of letting them bubble.
   * @callable
   */
  async tick(): Promise<void> {
    try {
      const res = await fetch(CARBON_URL, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as CarbonResponse;
      const row = body.data?.[0];
      if (!row) throw new Error("empty response");

      const sample: Sample = {
        fetchedAt: Date.now(),
        from: row.from,
        to: row.to,
        forecast: row.intensity.forecast,
        actual: row.intensity.actual,
        index: row.intensity.index,
      };

      const history = [sample, ...this.state.history].slice(0, MAX_HISTORY);
      this.setState({
        ...this.state,
        current: sample,
        history,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ ...this.state, error: message });
    }
  }

  /**
   * Start polling at the given cadence. Cancels any pre-existing schedule
   * before installing a new one — calling `scheduleEvery` twice without
   * cleanup leaves both ticking.
   * @callable
   */
  async startPolling(intervalSeconds: number): Promise<{ scheduleId: string }> {
    await this.stopPolling();
    // Tick once immediately so the UI gets data without waiting a full
    // interval — recurring schedules don't fire at t=0.
    await this.tick();
    const schedule = await this.scheduleEvery(intervalSeconds, "tick");
    this.setState({
      ...this.state,
      intervalSeconds,
      scheduleId: schedule.id,
    });
    return { scheduleId: schedule.id };
  }

  /**
   * Cancel any active recurring schedule. Safe to call when none is set.
   * @callable
   */
  async stopPolling(): Promise<void> {
    if (this.state.scheduleId) {
      try {
        await this.cancelSchedule(this.state.scheduleId);
      } catch {
        // Already gone (e.g. wrangler restart). Fine — fall through.
      }
    }
    this.setState({ ...this.state, intervalSeconds: 0, scheduleId: null });
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      await this.stopPolling();
      this.setState({
        intervalSeconds: 0,
        scheduleId: null,
        current: null,
        history: [],
        error: null,
      });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        intervalSeconds?: number;
        stop?: boolean;
      };

      if (body.stop) {
        await this.stopPolling();
        return Response.json({ ok: true, running: false });
      }

      const intervalSeconds = body.intervalSeconds ?? 60;
      const { scheduleId } = await this.startPolling(intervalSeconds);
      return Response.json({
        ok: true,
        running: true,
        intervalSeconds,
        scheduleId,
      });
    }

    return Response.json({ instance: this.name, ...this.state });
  }
}
