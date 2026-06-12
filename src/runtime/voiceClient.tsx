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
// `AyjntVoiceTransport` is a reconnecting WebSocket wrapper that connects
// to a URL we control. The codegen-generated `useVoiceAgent` hook
// (`.ayjnt/client/<route>/index.tsx`) calls into here with the route
// pre-bound, so the user just writes `useVoiceAgent({ name: "..." })`
// and the URL is right by construction.

import { useMemo } from "react";
import { useVoiceAgent as upstreamUseVoiceAgent } from "@cloudflare/voice/react";

/** Reconnect backoff: 1s, 2s, 4s, … capped at 10s, retrying indefinitely.
 *  No attempt limit on purpose: the upstream VoiceClient never re-calls
 *  connect() itself and its UI says "Reconnecting…" — a transport that
 *  gives up turns that into a permanent lie after one long outage (a
 *  locked phone is enough). The attempt counter resets only after a
 *  connection PROVES stable (open for {@link RECONNECT_STABLE_MS}), so a
 *  flapping server that accepts-then-drops keeps backing off to the cap
 *  instead of being re-dialed every second. */
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;
const RECONNECT_STABLE_MS = 5_000;
/** Exponent clamp so 2**attempts can't overflow during long outages. */
const RECONNECT_MAX_EXPONENT = 4;

/**
 * WebSocket-backed voice transport that connects to ayjnt's URL shape.
 * Structurally compatible with `VoiceTransport` from
 * `@cloudflare/voice/react` (5 methods + 4 event handlers + a `connected`
 * getter) — the nominal `implements` clause is omitted on purpose so the
 * published d.ts doesn't drag in the upstream's relative-path type
 * imports (bunup's d.ts bundler can't rewrite those).
 *
 * Like the SDK's default PartySocket transport, this one RECONNECTS:
 * `@cloudflare/voice`'s VoiceClient surfaces "Connection lost.
 * Reconnecting..." on error and then waits for the transport to come
 * back — it never calls connect() again itself. A transport without
 * reconnection turns one network blip into a permanently dead session
 * behind a UI that promises recovery. Backoff is exponential and capped
 * (see constants above); an intentional `disconnect()` cancels it.
 *
 * Exported so users who need to wire up `<VoiceClient>` manually (no
 * React) can reuse it.
 */
export class AyjntVoiceTransport {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error?: unknown) => void) | null = null;
  onmessage: ((data: string | ArrayBuffer | Blob) => void) | null = null;

  private socket: WebSocket | null = null;
  private url: string;
  private closedByUser = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.closedByUser = false;
    // Only a live (or in-flight) socket makes connect() a no-op. The old
    // check was `if (this.socket) return`, which left the transport
    // permanently dead after any server-side close: the CLOSED socket
    // stayed referenced and every reconnect attempt silently did nothing.
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByUser = true;
    // Cancel any armed reconnect — without this, a timer scheduled before
    // disconnect() would zombie-reopen the socket afterwards.
    this.clearReconnectTimer();
    this.socket?.close();
    // `this.socket` is cleared by the socket's own (identity-checked)
    // onclose handler, which also fires the public onclose callback —
    // same observable behavior an un-wrapped WebSocket would have.
  }

  private openSocket(): void {
    const socket = new WebSocket(this.url);
    socket.binaryType = "arraybuffer";
    // Every handler checks identity: a slow close/error event from a
    // socket we already replaced must not clobber the live one's state
    // or schedule a spurious reconnect.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      // Reset the backoff only once the connection has held for a while —
      // resetting on open lets an accept-then-drop server pull us back to
      // 1s dials forever.
      this.stableTimer = setTimeout(() => {
        this.stableTimer = null;
        this.reconnectAttempts = 0;
      }, RECONNECT_STABLE_MS);
      this.onopen?.();
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.stableTimer !== null) {
        clearTimeout(this.stableTimer);
        this.stableTimer = null;
      }
      this.onclose?.();
      if (!this.closedByUser) this.scheduleReconnect();
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) return;
      this.onerror?.(event);
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.onmessage?.(event.data);
    };
    this.socket = socket;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    const exponent = Math.min(this.reconnectAttempts, RECONNECT_MAX_EXPONENT);
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
 * Matches `useVoiceAgent` from `@cloudflare/voice/react` — same return
 * shape, same options minus `transport`. (One deliberate difference:
 * the reconnect backoff lives in {@link AyjntVoiceTransport} rather
 * than PartySocket.)
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

/**
 * One transport per destination URL, created DURING render (useMemo).
 *
 * Timing matters here. The upstream hook's connect/disconnect effect is
 * keyed on its own option string (agent/name/host/query…), NOT on the
 * transport object. When the instance name changes, that effect re-runs
 * in the same commit and reconnects whatever transport it sees. The old
 * implementation swapped the transport in a `useEffect` — one commit too
 * late — so the upstream effect reconnected the STALE transport to the
 * old URL and the new one never connected. Creating the transport in
 * render means the same commit that changes the name delivers the
 * matching transport.
 *
 * A memo value discarded by React holds no resources — the constructor
 * opens nothing; only connect() does (called by the upstream client).
 */
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
    // Encoded so a derived (decoded) instance name containing "/", "?" or
    // "#" can't be re-parsed as URL structure — mirrors the generated
    // useAgent hook's basePath construction.
    return `${baseProto}//${baseHost}/${prefix}/${encodeURIComponent(opts.instanceName)}`;
  }, [opts.host, opts.routePath, opts.instanceName]);

  const queryKey = JSON.stringify(opts.query ?? null);
  return useMemo(
    () => new AyjntVoiceTransport({ url, query: opts.query }),
    // query participates via its serialized form so callers can pass a
    // fresh object literal every render without churning the transport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, queryKey],
  );
}

/** Pull the instance name out of `window.location.pathname`, mirroring
 *  the generated `useAgent` hook (and the worker's matcher): segments
 *  are percent-decoded and compared segment-wise.
 *  `/voice-chat` → `"default"`, `/voice-chat/room-42` → `"room-42"`. */
function deriveInstance(routePath: string): string {
  if (typeof window === "undefined") return "default";
  const prefix = routePath.split("/").filter(Boolean);
  const segments = window.location.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  for (let i = 0; i < prefix.length; i++) {
    if (segments[i] !== prefix[i]) return "default";
  }
  return segments[prefix.length] ?? "default";
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
