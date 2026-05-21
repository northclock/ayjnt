// Browser-side voice runtime — exposes `useAyjntVoiceAgent`, a wrapper
// around `@cloudflare/voice/react`'s `useVoiceAgent` that connects via
// ayjnt's URL shape (`/<route>/<instance>`) instead of the SDK's
// default partysocket-derived path (`/agents/<kebab>/<instance>`).
//
// Background: `WebSocketVoiceTransport` from `@cloudflare/voice` uses
// PartySocket internally with `prefix: "agents"` baked in. We can't
// override that prefix through the options object — but we can supply
// a custom `VoiceTransport` to the hook, and that's what we do.
//
// `AyjntVoiceTransport` is a thin WebSocket wrapper that connects to a
// URL we control. The codegen-generated `useVoiceAgent` hook
// (`.ayjnt/client/<route>/index.tsx`) calls into here with the route
// pre-bound, so the user just writes `useVoiceAgent({ name: "..." })`
// and the URL is right by construction.

import { useEffect, useMemo, useState } from "react";
import { useVoiceAgent as upstreamUseVoiceAgent } from "@cloudflare/voice/react";

/**
 * Internal WebSocket-backed voice transport that connects to ayjnt's
 * URL shape. Implements every method of `VoiceTransport` (5 methods +
 * 4 event handlers + `connected` getter); no external dependencies
 * beyond the browser's `WebSocket` global.
 *
 * Exported so users who need to wire up `<VoiceClient>` manually (no
 * React) can reuse it. Most users get this via the generated
 * `useVoiceAgent` hook and never touch the transport directly.
 */
// Structurally compatible with `VoiceTransport` from
// `@cloudflare/voice/react` — TypeScript's nominal `implements` clause
// is omitted on purpose so the published d.ts doesn't drag in the
// upstream's relative-path type imports (bunup's d.ts bundler can't
// rewrite those). User code can still pass an instance anywhere a
// `VoiceTransport` is expected; structural typing covers it.
export class AyjntVoiceTransport {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  onmessage: ((data: string | ArrayBuffer | Blob) => void) | null = null;

  private socket: WebSocket | null = null;
  private url: string;

  constructor(options: {
    /** WebSocket URL — e.g. `wss://host/voice-chat/room-42`. */
    url: string;
    /** Query parameters appended to the URL. */
    query?: Record<string, string | null | undefined>;
  }) {
    this.url = buildUrl(options.url, options.query);
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  sendJSON(data: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  sendBinary(data: ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  connect(): void {
    if (this.socket) return;
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => this.onopen?.();
    socket.onclose = () => this.onclose?.();
    socket.onerror = (event) => this.onerror?.(event);
    socket.onmessage = (event) => this.onmessage?.(event.data);
    this.socket = socket;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }
}

/** Options for the ayjnt-flavoured voice hook.
 *
 *  We list fields explicitly (rather than re-using
 *  `Omit<UseVoiceAgentOptions, "transport">`) because bunup's d.ts
 *  bundler inlines composed types and brings along relative-path
 *  imports from `@cloudflare/voice` that don't resolve from our dist
 *  folder. Spelling the fields here keeps the published type
 *  self-contained — and the upstream surface is small enough that
 *  this list isn't burdensome.
 */
export type UseAyjntVoiceAgentOptions = {
  /** Agent class name. Set by the codegen wrapper from the agent's class. */
  agent: string;
  /** URL prefix for the voice agent. Set by the codegen wrapper. */
  routePath: string;
  /** Instance name. Defaults to the segment after the route in
   *  `window.location.pathname`, or `"default"`. */
  name?: string;
  /** Host override. Defaults to `window.location.host`. */
  host?: string;
  /** Query parameters appended to the WebSocket URL. */
  query?: Record<string, string | null | undefined>;
  /** Whether the hook should create and connect a VoiceClient. */
  enabled?: boolean;
  /** Fires when the hook reconnects after option changes. */
  onReconnect?: () => void;
};

/**
 * React hook that drives a voice conversation against an ayjnt voice
 * agent. The route prefix is supplied by the framework-generated
 * wrapper at `.ayjnt/client/<route>/index.tsx`; user code calls the
 * generated `useVoiceAgent()` without explicit URL knowledge.
 *
 * Behaviourally identical to `useVoiceAgent` from
 * `@cloudflare/voice/react` — same return shape, same options minus
 * `transport`.
 */
// Return type uses ReturnType<typeof upstreamUseVoiceAgent> rather than
// re-exporting `UseVoiceAgentReturn` directly. That route resolves the
// type at the consumer's call site (through their own copy of
// `@cloudflare/voice/react`) and sidesteps bunup's d.ts bundler — which
// otherwise inlines the upstream return shape and drags broken relative
// imports along with it.
export function useAyjntVoiceAgent(
  options: UseAyjntVoiceAgentOptions,
): ReturnType<typeof upstreamUseVoiceAgent> {
  const { routePath, name, host, query, enabled, ...rest } = options;
  const instanceName = name ?? deriveInstance(routePath);

  // Construct the URL once per (host, routePath, instanceName) tuple
  // so the transport identity stays stable across renders. Recreating
  // it on every render churns the WebSocket.
  const transport = useTransport({
    routePath,
    instanceName,
    host,
    query,
  });

  return upstreamUseVoiceAgent({
    ...rest,
    agent: options.agent,
    name: instanceName,
    host,
    query,
    enabled,
    transport,
  });
}

/** Construct a transport that survives across renders for the same
 *  destination URL. Disconnects + recreates when any URL component
 *  changes. */
function useTransport(opts: {
  routePath: string;
  instanceName: string;
  host?: string;
  query?: Record<string, string | null | undefined>;
}): AyjntVoiceTransport {
  const url = useMemo(() => {
    const baseHost =
      opts.host ??
      (typeof window !== "undefined" ? window.location.host : "localhost");
    const baseProto =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "wss:"
        : "ws:";
    const prefix = opts.routePath.replace(/^\//, "");
    return `${baseProto}//${baseHost}/${prefix}/${opts.instanceName}`;
  }, [opts.host, opts.routePath, opts.instanceName]);

  // Re-create the transport when the URL changes. The voice hook
  // owns connect/disconnect — we just hand it an instance.
  const [transport, setTransport] = useState(
    () => new AyjntVoiceTransport({ url, query: opts.query }),
  );
  useEffect(() => {
    setTransport(new AyjntVoiceTransport({ url, query: opts.query }));
    // The replaced transport is connected by the upstream hook in a
    // separate effect; the old one is disconnected when the hook tears
    // it down. No explicit cleanup needed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, JSON.stringify(opts.query)]);
  return transport;
}

/** Pull the instance name out of `window.location.pathname`, mirroring
 *  the `useAgent` hook's behaviour. `/voice-chat` → `"default"`,
 *  `/voice-chat/room-42` → `"room-42"`. */
function deriveInstance(routePath: string): string {
  if (typeof window === "undefined") return "default";
  const p = window.location.pathname;
  if (p !== routePath && !p.startsWith(routePath + "/")) return "default";
  const remainder = p.slice(routePath.length);
  const parts = remainder.split("/").filter(Boolean);
  return parts[0] ?? "default";
}

/** Append query params to a URL. Returns the URL unchanged when the
 *  query is empty / null-only. */
function buildUrl(
  baseUrl: string,
  query?: Record<string, string | null | undefined>,
): string {
  if (!query) return baseUrl;
  const entries = Object.entries(query).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === "string" && entry[1].length > 0,
  );
  if (entries.length === 0) return baseUrl;
  const params = new URLSearchParams(entries);
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${params.toString()}`;
}
