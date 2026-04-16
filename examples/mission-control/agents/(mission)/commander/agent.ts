import { Agent } from "agents";
import { getAgent } from "ayjnt/rpc";
import type { GeneratedEnv } from "@ayjnt/env";
import type NavigatorAgent from "../navigator/agent.ts";
import type ScoutAgent from "../scout/agent.ts";
import type EngineerAgent from "../engineer/agent.ts";
import type { NavigatorStatus, Vec3 } from "../navigator/agent.ts";
import type { ScoutStatus } from "../scout/agent.ts";
import type { EngineerStatus } from "../engineer/agent.ts";

type Phase = "idle" | "survey" | "approach" | "extract" | "return" | "done";

type LogEntry = { at: number; text: string; level: "info" | "warn" | "ok" };

type Crew = {
  navigator: NavigatorStatus | null;
  scout: ScoutStatus | null;
  engineer: EngineerStatus | null;
};

type State = {
  phase: Phase;
  cycle: number;
  running: boolean;
  scheduleId: string | null;
  objective: string;
  log: LogEntry[];
  crew: Crew;
};

/** Waypoints for the canned demo mission. Mars-orbital-scale made up. */
const WAYPOINTS: Record<Phase, Vec3 | null> = {
  idle: null,
  survey: { x: 40, y: 10, z: 0 },
  approach: { x: 80, y: 30, z: -5 },
  extract: { x: 80, y: 30, z: -5 },   // dwell at target
  return: { x: 0, y: 0, z: 0 },
  done: null,
};

const NEXT_PHASE: Record<Phase, Phase> = {
  idle: "survey",
  survey: "approach",
  approach: "extract",
  extract: "return",
  return: "done",
  done: "done",
};

const LOG_LIMIT = 30;

/**
 * CommanderAgent — orchestrates the three-crew mission. One DO per mission.
 *
 * Every 2s it:
 *   1. Calls navigator.tick() to advance position
 *   2. Calls engineer.degrade() to erode system health
 *   3. Every third tick, fires a scout.scan()
 *   4. Pulls fresh status from all three via report() and stores aggregate
 *   5. Checks whether to advance to the next phase
 *
 * The UI of commander shows the big-picture mission dashboard. Each crew
 * agent also has its own UI (/navigator/:id, /scout/:id, /engineer/:id)
 * for dive-in inspection — they share the same DO state, so the UIs
 * update as the commander drives them.
 */
export default class CommanderAgent extends Agent<GeneratedEnv, State> {
  override initialState: State = {
    phase: "idle",
    cycle: 0,
    running: false,
    scheduleId: null,
    objective: "survey-and-extract",
    log: [],
    crew: { navigator: null, scout: null, engineer: null },
  };

  /** Callable by the UI: start, pause, reset. */
  async start(): Promise<State> {
    if (this.state.running) return this.state;
    await this.stop();
    const schedule = await this.scheduleEvery(2, "tick");
    this.setState({
      ...this.state,
      running: true,
      scheduleId: schedule.id,
      phase: this.state.phase === "done" ? "idle" : this.state.phase,
    });
    this.append("mission engaged", "ok");
    // Prime navigator with the first waypoint if we're idle.
    await this.advancePhase("survey");
    return this.state;
  }

  async stop(): Promise<State> {
    if (this.state.scheduleId) {
      try {
        await this.cancelSchedule(this.state.scheduleId);
      } catch {
        /* ignore */
      }
    }
    this.setState({ ...this.state, running: false, scheduleId: null });
    return this.state;
  }

  async reset(): Promise<State> {
    await this.stop();
    // Reset every crew too so the demo starts clean.
    await Promise.all([
      this.nav().then((a) => a.refuel()),
      this.scout().then((a) => a.clear()),
      // EngineerAgent doesn't have a repair-all RPC; repair each system.
      this.repairAll(),
    ]);
    this.setState(this.initialState);
    this.append("mission reset", "info");
    return this.state;
  }

