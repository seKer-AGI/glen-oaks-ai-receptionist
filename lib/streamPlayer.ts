
/**
 * Plays mp3 chunks while they are still arriving (MediaSource), and falls back to
 * "collect everything, then play" in browsers without MSE support for audio/mpeg.
 */
export class StreamingPlayer {
  private audio = new Audio();
  private url = "";
  private chunks: Uint8Array[] = [];
  private queue: Uint8Array[] = [];
  private sb: SourceBuffer | null = null;
  private ms: MediaSource | null = null;
  private finished = false;
  private stopped = false;
  private readonly mse: boolean;

  constructor(
    private mime: string,
    private onEnded: () => void,
    private onStart: () => void,
  ) {
    this.mse = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
    this.audio.onended = () => this.done();
    this.audio.onerror = () => this.done();
    if (this.mse) {
      this.ms = new MediaSource();
      this.url = URL.createObjectURL(this.ms);
      this.audio.src = this.url;
      this.ms.addEventListener("sourceopen", () => {
        if (this.stopped || !this.ms) return;
        this.sb = this.ms.addSourceBuffer("audio/mpeg");
        this.sb.addEventListener("updateend", () => this.pump());
        this.pump();
      });
    }
  }

  private done() {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    this.onEnded();
  }

  private cleanup() {
    this.audio.onended = null;
    this.audio.onerror = null;
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.audio.removeAttribute("src");
  }

  private pump() {
    if (this.stopped || !this.sb || this.sb.updating) return;
    const next = this.queue.shift();
    if (next) {
      try {
        this.sb.appendBuffer(next as BufferSource);
      } catch {
        this.done();
      }
    } else if (this.finished && this.ms?.readyState === "open") {
      try {
        this.ms.endOfStream();
      } catch {
        /* already ended */
      }
    }
  }

  private started = false;
  private begin() {
    if (this.started) return;
    this.started = true;
    this.onStart();
    this.audio.play().catch(() => this.done());
  }

  push(b64: string) {
    if (this.stopped) return;
    const bytes = new Uint8Array(b64ToBytes(b64));
    if (this.mse) {
      this.queue.push(bytes);
      this.pump();
      this.begin();
    } else {
      this.chunks.push(bytes);
    }
  }

  end() {
    if (this.stopped) return;
    this.finished = true;
    if (this.mse) {
      this.pump();
      if (!this.started) this.done(); // no audio arrived
    } else if (this.chunks.length) {
      const blob = new Blob(this.chunks as BlobPart[], { type: this.mime });
      this.url = URL.createObjectURL(blob);
      this.audio.src = this.url;
      this.begin();
    } else {
      this.done();
    }
  }

  /** Immediately silences playback (barge-in / end of call). */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
  }
}

function b64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

