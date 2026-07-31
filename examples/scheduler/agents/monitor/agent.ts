import { Agent, callable } from "ayjnt";

type Cadence =
  | { kind: "once"; delaySeconds: number }
  | { kind: "interval"; everySeconds: number }
  | { kind: "cron"; expression: string };
type Monitor = {
  id: string;
  url: string;
  label: string;
  cadence: Cadence;
  scheduleId: string;
  createdAt: number;
};
type Run = {
  id: string;
  monitorId: string;
  at: number;
  ok: boolean;
  status: number;
  durationMs: number;
  preview: string;
};
type State = { monitors: Monitor[]; runs: Run[] };

export default class MonitorAgent extends Agent<State> {
  override initialState: State = { monitors: [], runs: [] };

  @callable()
  async create(
    label: string,
    url: string,
    cadence: Cadence,
  ): Promise<Monitor> {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported.");
    }
    const id = crypto.randomUUID();
    const schedule =
      cadence.kind === "once"
        ? await this.schedule(cadence.delaySeconds, "check", id)
        : cadence.kind === "interval"
          ? await this.scheduleEvery(cadence.everySeconds, "check", id)
          : await this.schedule(cadence.expression, "check", id);
    const monitor = {
      id,
      url: parsed.toString(),
      label: label.trim() || parsed.hostname,
      cadence,
      scheduleId: schedule.id,
      createdAt: Date.now(),
    };
    this.setState({ ...this.state, monitors: [monitor, ...this.state.monitors] });
    return monitor;
  }

  async check(monitorId: string): Promise<void> {
    const monitor = this.state.monitors.find((item) => item.id === monitorId);
    if (!monitor) return;
    const started = Date.now();
    let run: Run;
    try {
      const response = await fetch(monitor.url, {
        headers: { "user-agent": "ayjnt-scheduler-example/1.0" },
      });
      const text = await response.text();
      run = {
        id: crypto.randomUUID(),
        monitorId,
        at: Date.now(),
        ok: response.ok,
        status: response.status,
        durationMs: Date.now() - started,
        preview: text.replace(/\s+/g, " ").slice(0, 180),
      };
    } catch (error) {
      run = {
        id: crypto.randomUUID(),
        monitorId,
        at: Date.now(),
        ok: false,
        status: 0,
        durationMs: Date.now() - started,
        preview: error instanceof Error ? error.message : String(error),
      };
    }
    this.setState({ ...this.state, runs: [run, ...this.state.runs].slice(0, 100) });
  }

  @callable()
  async runNow(monitorId: string): Promise<void> {
    await this.check(monitorId);
  }

  @callable()
  async remove(monitorId: string): Promise<void> {
    const monitor = this.state.monitors.find((item) => item.id === monitorId);
    if (monitor) await this.cancelSchedule(monitor.scheduleId).catch(() => {});
    this.setState({
      monitors: this.state.monitors.filter((item) => item.id !== monitorId),
      runs: this.state.runs.filter((item) => item.monitorId !== monitorId),
    });
  }
}
