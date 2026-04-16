// Workers AI calls via the public REST API. We can't use the AI binding
// because ayjnt's wrangler.jsonc generation doesn't support custom bindings
// yet (planned for a later rev). The HTTP API works fine — just slightly
// chattier than a binding call.
//
// Set CF_ACCOUNT_ID + CF_API_TOKEN in .dev.vars for local dev, or via
// `wrangler secret put` for deploy. The token needs the
// "Workers AI: Read" permission.

type AiEnv = {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
};

export async function runWorkersAi<T = unknown>(
  env: AiEnv,
  model: string,
  body: unknown,
): Promise<T> {
  const acct = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;
  if (!acct || !token) {
    throw new Error(
      "CF_ACCOUNT_ID and CF_API_TOKEN must be set (see .dev.vars.example)",
    );
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${model}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Workers AI ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { result?: T; success?: boolean };
  if (!json.success || json.result === undefined) {
    throw new Error(
      `Workers AI returned non-success: ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json.result;
}
