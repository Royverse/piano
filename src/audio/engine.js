// The Web Audio side: plays rendered notes, damps them, and runs the room.
import { renderNote, VOICES } from './synth.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

// The top of a real piano has no dampers, so those strings ring on.
export const FIRST_UNDAMPED = 89;
const MAX_VOICES = 72;
const CACHE_LIMIT = 180;

export const ROOMS = {
  close: { label: 'Close', seconds: 0.9, wet: 0.13, damping: 5 },
  room: { label: 'Room', seconds: 1.8, wet: 0.24, damping: 3.2 },
  hall: { label: 'Hall', seconds: 3.4, wet: 0.34, damping: 2 },
};

// How much a hard strike opens up the tone, per voice (cutoff = f0 × factor).
const BRIGHTNESS = {
  grand: { base: 3, range: 40, max: 18000 },
  felt: { base: 2, range: 13, max: 6500 },
  electric: { base: 4, range: 28, max: 14000 },
  celesta: { base: 12, range: 40, max: 18000 },
};

export class Engine {
  constructor() {
    // An instrument should sound even when an iPhone's silent switch is on.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.voice = 'grand';
    this.detune = () => 0;
    this.buffers = new Map();
    this.queue = [];
    this.inFlight = null;
    this.playing = [];
    this.sympathetic = [];
    this.pedal = false;
    this.listeners = new Set();

    this.#buildGraph();
    this.#startWorker();
  }

  /* ------------------------------------------------------------ graph */

  #buildGraph() {
    const { ctx } = this;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 10;
    limiter.ratio.value = 3.5;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.send = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.dry.connect(this.master);
    this.send.connect(this.reverb).connect(this.master);

    // One bus per voice so the electric piano can have its stereo tremolo.
    this.buses = {};
    for (const id of Object.keys(VOICES)) {
      const bus = ctx.createGain();
      if (id === 'electric') {
        const pan = ctx.createStereoPanner();
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 4.3;
        depth.gain.value = 0.45;
        lfo.connect(depth).connect(pan.pan);
        lfo.start();
        bus.connect(pan);
        pan.connect(this.dry);
        pan.connect(this.send);
      } else {
        bus.connect(this.dry);
        bus.connect(this.send);
      }
      this.buses[id] = bus;
    }

    // Sympathetic resonance goes mostly to the room, like a soundboard bloom.
    this.bloom = ctx.createGain();
    this.bloom.gain.value = 0.6;
    this.bloom.connect(this.send);
    this.bloom.connect(this.dry);

