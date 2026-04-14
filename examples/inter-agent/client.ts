// Demo: place an order, then read both sides to show state changed across
// two Durable Objects. Run `bun run dev` in another terminal first.
//
// Starts with a DELETE to reset inventory so the run is deterministic —
// Durable Object state persists across worker restarts, which is the
// correct Cloudflare behavior but surprising for a one-shot demo.

const host = process.env.HOST ?? "http://localhost:8787";

async function hit(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(host + path, init);
  const text = await res.text();
  // Try to parse as JSON; fall back to raw text if the worker returned an
  // error page or plain-text message. This keeps the demo readable even
  // when something unexpected comes back.
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: text };
  }
}

console.log("0) reset state (inventory + customer orders) for a fresh run");
console.log(await hit("/inventory/main", { method: "DELETE" }));
console.log(await hit("/orders/customer-1", { method: "DELETE" }));
console.log(await hit("/orders/customer-2", { method: "DELETE" }));
console.log(await hit("/orders/customer-3", { method: "DELETE" }));

console.log("\n1) place order: customer-1 buys 3 widgets");
console.log(
  await hit("/orders/customer-1", {
    method: "POST",
    body: JSON.stringify({ sku: "widget", qty: 3 }),
  }),
);

console.log("\n2) place order: customer-2 buys 4 widgets");
console.log(
  await hit("/orders/customer-2", {
    method: "POST",
    body: JSON.stringify({ sku: "widget", qty: 4 }),
  }),
);

console.log("\n3) inventory state (main): widget should be 3, gadget 5");
console.log(await hit("/inventory/main"));

console.log("\n4) customer-1's orders");
console.log(await hit("/orders/customer-1"));

console.log("\n5) oversell check: widget stock is 3, try to buy 99 → 409");
console.log(
  await hit("/orders/customer-3", {
    method: "POST",
    body: JSON.stringify({ sku: "widget", qty: 99 }),
  }),
);
