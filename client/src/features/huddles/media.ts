/** Small WebAudio helpers: join/leave chimes and per-stream speaking detection. */

let ctx: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined' || !(window.AudioContext || (window as any).webkitAudioContext)) return null;
  if (!ctx || ctx.state === 'closed') {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** Two soft notes: rising for join, falling for leave. */
export function chime(kind: 'join' | 'leave') {
  const ac = audioContext();
  if (!ac) return;
  const notes = kind === 'join' ? [523.25, 783.99] : [659.25, 440];
  const t0 = ac.currentTime + 0.02;
  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t0 + i * 0.12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.08, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

/**
 * Polls AnalyserNodes for the given audio streams and reports speaking on/off per key.
 * Uses RMS with hysteresis so the indicator doesn't flicker.
 */
export class SpeakingDetector {
  private nodes = new Map<string, { src: MediaStreamAudioSourceNode; an: AnalyserNode; buf: Float32Array<ArrayBuffer>; streamId: string; trackId: string; level: number; on: boolean; quietSince: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private onChange: (key: string, speaking: boolean) => void) {}

  /** Watch the first audio track of `stream` under `key` (re-wires when the track changes). */
  watch(key: string, stream: MediaStream | null) {
    const track = stream?.getAudioTracks()[0];
    const existing = this.nodes.get(key);
    if (existing && track && existing.trackId === track.id) return;
    this.unwatch(key);
    if (!stream || !track) return;
    const ac = audioContext();
    if (!ac) return;
    try {
      const src = ac.createMediaStreamSource(new MediaStream([track]));
      const an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      this.nodes.set(key, { src, an, buf: new Float32Array(an.fftSize), streamId: stream.id, trackId: track.id, level: 0, on: false, quietSince: 0 });
    } catch { return; }
    if (!this.timer) this.timer = setInterval(() => this.tick(), 120);
  }

  unwatch(key: string) {
    const n = this.nodes.get(key);
    if (!n) return;
    try { n.src.disconnect(); } catch { /* ignore */ }
    this.nodes.delete(key);
    if (n.on) this.onChange(key, false);
  }

  private tick() {
    const now = performance.now();
    for (const [key, n] of this.nodes) {
      n.an.getFloatTimeDomainData(n.buf);
      let sum = 0;
      for (let i = 0; i < n.buf.length; i++) sum += n.buf[i] * n.buf[i];
      const rms = Math.sqrt(sum / n.buf.length);
      n.level = n.level * 0.6 + rms * 0.4;
      if (n.level > 0.02) {
        n.quietSince = 0;
        if (!n.on) { n.on = true; this.onChange(key, true); }
      } else if (n.on) {
        if (!n.quietSince) n.quietSince = now;
        else if (now - n.quietSince > 450) { n.on = false; this.onChange(key, false); }
      }
    }
  }

  stop() {
    for (const key of [...this.nodes.keys()]) this.unwatch(key);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export interface DeviceLists { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] }

export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) return { mics: [], cams: [] };
  const all = await navigator.mediaDevices.enumerateDevices();
  return { mics: all.filter((d) => d.kind === 'audioinput'), cams: all.filter((d) => d.kind === 'videoinput') };
}

export function describeMediaError(err: unknown, what: 'microphone' | 'camera' | 'screen'): string {
  const name = (err as any)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return what === 'screen' ? 'Screen sharing was cancelled or blocked.' : `Access to your ${what} was blocked. Allow it in your browser's site settings to use it.`;
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${what} was found.`;
  if (name === 'NotReadableError') return `Your ${what} is in use by another app.`;
  if (!navigator.mediaDevices) return 'Media devices need a secure connection (https or localhost).';
  return `Could not start your ${what}.`;
}
