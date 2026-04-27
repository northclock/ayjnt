import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Reminder = {
  id: string;
  text: string;
  /** ms epoch when the schedule was registered. */
  createdAt: number;
  /** ms epoch when the reminder is set to fire. */
  due: number;
  /** ms epoch when the callback ran (undefined while pending). */
  firedAt?: number;
};

type State = {
  pending: Reminder[];
  fired: Reminder[];
};

/** Cap on the fired-history list so a long-lived agent doesn't grow without
 *  bound. New entries push out the oldest. */
const MAX_FIRED = 50;

/**
 * RemindersAgent — schedule a reminder N seconds from now (or at an absolute
 * ISO date) using the Agents SDK's one-shot `this.schedule()` API. When the
 * scheduled time arrives, the framework calls `fire()` with the persisted
 * reminder payload; we move it from `pending` to `fired` and `setState`
 * broadcasts to every connected client.
 *
 * The "push notification" piece lives in the UI: `app.tsx` watches
 * `state.fired` via `useAgent`, and when a new entry appears it calls
 * `new Notification(...)` so the OS shows a system-level alert. The browser
 * tab must be open for that to fire — see docs.md for the trade-off vs
 * full Web Push (VAPID + service worker), which is out of scope for this
 * example.
 *
 *   POST /reminders/:id   { text, in?: seconds, at?: ISO date }
 *
 * - `in` schedules a relative delay in seconds.
 * - `at` schedules at an absolute ISO timestamp.
 * - Neither → fires on the next tick (delay 0 ≈ "right now").
 */
export default class RemindersAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { pending: [], fired: [] };

  /**
   * Scheduler callback. The signature is `(payload, schedule)` — payload is
   * whatever was passed as the third arg to `this.schedule()`, schedule is
   * the metadata record created at scheduling time. We only need payload.
   */
  async fire(reminder: Reminder): Promise<void> {
    const firedAt = Date.now();
    const fired = [
      { ...reminder, firedAt },
      ...this.state.fired,
    ].slice(0, MAX_FIRED);
    this.setState({
      pending: this.state.pending.filter((r) => r.id !== reminder.id),
      fired,
    });
  }

  /**
   * Schedule a new reminder. Returns the persisted record so the caller
   * can render it immediately (with `firedAt: undefined`).
   * @callable
   */
  async createReminder(
    text: string,
    inSeconds: number,
  ): Promise<Reminder> {
    const due = new Date(Date.now() + inSeconds * 1000);
    const reminder: Reminder = {
      id: crypto.randomUUID(),
      text,
      createdAt: Date.now(),
      due: due.getTime(),
    };
    await this.schedule(due, "fire", reminder);
    this.setState({
      pending: [...this.state.pending, reminder],
      fired: this.state.fired,
    });
    return reminder;
  }

  /**
   * Cancel one pending reminder by id. No-op if it already fired or never
   * existed.
   * @callable
   */
  async cancelReminder(id: string): Promise<{ cancelled: boolean }> {
    const found = this.state.pending.find((r) => r.id === id);
    if (!found) return { cancelled: false };

    // Match the schedule by callback name + payload id. The Agents SDK
    // doesn't surface schedules by user-defined key, so we filter the
    // full list — fine at the scale of one user's reminders.
    //
    // The `payload` field is typed as `string` upstream because the SDK
    // doesn't know what users put in there. Cast through `unknown` —
    // we only ever schedule a `Reminder` payload from `createReminder`.
    for (const s of this.getSchedules()) {
      const payload = s.payload as unknown as Reminder | undefined;
      if (payload && payload.id === id) {
        try {
          await this.cancelSchedule(s.id);
        } catch {
          // Already gone.
        }
      }
    }

    this.setState({
      pending: this.state.pending.filter((r) => r.id !== id),
      fired: this.state.fired,
    });
    return { cancelled: true };
  }

  override async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // DELETE /reminders/:id/:reminderId  → cancel one
    // DELETE /reminders/:id              → wipe everything
    if (request.method === "DELETE") {
      const segments = url.pathname.split("/").filter(Boolean);
      const target = segments[segments.length - 1];
      if (target && target !== this.name) {
        const result = await this.cancelReminder(target);
        return Response.json({ ok: true, ...result });
      }
      for (const s of this.getSchedules()) {
        await this.cancelSchedule(s.id).catch(() => {});
      }
      this.setState({ pending: [], fired: [] });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method === "POST") {
      const body = (await request.json()) as {
        text?: string;
        in?: number;
        at?: string;
      };
      if (!body.text) {
        return Response.json(
          { ok: false, error: "missing text" },
          { status: 400 },
        );
      }

      // Normalise to "seconds from now" so createReminder has a single
      // contract. Past times collapse to 0 (= fire immediately).
      const inSeconds = body.at
        ? Math.max(0, Math.round((new Date(body.at).getTime() - Date.now()) / 1000))
        : (body.in ?? 0);

      const reminder = await this.createReminder(body.text, inSeconds);
      return Response.json({
        ok: true,
        reminder,
        msFromNow: reminder.due - Date.now(),
      });
    }

    return Response.json({ instance: this.name, ...this.state });
  }
}
