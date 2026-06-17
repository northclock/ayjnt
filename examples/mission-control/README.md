# ayjnt example: mission-control

A four-agent collaborative system simulating an asteroid-mining mission. Each crew role is its own Durable Object with its own UI — click into any of them to see that role's stats, or watch the big picture from the commander's dashboard. Multi-agent orchestration, typed RPC, shared middleware, and per-agent React UIs all in one example.

```
agents/
  (mission)/
    middleware.ts              ← mission-id validation + request id, shared by all crew
    commander/
      agent.ts                 ← tick loop → calls nav/scout/engineer every 2s
      app.tsx                  ← mission dashboard at /commander/:id
    navigator/
      agent.ts                 ← position/fuel, setCourse(target), tick()
      app.tsx                  ← radar UI at /navigator/:id
    scout/
      agent.ts                 ← sensor sweeps, threat level, scan()
      app.tsx                  ← contacts UI at /scout/:id
    engineer/
      agent.ts                 ← 5 systems with health, repair(system), degrade()
      app.tsx                  ← health dashboard at /engineer/:id
```

## Scaffold

```sh
bunx ayjnt new my-mission
cd my-mission
rm -rf agents/counter
mkdir -p "agents/(mission)/commander" "agents/(mission)/navigator" \
         "agents/(mission)/scout" "agents/(mission)/engineer"
# copy the eight agent/app files + middleware.ts from this example
bun install
```

## Run

```sh
bun run dev

# all four agents share the mission id in the URL — use the same id across tabs
open http://localhost:8787/commander/apollo   # dashboard — click "ENGAGE"
open http://localhost:8787/navigator/apollo   # radar
open http://localhost:8787/scout/apollo       # contacts
open http://localhost:8787/engineer/apollo    # systems
```

Click **ENGAGE** on the commander tab. The crew agents start reporting real values:

- navigator moves toward a waypoint, fuel ticks down
- scout scans every 3 commander-ticks and adds contacts
- engineer degrades one random system per tick
- commander log streams phase transitions

The commander advances through `idle → survey → approach → extract → return → done` based on navigator arrival. If fuel drops below 20%, the commander diverts to the return phase early — cross-agent coordination in a single callback.

## How the orchestration works

```
                              every 2s (scheduleEvery)
                                      │
                                      ▼
   ┌────────────────────────── CommanderAgent ───────────────────────────┐
   │                                                                      │
   │  async tick() {                                                      │
   │    const nav = await getAgent<NavigatorAgent>(env.NAVIGATOR, id);    │
   │    const scout = await getAgent<ScoutAgent>(env.SCOUT, id);          │
   │    const eng = await getAgent<EngineerAgent>(env.ENGINEER, id);      │
   │                                                                      │
   │    const navStatus = await nav.tick();      // typed RPC             │
   │    const engStatus = await eng.degrade();   // typed RPC             │
   │    const scoutStatus = cycle % 3 === 0                               │
   │        ? await scout.scan()                                          │
   │        : await scout.report();                                       │
   │                                                                      │
   │    this.setState({                                                   │
   │      phase: advancePhaseIfArrived(...),                              │
   │      crew: { navigator: navStatus, scout: scoutStatus,               │
   │              engineer: engStatus }                                   │
   │    });                                                               │
   │  }                                                                   │
   │                                                                      │
   └──────────────────────────────────────────────────────────────────────┘
        │                │                                │
        ▼                ▼                                ▼
 NavigatorAgent   ScoutAgent                       EngineerAgent
 (DO, own state)  (DO, own state)                  (DO, own state)
 /navigator/:id   /scout/:id                       /engineer/:id
 own React UI     own React UI                     own React UI
```

`getAgent<T>(namespace, id)` returns a **typed DO stub**. `nav.tick()`, `scout.scan()`, `eng.repair("power")` all autocomplete — rename the method in the callee, the caller breaks at compile time. Methods are real Workers RPC; exceptions propagate across the boundary cleanly.

All four agents share the same mission id (`this.name`) as the DO instance name. That's the hook that ties them together: when you navigate to `/commander/apollo`, it talks to `/navigator/apollo`, `/scout/apollo`, `/engineer/apollo` — all ids match, all are isolated from `/commander/luna` etc.

## Shared middleware

```
agents/
  (mission)/
    middleware.ts    ← runs for every /commander/:id, /navigator/:id, /scout/:id, /engineer/:id
```

The `(mission)` folder is a **route group** — parens strip it from the URL, so `/commander/:id` still works. But the middleware applies to every descendant. In this example it:

1. validates that `instanceId` is a valid mission id (alphanumeric + dash, ≤ 40 chars)
2. assigns a request id via `c.set("reqId", ...)` and echoes it in a response header
3. logs the request

