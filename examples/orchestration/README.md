# Research team orchestration

A lead agent delegates source reading to a researcher, sends the findings to an
independent reviewer, and synthesizes the accepted facts into a brief. The UI
shows each handoff instead of hiding orchestration behind one spinner.

```sh
bun install
bun run dev
```

Open `/lead/demo` and submit one or more public URLs. Each agent has separate
durable state and a narrow typed RPC contract. Replace the deterministic
extraction and review logic with models when you want probabilistic reasoning;
the orchestration shape stays the same.
