// Demo: start a heartbeat at 2s, watch a few ticks come in via polling,
// then stop it. Run `bun run dev` in another terminal first. The same
// instance is also visible in the browser at the same URL — open
// http://localhost:8787/heartbeat/demo to see the live bar chart.

const host = process.env.HOST ?? "http://localhost:8787";
const id = "demo";

async function fetchJson(path: string, init?: RequestInit) {
  const res = await fetch(host + path, init);
  return res.json();
}

console.log("reset state…");
console.log(await fetchJson(`/heartbeat/${id}`, { method: "DELETE" }));

console.log("\nstart ticking every 2 seconds…");
console.log(
  await fetchJson(`/heartbeat/${id}`, {
    method: "POST",
    body: JSON.stringify({ intervalSeconds: 2 }),
  }),
);

for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const state = (await fetchJson(`/heartbeat/${id}`)) as {
    ticks: { n: number; load: number }[];
  };
  const last = state.ticks[0];
  console.log(
    `t=${i + 1}s  ticks=${state.ticks.length}  last=${
      last ? `#${last.n} load ${last.load}%` : "—"
    }`,
  );
}

console.log("\nstop ticking…");
console.log(
  await fetchJson(`/heartbeat/${id}`, {
    method: "POST",
    body: JSON.stringify({ stop: true }),
  }),
);
