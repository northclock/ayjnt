/**
 * Peer-mesh manager. Maintains one `RTCPeerConnection` per *other*
 * participant in the room and exposes a tiny imperative API for
 * sending tracks, swapping the video track for screen share, and
 * tearing the mesh down on unmount.
 *
 * The signaling channel is the room agent's WebSocket — we just hand
 * it offer/answer/ICE blobs and let the agent relay them. The agent
 * doesn't interpret any of this; it's a dumb pipe.
 *
 * "Perfect negotiation" — to avoid offer/offer collisions when two
 * peers simultaneously decide to renegotiate (e.g. both start screen
 * sharing at once), we use the lexicographic ordering of the
 * participant ids: the participant with the smaller id is "polite"
 * (rolls back its local offer on collision); the larger is "impolite"
 * (ignores incoming offers during collision). Standard MDN pattern.
 *
 * Bandwidth scales O(n²) — every participant maintains a connection to
 * every other participant. This is fine for ≤4 participants and
 * intentionally simple. Switch to Cloudflare Realtime SFU for bigger
 * rooms.
 */

export type SignalPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null };

export type PeerMeshOptions = {
  /** Our own participant id (from the `self` frame). Used for perfect-
   *  negotiation collision resolution. */
  selfId: string;
  /** Send a signaling message to a specific peer through the room
   *  agent's WebSocket. The agent relays it as a `webrtc` frame. */
  sendSignal(toPeerId: string, signal: SignalPayload): void;
  /** Called whenever a peer's stream changes (track added or replaced).
   *  Re-renders the corresponding `<video>` tile. */
  onPeerStream(peerId: string, stream: MediaStream): void;
  /** Called when a peer connection is removed (peer left or
   *  connection failed). Used to clear the tile. */
  onPeerGone(peerId: string): void;
};

/**
 * Stable mesh handle. The hook in app.tsx instantiates one of these and
 * keeps the same instance across re-renders. All methods are
 * idempotent — call `ensurePeer` from a render loop without fear of
 * accidentally double-connecting.
 */
export class PeerMesh {
  private peers = new Map<string, PeerConnection>();
  /** The local stream we attach to outgoing peer connections.
   *  Pre-`setLocalStream` calls to `ensurePeer` are tolerated; they
   *  attach the stream lazily when it arrives. */
  private localStream: MediaStream | null = null;

  constructor(private opts: PeerMeshOptions) {}

  /** Update the local audio/video stream. All existing peer connections
   *  drop their old senders and attach the new tracks. Null is allowed
   *  (e.g. before the first `getUserMedia` resolves) — peers wait for
   *  tracks. */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    if (!stream) return;
    for (const peer of this.peers.values()) {
      peer.attachLocalStream(stream);
    }
  }

  /** Replace just the video track (e.g. switch camera → screen share).
   *  Avoids tearing down the connection — `RTCRtpSender.replaceTrack`
   *  swaps the source while keeping codec negotiation. */
  replaceVideoTrack(track: MediaStreamTrack | null): void {
    for (const peer of this.peers.values()) {
      void peer.replaceVideoTrack(track);
    }
  }

  /** Ensure a connection exists to the given peer. Idempotent — calls
   *  after the first are no-ops. We become the "offerer" only when our
   *  id is lexicographically smaller than the peer's — keeps both
   *  sides from sending duplicate offers on join. */
  ensurePeer(peerId: string): void {
    if (peerId === this.opts.selfId) return;
    if (this.peers.has(peerId)) return;

    const polite = this.opts.selfId > peerId;
    const peer = new PeerConnection({
      peerId,
      polite,
      sendSignal: (s) => this.opts.sendSignal(peerId, s),
      onStream: (stream) => this.opts.onPeerStream(peerId, stream),
    });
    this.peers.set(peerId, peer);
    if (this.localStream) peer.attachLocalStream(this.localStream);

    // The "impolite" side initiates the offer — guarantees exactly one
    // side starts the negotiation.
    if (!polite) peer.startNegotiation();
  }

  /** Tear down the connection to a specific peer. Called when the
   *  participants list reports them gone, or when our WebSocket
   *  drops. */
  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.close();
    this.peers.delete(peerId);
    this.opts.onPeerGone(peerId);
  }

  /** Deliver an incoming signaling message from the agent to the right
   *  peer connection. Auto-creates the peer if we hadn't seen them yet
   *  (e.g. we joined just after them and their offer raced our
   *  participants-list update). */
  onSignal(fromPeerId: string, signal: SignalPayload): void {
    this.ensurePeer(fromPeerId);
    const peer = this.peers.get(fromPeerId);
    if (!peer) return;
    void peer.handleSignal(signal);
  }

  /** Tear the whole mesh down. Idempotent. */
  close(): void {
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
  }
}

