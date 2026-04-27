import { Agent } from "agents";

type Env = Record<string, never>;
type Report = { name: string; rows: number };
type State = { reports: Report[] };

/**
 * ReportsAgent lives under /admin so the admin middleware gates it.
 * The catalog endpoint hides this agent from any caller that doesn't
 * pass the bearer-token check — proves access-aware filtering.
 */
export default class ReportsAgent extends Agent<Env, State> {
  override initialState: State = {
    reports: [
      { name: "daily-orders", rows: 142 },
      { name: "user-signups", rows: 17 },
    ],
  };

  /**
   * Return every available report. Sensitive — gated by admin auth.
   * @callable
   */
  async listReports(): Promise<Report[]> {
    return this.state.reports;
  }

  override async onRequest(): Promise<Response> {
    return Response.json({ instance: this.name, ...this.state });
  }
}
