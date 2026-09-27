// A string orchestra, synthesised live. Each section is a handful of
// slightly detuned bowed "players" (sawtooth oscillators — a bowed string's
// waveform is close to one), each with its own vibrato and drift, shaped by
// violin-family body resonances, a bow-pressure filter and a little rosin
// noise, then placed in a concert hall.
import { impulse } from './engine.js';
import { SECTIONS } from '../conduct/score.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

// players: how many oscillators; spread: their detune in cents;
// vibrato: [rate Hz, depth cents]; body: resonances [Hz, dB].
const SPECS = {
  basses: { players: 2, spread: 8, vibrato: [4.8, 7], pan: -0.5, level: 0.62, body: [[95, 3], [240, 2], [1100, 2]], bright: 0.5 },
  cellos: { players: 3, spread: 9, vibrato: [5.3, 10], pan: -0.28, level: 0.5, body: [[150, 3], [420, 2], [2000, 3]], bright: 0.68 },
  violas: { players: 3, spread: 10, vibrato: [5.6, 11], pan: 0, level: 0.38, body: [[240, 3], [560, 2], [2500, 3]], bright: 0.8 },
  violins2: { players: 3, spread: 11, vibrato: [5.8, 12], pan: 0.22, level: 0.34, body: [[285, 3], [500, 2], [3000, 4]], bright: 0.9 },
  violins1: { players: 4, spread: 12, vibrato: [5.9, 13], pan: 0.45, level: 0.46, body: [[285, 3], [500, 2], [3000, 4]], bright: 1 },
};

// How loud each section is at a given dynamic (0–1), and how much it comes
// forward when the conductor faces it (focus 0 = low strings, 1 = violins).
export function sectionLevel(id, dynamic, focus) {
  const pos = SECTIONS.indexOf(id) / (SECTIONS.length - 1);
  const facing = focus == null ? 1 : 0.55 + 0.6 * Math.exp(-((focus - pos) ** 2) / (2 * 0.2 ** 2));
  return SPECS[id].level * (0.05 + 0.95 * dynamic ** 1.6) * facing;
}

class Section {
  constructor(ctx, out, spec, noise) {
    this.ctx = ctx;
    this.spec = spec;
    this.midi = null;
    this.level = 0;
    this.nodes = [];

    const sum = ctx.createGain();
    sum.gain.value = 1 / spec.players;
    const highpass = this.#filter('highpass', 38, 0.7);
    sum.connect(highpass);
    let chain = highpass;
    for (const [hz, db] of spec.body) {
      const peak = this.#filter('peaking', hz, 1.3, db);
      chain.connect(peak);
      chain = peak;
    }
    // Bow pressure: more pressure, brighter tone.
    this.tone = this.#filter('lowpass', 1800, 0.5);
    const air = this.#filter('highshelf', 6000, 0.7, -8);
    this.amp = ctx.createGain();
    this.amp.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = spec.pan;
    chain.connect(this.tone).connect(air).connect(this.amp).connect(pan).connect(out);
    this.nodes.push(sum, pan);

    this.players = [];
    this.vibratos = [];
    for (let i = 0; i < spec.players; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const spread = spec.players > 1 ? (i / (spec.players - 1) - 0.5) * 2 : 0;
      osc.detune.value = spec.spread * spread + (Math.random() - 0.5) * 3;
      // Each player's own vibrato, and a slow wander in tuning.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = spec.vibrato[0] * (0.92 + Math.random() * 0.16);
      const depth = ctx.createGain();
      depth.gain.value = 0;
      lfo.connect(depth).connect(osc.detune);
      const drift = ctx.createOscillator();
      drift.frequency.value = 0.08 + Math.random() * 0.25;
      const driftDepth = ctx.createGain();
      driftDepth.gain.value = 3;
      drift.connect(driftDepth).connect(osc.detune);
      osc.connect(sum);
      for (const node of [osc, lfo, drift]) node.start();
      this.players.push(osc);
      this.vibratos.push(depth);
      this.nodes.push(osc, lfo, drift);
    }

    // Rosin: a breath of bow noise under the tone.
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    const band = this.#filter('bandpass', 2800, 0.6);
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    hiss.connect(band).connect(this.hiss).connect(highpass);
    hiss.start();
    this.nodes.push(hiss);
  }

