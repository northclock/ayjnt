// Root middleware — applies to every request under agents/.
// Logs the request and adds a timing header. Always calls next().

import type { Middleware } from "ayjnt/middleware";

const middleware: Middleware = async (c, next) => {
  const start = Date.now();
  console.log(`${c.request.method} ${c.url.pathname}`);
  const res = await next();
  const elapsed = Date.now() - start;

  // Can't mutate the stream body here without consuming it — just clone
  // headers onto a new Response so the timing header is visible upstream.
  const headers = new Headers(res.headers);
  headers.set("x-response-time-ms", String(elapsed));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
};

export default middleware;