  /** Recurring tick fired by scheduleEvery. */
  async tick(): Promise<void> {
    if (!this.state.running) return;

    const cycle = this.state.cycle + 1;
    const nav = await this.nav();
    const scout = await this.scout();
    const eng = await this.engineer();

    const navStatus = await nav.tick();
    const engStatus = await eng.degrade();
    let scoutStatus = this.state.crew.scout;
    // Scout on every third cycle to keep output readable.
    if (cycle % 3 === 0) {
      scoutStatus = await scout.scan();
    } else {
      scoutStatus = await scout.report();
    }

    // Decide whether to advance phase. Demo rule: advance when navigator
    // arrives at the waypoint. Extract dwells for 3 ticks at the target.
    let phase: Phase = this.state.phase;
    let log = this.state.log;

    if (navStatus.arrived && phase !== "done") {
      if (phase === "extract") {
        // Count dwell ticks by tagging the entry with cycle numbers.
        const dwellTicks = log.filter(
          (e) => e.text.startsWith("[dwell "),
        ).length;
        if (dwellTicks >= 3) {
          phase = NEXT_PHASE[phase];
          log = this.logPush(log, `phase → ${phase}`, "ok");
          await this.advancePhaseNav(phase);
        } else {
          log = this.logPush(log, `[dwell ${dwellTicks + 1}/3] extracting`, "info");
        }
      } else {
        phase = NEXT_PHASE[phase];
        log = this.logPush(log, `phase → ${phase}`, "ok");
        await this.advancePhaseNav(phase);
      }
    }

    if (phase === "done") {
      this.setState({
        ...this.state,
        cycle,
        phase,
        log,
        crew: {
          navigator: navStatus,
          scout: scoutStatus,
          engineer: engStatus,
        },
      });
      await this.stop();
      this.append("mission complete", "ok");
      return;
    }

    // Fuel emergency: switch to return-home regardless of phase.
    if (navStatus.fuel < 20 && phase !== "return") {
      log = this.logPush(log, "fuel low — diverting to base", "warn");
      phase = "return";
      await this.advancePhaseNav(phase);
    }
    // Critical systems: sound alarm in the log.
    if (engStatus.aggregate < 50) {
      log = this.logPush(log, `systems degrading (${engStatus.aggregate}%)`, "warn");
    }

    this.setState({
      ...this.state,
      cycle,
      phase,
      log,
      crew: {
        navigator: navStatus,
        scout: scoutStatus,
        engineer: engStatus,
      },
    });
  }

  async report(): Promise<State> {
    return this.state;
  }

  // -- plumbing -----------------------------------------------------------

  private async nav() {
    return getAgent<NavigatorAgent>(this.env.NAVIGATOR_AGENT, this.name);
  }
  private async scout() {
    return getAgent<ScoutAgent>(this.env.SCOUT_AGENT, this.name);
  }
  private async engineer() {
    return getAgent<EngineerAgent>(this.env.ENGINEER_AGENT, this.name);
  }

  private async advancePhase(phase: Phase): Promise<void> {
    this.setState({ ...this.state, phase });
    await this.advancePhaseNav(phase);
  }

  private async advancePhaseNav(phase: Phase): Promise<void> {
    const waypoint = WAYPOINTS[phase];
    if (!waypoint) return;
    const nav = await this.nav();
    await nav.setCourse(waypoint);
  }

  private async repairAll(): Promise<void> {
    const eng = await this.engineer();
    // Sequential — engineer.repair rejects parallel repairs in this design.
    for (const system of ["power", "lifeSupport", "comms", "hull", "drill"] as const) {
      await eng.repair(system);
    }
  }

  private append(text: string, level: LogEntry["level"]): void {
    this.setState({
      ...this.state,
      log: this.logPush(this.state.log, text, level),
    });
  }

  private logPush(
    prev: LogEntry[],
    text: string,
    level: LogEntry["level"],
  ): LogEntry[] {
    return [...prev, { at: Date.now(), text, level }].slice(-LOG_LIMIT);
  }

  override async onRequest(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      return Response.json(await this.reset());
    }
    if (request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        action?: "start" | "stop" | "reset";
      };
      if (body.action === "stop") return Response.json(await this.stop());
      if (body.action === "reset") return Response.json(await this.reset());
      // default POST = start
      return Response.json(await this.start());
    }
    return Response.json({ instance: this.name, ...this.state });
  }
}