    this.noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));

    this.setRoom('room');
  }

  setRoom(id) {
    const room = ROOMS[id] ?? ROOMS.room;
    this.room = room;
    this.reverb.buffer = impulse(this.ctx, room.seconds, room.damping);
    this.send.gain.setTargetAtTime(this.#wetLevel(), this.ctx.currentTime, 0.05);
  }

  #wetLevel() {
    // Lifting the dampers lets the whole instrument resonate a little more.
    return this.room.wet * (this.pedal ? 1.25 : 1);
  }

  setVolume(v) {
    this.master.gain.setTargetAtTime(clamp(v, 0, 1) * 0.9, this.ctx.currentTime, 0.03);
  }

  /** `fn(midi) → cents`, e.g. just intonation relative to the key. */
  setDetune(fn) {
    this.detune = fn ?? (() => 0);
  }

  async resume() {
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { /* resumes on the next gesture */ }
    }
    return this.ctx.state === 'running';
  }

  get running() {
    return this.ctx.state === 'running';
  }

  /* ---------------------------------------------------------- buffers */

  #startWorker() {
    try {
      this.worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = ({ data }) => {
        this.#store(data.voice, data.midi, data.samples, data.rate);
        this.inFlight = null;
        this.#pump();
      };
      this.worker.onerror = () => { this.worker = null; this.inFlight = null; };
    } catch {
      this.worker = null;
    }
  }

  #store(voice, midi, samples, rate) {
    const key = `${voice}:${midi}`;
    if (this.buffers.has(key)) return this.buffers.get(key);
    const buffer = this.ctx.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    this.buffers.set(key, buffer);
    if (this.buffers.size > CACHE_LIMIT) {
      for (const k of this.buffers.keys()) {
        if (!k.startsWith(`${this.voice}:`)) { this.buffers.delete(k); break; }
      }
    }
    this.#emit({ type: 'ready', voice, midi });
    return buffer;
  }

  /** Render these notes in the background, first ones first. */
  prepare(midis) {
    this.queue = midis.filter((m) => !this.buffers.has(`${this.voice}:${m}`)).map((m) => [this.voice, m]);
    this.#pump();
  }

  #pump() {
    if (this.inFlight) return;
    while (this.queue.length) {
      const [voice, midi] = this.queue.shift();
      if (this.buffers.has(`${voice}:${midi}`)) continue;
      if (!this.worker) {
        // No worker: render between frames instead.
        const run = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 16));
        this.inFlight = [voice, midi];
        run(() => {
          const { samples, rate } = renderNote(voice, midi, this.ctx.sampleRate);
          this.#store(voice, midi, samples, rate);
          this.inFlight = null;
          this.#pump();
        });
        return;
      }
      this.inFlight = [voice, midi];
      this.worker.postMessage({ voice, midi, sampleRate: this.ctx.sampleRate });
      return;
    }
  }

  #buffer(voice, midi) {
    const key = `${voice}:${midi}`;
    const hit = this.buffers.get(key);
    if (hit) {
      // Keep recently played notes at the back of the eviction order.
      this.buffers.delete(key);
      this.buffers.set(key, hit);
      return hit;
    }
    const { samples, rate } = renderNote(voice, midi, this.ctx.sampleRate);
    return this.#store(voice, midi, samples, rate);
  }

  setVoice(id) {
    if (!VOICES[id]) return;
    this.voice = id;
  }

  /* ------------------------------------------------------------ notes */

  noteOn(midi, velocity = 0.7, at = 0) {
    const { ctx } = this;
    const voiceId = this.voice;
    const when = Math.max(at, ctx.currentTime);
    const buffer = this.#buffer(voiceId, midi);

    // Restriking a string that is still ringing: let the old sound go quickly.
    for (const v of this.playing) {
      if (v.midi === midi && !v.gone) this.#fade(v, when, 0.03);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const cents = this.detune(midi);
    if (src.detune) src.detune.value = cents;
    else src.playbackRate.value = 2 ** (cents / 1200);

    const b = BRIGHTNESS[voiceId];
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0;
    filter.frequency.value = clamp(freqOf(midi) * (b.base + b.range * velocity * velocity), 350, b.max);

    const vca = ctx.createGain();
    vca.gain.value = 0.06 + 0.94 * velocity ** 1.7;

    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp((midi - 64) / 64, -1, 1) * 0.45;

    src.connect(filter).connect(vca).connect(pan).connect(this.buses[voiceId]);
    src.start(when);
    const voice = { midi, voiceId, src, vca, released: false, gone: false, start: when };
    src.onended = () => {
      voice.gone = true;
      pan.disconnect();
      this.playing = this.playing.filter((v) => v !== voice);
    };
    this.playing.push(voice);

    if (this.pedal && VOICES[voiceId].kind === 'piano') this.#resonate(midi, velocity, when, cents);

    // Voice stealing: fade whatever has been ringing longest.
    const live = this.playing.filter((v) => !v.gone);
    if (live.length > MAX_VOICES) {
      const oldest = live.find((v) => v.released) ?? live[0];
      this.#fade(oldest, when, 0.05);
    }
  }

  /** Drop the damper back onto the string. */
  noteOff(midi, at = 0) {
    const when = Math.max(at, this.ctx.currentTime);
    for (const v of this.playing) {
      if (v.midi !== midi || v.released || v.gone) continue;
      v.released = true;
      const kind = VOICES[v.voiceId].kind;
      if (kind === 'piano' && midi >= FIRST_UNDAMPED) continue;
      const tau = kind === 'electric' ? 0.07 : kind === 'celesta' ? 0.12 : clamp(0.28 - (midi - 21) * 0.0028, 0.06, 0.28);
      this.#fade(v, when, tau);
      if (v.voiceId === 'felt') this.#damperNoise(midi, when);
    }
  }

  #fade(v, when, tau) {
    v.released = true;
    v.vca.gain.cancelScheduledValues(when);
    v.vca.gain.setTargetAtTime(0, when, tau);
    try { v.src.stop(when + tau * 9); } catch { /* already stopped */ }
  }

  // The soft knock of felt returning to the string.
  #damperNoise(midi, when) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = clamp(freqOf(midi) * 2, 250, 1400);
    band.Q.value = 1.4;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    src.connect(band).connect(g).connect(this.buses.felt);
    src.start(when);
  }

  // With the dampers up, strings tuned to this note's overtones ring along.
  #resonate(midi, velocity, when, cents) {
    const f0 = freqOf(midi) * 2 ** (cents / 1200);
    for (const k of [2, 3, 4]) {
      const f = f0 * k;
      if (f > 4500) break;
      const osc = this.ctx.createOscillator();
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime((0.02 * velocity) / k, when + 0.15);
      g.gain.setTargetAtTime(0, when + 0.15, 1.4);
      osc.connect(g).connect(this.bloom);
      osc.start(when);
      osc.stop(when + 7);
      const entry = { osc, g };
      osc.onended = () => { g.disconnect(); this.sympathetic = this.sympathetic.filter((e) => e !== entry); };
      this.sympathetic.push(entry);
    }
  }

  setPedal(down) {
    this.pedal = down;
    const now = this.ctx.currentTime;
    this.send.gain.setTargetAtTime(this.#wetLevel(), now, 0.2);
    if (!down) {
      for (const { g } of this.sympathetic) {
        g.gain.cancelScheduledValues(now);
        g.gain.setTargetAtTime(0, now, 0.08);
      }
    }
  }

  /** Silence everything at once (e.g. when the page is hidden). */
  panic() {
    const now = this.ctx.currentTime;
    for (const v of this.playing) this.#fade(v, now, 0.05);
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(event) {
    for (const fn of this.listeners) fn(event);
  }
}

// A synthetic room: decorrelated noise that darkens as it decays, plus a few
// early reflections. Cheap to make, and no files to download.
export function impulse(ctx, seconds, damping) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp((-6.9 * t) / seconds) * Math.min(1, t / 0.006);
      const a = 0.08 + 0.8 * Math.exp(-t * damping);
      lp += a * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(rate * (0.007 + Math.random() * 0.05));
      d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 10);
    }
  }
  return buffer;
}
