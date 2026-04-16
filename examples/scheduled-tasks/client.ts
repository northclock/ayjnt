// Demo: schedule a few reminders with different timings, then poll until
// they fire. Run `bun run dev` in another terminal first.

const host = process.env.HOST ?? "http://localhost:8787";
const inbox = `inbox-${Math.random().toString(36).slice(2, 8)}`;

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(host + path, init);
  return res.json();
}

console.log(`using inbox: ${inbox}\n`);

console.log("schedule three reminders…");
console.log(
  await fetchJson(`/reminder/${inbox}`, {
    method: "POST",
    body: JSON.stringify({ text: "say hi", in: 2 }),
  }),
);
console.log(
  await fetchJson(`/reminder/${inbox}`, {
    method: "POST",
    body: JSON.stringify({ text: "drink water", in: 4 }),
  }),
);
console.log(
  await fetchJson(`/reminder/${inbox}`, {
    method: "POST",
    body: JSON.stringify({
      text: "stretch",
      at: new Date(Date.now() + 6000).toISOString(),
    }),
  }),
);

console.log("\nwaiting for them to fire…");
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const state = (await fetchJson(`/reminder/${inbox}`)) as {
    pending: { text: string }[];
    fired: { text: string }[];
  };
  console.log(
    `t=${i + 1}s  pending=${state.pending.length}  fired=${state.fired
      .map((r) => r.text)
      .join(", ") || "—"}`,
  );
  if (state.pending.length === 0) break;
}