  #filter(type, frequency, Q, gain = 0) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = gain;
    return f;
  }

  /** Change note: a legato slide within a phrase, or a clean new bow. */
  note(midi, t, { legato = true, cents = 0 } = {}) {
    const f = freqOf(midi) * 2 ** (cents / 1200);
    const slide = legato && this.midi != null;
    for (const osc of this.players) {
      osc.frequency.cancelScheduledValues(t);
      if (slide) osc.frequency.setTargetAtTime(f, t, 0.018);
      else osc.frequency.setValueAtTime(f, t);
    }
    // Vibrato blooms a moment after each new note, as players do.
    for (const depth of this.vibratos) {
      depth.gain.cancelScheduledValues(t);
      depth.gain.setTargetAtTime(this.spec.vibrato[1] * 0.2, t, 0.02);
      depth.gain.setTargetAtTime(this.spec.vibrato[1], t + 0.18, 0.25);
    }
    this.midi = midi;
  }

  /** Slide into tune from `cents` off, like a player at the pegs. */
  tuneTo(midi, t, cents) {
    const f = freqOf(midi);
    for (const osc of this.players) {
      osc.frequency.cancelScheduledValues(t);
      osc.frequency.setValueAtTime(f * 2 ** (cents / 1200), t);
      osc.frequency.setTargetAtTime(f, t + 0.1, 0.35);
    }
    for (const depth of this.vibratos) depth.gain.setTargetAtTime(this.spec.vibrato[1] * 0.3, t, 0.2);
    this.midi = midi;
  }

  shape(level, brightness, t, tau = 0.12) {
    this.level = level;
    this.amp.gain.setTargetAtTime(level, t, tau);
    this.tone.frequency.setTargetAtTime(brightness, t, tau);
    this.hiss.gain.setTargetAtTime(level * 0.06, t, tau);
  }

  /** A bow stroke on the beat: a quick bite, then the sustained tone. */
  accent(level, brightness, t, strength) {
    this.level = level;
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(level * (1 + strength), t, 0.012);
    this.amp.gain.setTargetAtTime(level, t + 0.07, 0.18);
    this.tone.frequency.setTargetAtTime(brightness * (1 + strength * 0.6), t, 0.01);
    this.tone.frequency.setTargetAtTime(brightness, t + 0.08, 0.2);
    this.hiss.gain.setTargetAtTime(level * 0.1, t, 0.01);
    this.hiss.gain.setTargetAtTime(level * 0.06, t + 0.08, 0.2);
  }

  dispose(t) {
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, 0.08);
    for (const node of this.nodes) {
      try { node.stop?.(t + 0.6); } catch { /* already stopped */ }
    }
    setTimeout(() => this.nodes.forEach((n) => n.disconnect()), 1500);
  }
}

export class Orchestra {
  constructor(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    const { ctx } = this;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.55;
    this.hall = ctx.createConvolver();
    this.hall.buffer = impulse(ctx, 3.2, 1.8);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    this.bus.connect(engine.master);
    this.bus.connect(send).connect(this.hall).connect(engine.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.sections = null;
  }

  get playing() {
    return !!this.sections;
  }

  start() {
    if (this.sections) return;
    this.sections = Object.fromEntries(SECTIONS.map((id) => [id, new Section(this.ctx, this.bus, SPECS[id], this.noise)]));
  }

  stop() {
    if (!this.sections) return;
    const t = this.ctx.currentTime;
    for (const s of Object.values(this.sections)) s.dispose(t);
    this.sections = null;
  }

  #brightness(id, dynamic, midi) {
    return clamp((600 + 7000 * dynamic ** 1.3) * SPECS[id].bright, freqOf(midi ?? 48) * 3, 16000);
  }

  /**
   * Play one beat of the score. `strength` (0–1) is how sharply the beat was
   * given; notes after the beat land at their fraction of `beatSeconds`.
   */
  play(plan, t, { dynamic, focus, strength = 0.5, beatSeconds = 0.75 }) {
    if (!this.sections || plan.silent) return;
    for (const id of SECTIONS) {
      const s = this.sections[id];
      const midi = plan.notes[id];
      const changed = midi !== s.midi;
      const wasSounding = s.level > 0.004;
      if (changed) s.note(midi, t, { legato: wasSounding && Math.abs(midi - (s.midi ?? midi)) <= 9 });
      const level = sectionLevel(id, dynamic, focus);
      const bright = this.#brightness(id, dynamic, midi);
      // Fresh bows on chord changes and on firm beats; otherwise sustain.
      if (changed || !wasSounding || strength > 0.35) s.accent(level, bright, t, 0.12 + 0.35 * strength);
      else s.shape(level, bright, t);
    }
    for (const { section, midi, at } of plan.after) {
      this.sections[section].note(midi, t + at * beatSeconds, { legato: true });
    }
  }