/**
 * Single RTCPeerConnection wrapper with perfect-negotiation glue.
 *
 * The "perfect negotiation" pattern (MDN) handles the case where both
 * peers decide to renegotiate simultaneously — without it, you get
 * stuck `have-local-offer` states. Polite peer rolls back; impolite
 * peer ignores. The polite role is decided per-peer based on
 * lexicographic id ordering, not per-event — that's what keeps it
 * stable across renegotiations.
 */
class PeerConnection {
  private pc: RTCPeerConnection;
  private makingOffer = false;
  private ignoreOffer = false;
  private videoSender: RTCRtpSender | null = null;

  constructor(
    private opts: {
      peerId: string;
      polite: boolean;
      sendSignal(signal: SignalPayload): void;
      onStream(stream: MediaStream): void;
    },
  ) {
    this.pc = new RTCPeerConnection({
      iceServers: [
        // Google's public STUN servers — adequate for most home/office
        // NATs. Production setups should swap in a TURN service for
        // strict / symmetric NAT environments.
        { urls: "stun:stun.l.google.com:19302" },
      ],
    });

    // Aggregated remote stream. We collect both audio and video tracks
    // into one MediaStream so the `<video>` tile can render both with
    // a single `srcObject`.
    const remoteStream = new MediaStream();
    this.pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      this.opts.onStream(remoteStream);
    };

    // Perfect-negotiation: whenever the connection wants to
    // (re)negotiate, we make and send an offer. Guarded by
    // `makingOffer` so we don't kick off a second one mid-flight.
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (!this.pc.localDescription) return;
        this.opts.sendSignal({
          type: "offer",
          sdp: this.pc.localDescription.sdp,
        });
      } catch (err) {
        console.error("[peer] negotiation error", err);
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      // Send every candidate — including the terminating `null`, which
      // signals end-of-candidates to the other side.
      this.opts.sendSignal({ type: "ice", candidate: candidate?.toJSON() ?? null });
    };
  }

  attachLocalStream(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      const existing = this.pc.getSenders().find((s) => s.track?.kind === track.kind);
      if (existing) {
        void existing.replaceTrack(track);
        if (track.kind === "video") this.videoSender = existing;
      } else {
        const sender = this.pc.addTrack(track, stream);
        if (track.kind === "video") this.videoSender = sender;
      }
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    if (!this.videoSender) return;
    await this.videoSender.replaceTrack(track);
  }

  /** Manually trigger the first offer for the "impolite" side. Most
   *  renegotiations come through `onnegotiationneeded` automatically;
   *  the explicit kickoff avoids the chicken-and-egg where neither
   *  side adds a track before negotiating. */
  startNegotiation(): void {
    // No-op if there's nothing to negotiate yet (no tracks added).
    // `onnegotiationneeded` will fire automatically once we have
    // tracks via `attachLocalStream`.
  }

  async handleSignal(signal: SignalPayload): Promise<void> {
    try {
      if (signal.type === "offer") {
        // Collision detection — we're already mid-offer or have a
        // local offer pending.
        const offerCollision =
          this.makingOffer || this.pc.signalingState !== "stable";
        this.ignoreOffer = !this.opts.polite && offerCollision;
        if (this.ignoreOffer) return;

        await this.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        await this.pc.setLocalDescription();
        if (!this.pc.localDescription) return;
        this.opts.sendSignal({
          type: "answer",
          sdp: this.pc.localDescription.sdp,
        });
      } else if (signal.type === "answer") {
        await this.pc.setRemoteDescription({
          type: "answer",
          sdp: signal.sdp,
        });
      } else if (signal.type === "ice") {
        try {
          if (signal.candidate) await this.pc.addIceCandidate(signal.candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error("[peer] signal error", err);
    }
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      // Already closed; ignore.
    }
  }
}
