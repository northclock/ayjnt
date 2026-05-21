/**
 * Mic → 16kHz mono int16 PCM → WebSocket pipeline.
 *
 * The Workers AI Flux STT model expects 16kHz mono 16-bit LE PCM
 * chunks. Browsers give you mic input at the AudioContext's native
 * sample rate (usually 48kHz on desktop, 16kHz on mobile) as Float32.
 * We need to convert.
 *
 * Architecture:
 *   - `AudioContext` taps the mic track via `MediaStreamSource`.
 *   - An `AudioWorklet` (running on the audio thread, not the main
 *     thread) batches samples into 4096-sample blocks and forwards
 *     them as Float32Array to the main thread via `port.postMessage`.
 *   - Main thread downsamples to 16kHz, converts to int16, and pushes
 *     the resulting `ArrayBuffer` straight onto the WebSocket as a
 *     binary frame. The room agent feeds those frames to STT.
 *
 * Why an AudioWorklet (not the legacy ScriptProcessorNode): worklets
 * run off the main thread, so audio capture doesn't stutter when the
 * UI is busy. ScriptProcessorNode is deprecated and runs on the main
 * thread — fine for prototypes, bad for video calls.
 *
 * The worklet processor is defined as a source string and loaded via
 * `URL.createObjectURL(new Blob(...))` so we don't need a separate
 * static asset file the bundler has to chase.
 */

/** Worklet processor source. Runs in the audio-worklet global scope. */
const WORKLET_SOURCE = `
  /**
   * Buffer ~4096 samples (≈85ms at 48kHz) before posting. Smaller
   * buffers add per-message overhead; larger buffers add latency.
   */
  const FRAME_SAMPLES = 4096;

  class PcmCaptureProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this._buffer = new Float32Array(FRAME_SAMPLES);
      this._cursor = 0;
    }
    process(inputs) {
      const input = inputs[0];
      if (!input || input.length === 0) return true;
      // Mono — take channel 0 only. If the mic happens to be stereo
      // we drop the second channel; close enough for STT.
      const channel = input[0];
      if (!channel) return true;
      for (let i = 0; i < channel.length; i++) {
        this._buffer[this._cursor++] = channel[i];
        if (this._cursor >= FRAME_SAMPLES) {
          // Copy out, post, reset cursor. The Float32Array slice
          // detaches a transferable from the live buffer.
          const frame = this._buffer.slice(0);
          this.port.postMessage(frame, [frame.buffer]);
          this._cursor = 0;
        }
      }
      return true;
    }
  }
  registerProcessor("pcm-capture", PcmCaptureProcessor);
`;

const TARGET_SAMPLE_RATE = 16_000;

export type AudioCaptureHandle = {
  /** Stop capture and release the AudioContext. Idempotent. */
  stop(): void;
};

/**
 * Start streaming the mic to `send(chunk)`. Each chunk is a binary
 * `ArrayBuffer` containing 16kHz mono int16 LE PCM — ready to ship as
 * a WebSocket binary frame.
 *
 * @param micTrack — mic track from `getUserMedia({ audio: true })`.
 *                   We wrap it in a MediaStream so AudioContext is happy.
 * @param send     — called on each batched chunk. Typically `ws.send`.
 */
export async function startAudioCapture(
  micTrack: MediaStreamTrack,
  send: (chunk: ArrayBuffer) => void,
): Promise<AudioCaptureHandle> {
  // Suspend until user gesture if necessary — getUserMedia gesture
  // already covers it, but be defensive.
  const ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();

  // Inject the worklet processor as a Blob URL. URL.revokeObjectURL is
  // safe to skip — the URL frees with the AudioWorklet when ctx closes.
  const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));

  const stream = new MediaStream([micTrack]);
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture");

  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    // Float32 at ctx.sampleRate → int16 at 16kHz.
    const pcm = downsampleToInt16(event.data, ctx.sampleRate, TARGET_SAMPLE_RATE);
    if (!pcm) return;
    // `Int16Array.buffer` is typed as `ArrayBufferLike` (may be a
    // SharedArrayBuffer in cross-origin-isolated contexts). Copy into a
    // fresh ArrayBuffer so the WebSocket `send` overload (which only
    // accepts non-shared buffers) is happy at the type level. The copy
    // is cheap relative to the model inference downstream.
    const out = new ArrayBuffer(pcm.byteLength);
    new Int16Array(out).set(pcm);
    send(out);
  };

  source.connect(node);
  // Worklet has no audible output — we don't connect to ctx.destination.
  // Saves the user's speakers from echo and avoids the WebAudio feedback
  // loop when audio output is also being processed elsewhere.

  return {
    stop() {
      try {
        source.disconnect();
        node.disconnect();
        node.port.close();
        void ctx.close();
      } catch {
        // Already torn down — ignore.
      }
    },
  };
}

/**
 * Float32 (any rate) → int16 (target rate) PCM resampler.
 *
 * Linear interpolation is the cheapest sane resampler. Real speech-
 * recognition pipelines use polyphase / sinc; for streaming Whisper
 * input, linear gets us 95% there at 1% the CPU. The lost
 * high-frequency fidelity matters far less than the latency we save.
 *
 * Returns `null` when the input is empty.
 */
function downsampleToInt16(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Int16Array | null {
  if (input.length === 0) return null;
  if (inputRate === outputRate) return floatToInt16(input);

  const ratio = inputRate / outputRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    // Linear interpolation between neighboring samples.
    const sample = s0 + (s1 - s0) * frac;
    // Clamp to [-1, 1] then scale to int16 range. PCM int16 doesn't
    // include +32768, so we use 0x7fff as the max to match Whisper.
    const clipped = Math.max(-1, Math.min(1, sample));
    out[i] = clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff;
  }
  return out;
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