  /** Follow the conductor between beats: swells, and facing a section. */
  express(dynamic, focus, t) {
    if (!this.sections) return;
    for (const id of SECTIONS) {
      const s = this.sections[id];
      if (s.midi == null || s.level < 0.002) continue;
      s.shape(sectionLevel(id, dynamic, focus), this.#brightness(id, dynamic, s.midi), t, 0.2);
    }
  }

  /** No beat coming: hold the chord and let it slowly die away (a fermata). */
  hold(t) {
    if (!this.sections) return;
    for (const s of Object.values(this.sections)) s.shape(s.level * 0.25, 900, t, 2.4);
  }

  /** The cut-off: every section stops together. */
  cut(t) {
    if (!this.sections) return;
    for (const s of Object.values(this.sections)) {
      s.shape(0, 700, t, 0.07);
      s.midi = null;
    }
  }

  /** Before the concert: the oboe gives an A and the strings tune to it. */
  tune(t) {
    this.start();
    this.#oboe(t, 69, 3.6);
    const entries = [
      ['violins1', 69, 1.0, -28], ['violins2', 69, 1.35, 22], ['violas', 57, 1.7, -18],
      ['cellos', 45, 2.0, 25], ['basses', 33, 2.4, -20],
      // …then the fifths either side, and back to A.
      ['violins1', 76, 3.9, 16], ['cellos', 50, 4.3, -14], ['violas', 62, 4.8, 12],
      ['violins1', 69, 5.8, -8], ['cellos', 45, 6.2, 9], ['violas', 57, 6.5, -6],
    ];
    for (const [id, midi, at, cents] of entries) {
      const s = this.sections[id];
      s.tuneTo(midi, t + at, cents);
      s.shape(SPECS[id].level * 0.22, 1400 * SPECS[id].bright, t + at, 0.3);
    }
    // Settle to a hush and wait for the conductor.
    for (const id of SECTIONS) this.sections[id].shape(SPECS[id].level * 0.07, 1000, t + 7.4, 1.2);
  }

  /** The baton goes up: silence. */
  hush(t) {
    if (!this.sections) return;
    for (const s of Object.values(this.sections)) {
      s.shape(0, 800, t, 0.18);
      s.midi = null;
    }
    this.oboeGain?.gain.setTargetAtTime(0, t, 0.1);
  }

  #oboe(t, midi, seconds) {
    const { ctx } = this;
    // A double reed: weak fundamental, strong low harmonics — the nasal glow.
    const harmonics = [0, 0.55, 1, 0.85, 0.6, 0.45, 0.3, 0.2, 0.14, 0.1, 0.07, 0.05];
    const wave = ctx.createPeriodicWave(new Float32Array(harmonics.length), Float32Array.from(harmonics));
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = freqOf(midi);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.1;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(6, t + 0.9);
    lfo.connect(depth).connect(osc.detune);
    const formant = ctx.createBiquadFilter();
    formant.type = 'peaking';
    formant.frequency.value = 1150;
    formant.Q.value = 1.5;
    formant.gain.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.setTargetAtTime(0.075, t, 0.18);
    g.gain.setTargetAtTime(0, t + seconds - 0.5, 0.25);
    osc.connect(formant).connect(g).connect(this.bus);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + seconds + 1.5);
    lfo.stop(t + seconds + 1.5);
    this.oboeGain = g;
  }

  /** The audience, on its feet. */
  applause(t, seconds = 6) {
    this.applauseBuffer ??= makeApplause(this.ctx, seconds);
    const src = this.ctx.createBufferSource();
    src.buffer = this.applauseBuffer;
    const g = this.ctx.createGain();
    g.gain.value = 1.9;
    src.connect(g).connect(this.bus);
    src.start(t);
  }
}

// Applause, built clap by clap: a crowd of people clapping at their own
// pace, each clap a short burst of filtered noise, swelling then dying away.
function makeApplause(ctx, seconds) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
  const L = buffer.getChannelData(0);
  const R = buffer.getChannelData(1);
  const clapLength = Math.floor(rate * 0.02);
  for (let person = 0; person < 30; person++) {
    const pan = Math.random();
    const pace = 3.4 + Math.random() * 2.4;
    const start = 0.05 + Math.random() * 0.6;
    const end = seconds * (0.55 + Math.random() * 0.35);
    const centre = 900 + Math.random() * 1700;
    for (let time = start; time < end; time += (1 / pace) * (0.85 + Math.random() * 0.3)) {
      const fade = Math.min(1, time / 0.5) * Math.min(1, (end - time) / 1.2);
      const amp = (0.4 + Math.random() * 0.6) * fade;
      // A two-pole resonator gives each clap its hollow "cupped hands" colour.
      const w = (2 * Math.PI * centre * (0.85 + Math.random() * 0.3)) / rate;
      const r = 0.985;
      const c1 = 2 * r * Math.cos(w);
      const c2 = r * r;
      let y1 = 0;
      let y2 = 0;
      const i0 = Math.floor(time * rate);
      for (let k = 0; k < clapLength && i0 + k < L.length; k++) {
        const x = (Math.random() * 2 - 1) * Math.exp(-k / (rate * 0.0035));
        const y = x + c1 * y1 - c2 * y2;
        y2 = y1;
        y1 = y;
        const v = y * amp * 0.02;
        L[i0 + k] += v * (1 - pan);
        R[i0 + k] += v * pan;
      }
    }
  }
  let peak = 0;
  for (const ch of [L, R]) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = peak ? 0.5 / peak : 1;
  for (const ch of [L, R]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return buffer;
}