If you wanted auth, password-gating the whole mission subtree is two lines here:

```ts
if (c.request.headers.get("authorization") !== `Bearer ${c.env.MISSION_TOKEN}`) {
  return c.text("forbidden", 403);
}
```

## Why each agent has its own UI

One reason: **you can't fit a satisfying UI for four roles on a single screen**. Each role has its own dense view — a radar for navigator, a contact log + threat gauge for scout, five health bars for engineer. Splitting by agent also demonstrates:

- The generated `useAgent()` hook is **per-agent typed**. `@ayjnt/navigator` gives you NavigatorAgent's State; `@ayjnt/engineer` gives you EngineerAgent's State. No type overlap, no casting.
- Each URL is a separate DO instance with its own WebSocket. Opening `/navigator/apollo` connects only to NavigatorAgent, not the others.
- State updates fan out automatically. When commander's tick calls `engineer.degrade()`, EngineerAgent's setState fires — and every tab at `/engineer/apollo` re-renders.

## What the application should look like

```
┌─────────────────────────── /commander/apollo ───────────────────────────┐
│ MISSION CONTROL   APOLLO                                 [ENGAGE] [reset]│
│ survey-and-extract · cycle 7 · APPROACH                                  │
├──────────────────────────────────────────────────────────────────────────┤
│  ┌ NAVIGATOR ↗ ──┐  ┌ SCOUT ↗ ─────┐  ┌ ENGINEER ↗ ─┐                    │
│  │ 87.3%         │  │ 34%          │  │ 78%         │                    │
│  │ fuel          │  │ threat       │  │ health      │                    │
│  │ en route →    │  │ 5 contact(s) │  │ 2 repair(s) │                    │
│  │ 80.0, 30.0,-5 │  │              │  │             │                    │
│  └───────────────┘  └──────────────┘  └─────────────┘                    │
├──────────────────────────────────────────────────────────────────────────┤
│ mission log                                                              │
│   14:32:18  phase → approach                                             │
│   14:32:16  systems degrading (68%)                                      │
│   14:32:12  phase → survey                                               │
│   14:32:10  mission engaged                                              │
└──────────────────────────────────────────────────────────────────────────┘

┌─────── /navigator/apollo ──────┐   ┌──── /scout/apollo ────┐
│ ┌──────── radar ────────────┐  │   │ threat: 34%           │
│ │ ○ BASE  ○ TARGET  ━━━▶    │  │   │ ████████▁▁▁▁▁▁▁▁▁▁    │
│ │           ship trail …    │  │   │ [scan now] [clear]    │
│ └───────────────────────────┘  │   │                       │
│ POS 51.2, 18.7  FUEL 87.3%     │   │ contacts              │
│ TGT 80.0, 30.0  STATUS EN-RTE  │   │ • hostile  14.2u 204° │
└────────────────────────────────┘   │ • asteroid 18.8u 312° │
                                     │ • signal    6.1u 115° │
┌────────────────── /engineer/apollo ──────────────────┐
│ aggregate 78%    repairs 2                           │
│ ┌ power ┐ ┌ life support ┐ ┌ comms ┐ ┌ hull ┐ ...    │
│ │ 71%   │ │ 58%          │ │ 92%   │ │ 100% │        │
│ │ ████▆ │ │ ███▂▂▂       │ │ █████ │ │ █████│        │
│ │[repair]│ │[repair]     │ │[nom..│ │[nom..│        │
│ └───────┘ └──────────────┘ └───────┘ └──────┘        │
└──────────────────────────────────────────────────────┘
```

Everything updates live as the commander's tick loop runs.

## Pitfalls

- **`getAgent<T>` per tick is not free.** Each call is an idempotent handshake + RPC round-trip. Fine at 0.5Hz, wouldn't be fine at 30Hz. For per-frame updates to many agents, push work into the callees and aggregate lazily.
- **Every agent has its own DO lifecycle.** If one agent crashes, the others keep going — this is good (isolation) but also means you can't rely on "everyone reset together" — the commander's reset() explicitly walks the crew and calls their reset methods.
- **Mission id must match across URLs.** `/commander/apollo` and `/scout/luna` don't talk to each other. The middleware validates shape but not pairing.

## Deploy

```sh
bun run deploy
# share a single mission URL — /commander/<id> — with the team; they
# can drill into /navigator/<same-id> etc. at will.
```

## See also

- [`examples/inter-agent`](../inter-agent) — the two-agent RPC pattern this builds on
- [`examples/middleware`](../middleware) — route groups and middleware chaining
- [`examples/recurring-tasks`](../recurring-tasks) — `scheduleEvery` that drives the commander tick
