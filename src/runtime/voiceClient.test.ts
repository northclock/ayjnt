// AyjntVoiceTransport reconnect state machine.
//
// The upstream @cloudflare/voice VoiceClient never re-calls connect()
// itself — its UI shows "Connection lost. Reconnecting..." and waits for
// the transport. These tests pin the four behaviors that make that
// promise true: dead sockets are replaced, unintentional closes reconnect
// with capped backoff (indefinitely), intentional disconnects cancel any
// armed reconnect, and events from replaced sockets can't clobber state.
//
// WebSocket and the timer globals are stubbed; timers fire manually.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AyjntVoiceTransport } from "./voiceClient.tsx";

class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = 0;
  binaryType = "";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: unknown): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSING;
    // The real socket fires close asynchronously; tests call serverClose()
    // explicitly when they want the event.
  }

  // test helpers
  serverOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

type CapturedTimer = { id: number; cb: () => void; delay: number; cleared: boolean };

let timers: CapturedTimer[];
let realWebSocket: unknown;
let realSetTimeout: typeof setTimeout;
let realClearTimeout: typeof clearTimeout;

beforeEach(() => {
  FakeWebSocket.instances = [];
  timers = [];
  realWebSocket = (globalThis as Record<string, unknown>)["WebSocket"];
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  (globalThis as Record<string, unknown>)["WebSocket"] = FakeWebSocket;
  let nextId = 1;
  globalThis.setTimeout = ((cb: () => void, delay?: number) => {
    const t = { id: nextId++, cb, delay: delay ?? 0, cleared: false };
    timers.push(t);
    return t.id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: number | object) => {
    const t = timers.find((x) => x.id === id);
    if (t) t.cleared = true;
  }) as unknown as typeof clearTimeout;
});

afterEach(() => {
  (globalThis as Record<string, unknown>)["WebSocket"] = realWebSocket;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
});

const pendingTimers = () => timers.filter((t) => !t.cleared && !(t as { fired?: boolean }).fired);
const fire = (t: CapturedTimer) => {
  (t as { fired?: boolean }).fired = true;
  t.cb();
};

describe("AyjntVoiceTransport", () => {
  test("REGRESSION: connect() after a server-side close opens a NEW socket", () => {
    // Old code: `if (this.socket) return` — after any close the dead
    // socket stayed referenced and reconnection was impossible forever.
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();
    const a = FakeWebSocket.instances[0]!;
    a.serverOpen();
    expect(t.connected).toBe(true);

    a.serverClose();
    expect(t.connected).toBe(false);

    t.connect();
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1]!.serverOpen();
    expect(t.connected).toBe(true);
  });

  test("unintentional close auto-reconnects with capped backoff, indefinitely", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();

    const observedDelays: number[] = [];
    // 12 close-without-stability cycles: 1s, 2s, 4s, 8s, then 10s forever —
    // and crucially it NEVER stops scheduling (the old 8-attempt cap left
    // the session dead behind a UI that said "Reconnecting…").
    for (let i = 0; i < 12; i++) {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.serverClose();
      const armed = pendingTimers();
      expect(armed).toHaveLength(1);
      observedDelays.push(armed[0]!.delay);
      fire(armed[0]!);
    }
    expect(observedDelays).toEqual([
      1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000,
    ]);
  });

  test("backoff resets only after the connection holds for the stability window", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();

    // Two flaps → backoff is at 4s next.
    for (const expected of [1000, 2000]) {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.serverClose();
      const armed = pendingTimers();
      expect(armed[0]!.delay).toBe(expected);
      fire(armed[0]!);
    }

    // Now the connection opens AND holds: the 5s stability timer fires.
    const stable = FakeWebSocket.instances.at(-1)!;
    stable.serverOpen();
    const stabilityTimer = pendingTimers().find((x) => x.delay === 5000)!;
    expect(stabilityTimer).toBeDefined();
    fire(stabilityTimer);

    // Next drop starts the ladder from 1s again.
    stable.serverClose();
    expect(pendingTimers()[0]!.delay).toBe(1000);
  });

  test("accept-then-drop flapping does NOT reset the backoff (no stability)", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();

    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const socket = FakeWebSocket.instances.at(-1)!;
      socket.serverOpen(); // accepted…
      socket.serverClose(); // …and dropped before the 5s stability timer fires
      const reconnect = pendingTimers().find((x) => x.delay !== 5000)!;
      delays.push(reconnect.delay);
      fire(reconnect);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  test("disconnect() cancels an armed reconnect — no zombie reopen", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();
    FakeWebSocket.instances[0]!.serverClose(); // arms a reconnect
    const armed = pendingTimers()[0]!;

    t.disconnect();
    expect(timers.find((x) => x.id === armed.id)!.cleared).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  test("events from a replaced socket can't clobber the live one", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    let closeCalls = 0;
    t.onclose = () => closeCalls++;

    t.connect();
    const a = FakeWebSocket.instances[0]!;
    a.serverClose(); // live close → callback + reconnect armed
    expect(closeCalls).toBe(1);
    fire(pendingTimers()[0]!); // reconnect → socket B
    const b = FakeWebSocket.instances[1]!;
    b.serverOpen();

    // A late close event from the replaced socket A: no callback, no
    // reconnect scheduling, and B stays the live socket.
    const timersBefore = pendingTimers().length;
    a.serverClose();
    expect(closeCalls).toBe(1);
    expect(pendingTimers().length).toBe(timersBefore);
    expect(t.connected).toBe(true);
  });

  test("send helpers are no-ops while not OPEN", () => {
    const t = new AyjntVoiceTransport({ url: "ws://x/chat/main" });
    t.connect();
    t.sendJSON({ a: 1 }); // CONNECTING — dropped
    const socket = FakeWebSocket.instances[0]!;
    socket.serverOpen();
    t.sendJSON({ a: 2 });
    expect(socket.sent).toEqual(['{"a":2}']);
  });
});
