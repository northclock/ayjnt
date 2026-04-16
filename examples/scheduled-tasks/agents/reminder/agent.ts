import { Agent } from "agents";
import type { GeneratedEnv } from "@ayjnt/env";

type Reminder = {
  id: string;
  text: string;
  /** ms epoch when the reminder was scheduled to fire. */
  due: number;
  /** ms epoch when the reminder actually fired (undefined while pending). */
  firedAt?: number;
};

type State = {
  pending: Reminder[];
  fired: Reminder[];
};

/**
 * A reminder agent that exercises the Agents SDK's `this.schedule()` API
 * for one-shot deferred work. Three ways to call it:
 *
 *   POST /reminder/:id   { text, in?: seconds, at?: ISO date }
 *
 * - `in` schedules a relative delay in seconds.
 * - `at` schedules at an absolute ISO timestamp.
 * - Neither → fire immediately on the next tick (delay 0).
 *
 * `this.schedule()` returns a Schedule with an `id`. We persist that id so
 * the UI / client can match a fired reminder back to its scheduling call.
 */
export default class ReminderAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = { pending: [], fired: [] };

  /**
   * Callback fired by the scheduler. The signature is `(payload, schedule)`
   * — payload is whatever you passed as the third arg to `schedule()`,
   * schedule is the metadata record created at scheduling time.
   */
  async fire(reminder: Reminder): Promise<void> {
    const firedAt = Date.now();
    this.setState({
      pending: this.state.pending.filter((r) => r.id !== reminder.id),
      fired: [...this.state.fired, { ...reminder, firedAt }],
    });
    console.log(`[reminder] fired ${reminder.id}: ${reminder.text}`);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      // Cancel every pending schedule. getSchedules is sync; cancelSchedule
      // takes the schedule id.
      for (const s of this.getSchedules()) {
        await this.cancelSchedule(s.id);
      }
      this.setState({ pending: [], fired: [] });
      return Response.json({ ok: true, cleared: true });
    }

    if (request.method !== "POST") {
      return Response.json({ instance: this.name, ...this.state });
    }

    const body = (await request.json()) as {
      text: string;
      in?: number;
      at?: string;
    };

    // Decide when to fire. The schedule API accepts seconds, an ISO Date,
    // or a unix-time number — we normalise to a Date and a "due" epoch.
    const due = body.at
      ? new Date(body.at)
      : new Date(Date.now() + (body.in ?? 0) * 1000);

    // Stage the reminder record. `schedule()` callback name must match a
    // method on this class — `keyof this` gives us a typed string.
    const id = crypto.randomUUID();
    const reminder: Reminder = { id, text: body.text, due: due.getTime() };

    await this.schedule(due, "fire", reminder);

    this.setState({
      pending: [...this.state.pending, reminder],
      fired: this.state.fired,
    });

    return Response.json({
      ok: true,
      scheduled: reminder,
      msFromNow: due.getTime() - Date.now(),
    });
  }
}
