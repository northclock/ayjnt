// Demonstrates the middleware chain by hitting each route with different
// auth. Run `bun run dev` in another terminal first.

const host = process.env.HOST ?? "http://localhost:8787";

async function hit(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(host + path, { headers });
  const body = await res.text();
  return {
    status: res.status,
    timeMs: res.headers.get("x-response-time-ms"),
    body,
  };
}

console.log("1) public route, no auth:");
console.log(await hit("/public/status/demo"));

console.log("\n2) admin route, no auth → 403:");
console.log(await hit("/admin/users/bob"));

console.log("\n3) admin route, bearer auth → 200:");
console.log(
  await hit("/admin/users/bob", { authorization: "Bearer letmein" }),
);
