// The view inside the lid: one group of strings above every key.
// Struck strings vibrate; with the dampers up, strings whose overtones match
// the note shimmer along (sympathetic resonance), in the matching mode shape.
import { FIRST_UNDAMPED } from './audio/engine.js';
import { sustainTime } from './audio/synth.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Overtone k of a note lands (nearly) on these many semitones above it.
const OVERTONES = [[2, 12], [3, 19], [4, 24], [5, 28], [6, 31]];
const WOUND_BELOW = 46;
const SAMPLES = 36;

const COPPER = [181, 111, 62];
const STEEL = [196, 200, 205];
const GLOW = [255, 214, 150];
const HOT = [255, 234, 196];

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

// How long the strings visibly move, per voice. Shorter than the sound
// itself — the eye reads motion long after the ear has moved on.
function visualDecay(voice, midi) {
  if (voice === 'celesta') return clamp(1.4 * 2 ** (-(midi - 72) / 20), 0.35, 2);
  if (voice === 'electric') return clamp(1.6 * 2 ** (-(midi - 48) / 22), 0.4, 2.5);
  return clamp(sustainTime(midi) * (voice === 'felt' ? 0.25 : 0.35), 0.35, 5);
}

export class Strings {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keys = [];
    this.notes = new Map();
    this.pedal = false;
    this.scale = null;
    this.bowed = new Map();
    this.frame = this.frame.bind(this);
    this.running = false;
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener?.('change', () => this.wake());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.wake();
  }

  /**
   * Lay the strings out over the keys (Keyboard.geometry(), viewport px).
   * Like a real piano, they run at an even pitch across the keyboard's width
   * rather than sitting exactly over each key.
   */
  setKeys(keys) {
    if (!keys.length) return;
    const left = this.canvas.getBoundingClientRect().left;
    const sorted = [...keys].sort((a, b) => a.midi - b.midi);
    const white = sorted.filter((k) => !k.black);
    const start = white[0].x - white[0].width / 2 - left;
    const end = white[white.length - 1].x + white[white.length - 1].width / 2 - left;
    const pitch = (end - start) / sorted.length;
    this.keys = sorted.map((k, i) => ({ midi: k.midi, x: start + (i + 0.5) * pitch }));
    this.maxAmp = clamp(pitch * 0.36, 3, 9);
    this.wake();
  }

  setPedal(down) {
    this.pedal = down;
    this.wake();
  }

  setScale(key) {
    this.scale = key;
    this.wake();
  }

  #note(midi) {
    let s = this.notes.get(midi);
    if (!s) {
      s = { midi, e: 0, tau: 1, phase: Math.random() * TAU, hz: 3 + ((midi - 21) / 87) * 7, flash: 0, held: false, lift: 0, sym: 0, mode: 1 };
      this.notes.set(midi, s);
    }
    return s;
  }

  strike(midi, velocity, voice) {
    const s = this.#note(midi);
    s.e = Math.max(s.e * 0.5, 0.35 + 0.65 * velocity);
    s.flash = velocity;
    s.tau = visualDecay(voice, midi);
    s.held = true;
    this.wake();
  }

  /** Strings the orchestra is bowing: they vibrate steadily until let go. */
  setBowed(levels) {
    for (const midi of this.bowed.keys()) if (!levels.has(midi)) this.#note(midi).bow = 0;
    for (const [midi, level] of levels) {
      const s = this.#note(midi);
      if (!s.bow) s.flash = Math.max(s.flash, level * 0.6);
      s.bow = level;
    }
    this.bowed = levels;
    this.wake();
  }

  release(midi) {
    this.#note(midi).held = false;
    this.wake();
  }

  wake() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  #undamped(midi) {
    return this.pedal || midi >= FIRST_UNDAMPED || !!this.notes.get(midi)?.held;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    let active = false;

    for (const s of this.notes.values()) {
      const open = this.#undamped(s.midi);
      if (s.bow) {
        s.e += (s.bow - s.e) * (1 - Math.exp(-dt / 0.08));
        active = true;
      } else if (s.e > 0) {
        s.e *= Math.exp(-dt / (open ? s.tau : 0.07));
        if (s.e < 0.004) s.e = 0;
        else active = true;
      }
      if (s.flash > 0) {
        s.flash *= Math.exp(-dt / 0.1);
        if (s.flash < 0.01) s.flash = 0;
        else active = true;
      }
      const lift = open && s.midi < FIRST_UNDAMPED ? 1 : 0;
      s.lift += (lift - s.lift) * (1 - Math.exp(-dt / 0.05));
      if (Math.abs(lift - s.lift) > 0.01) active = true;
      else s.lift = lift;
      s.phase += dt * TAU * s.hz;
    }

    // Sympathetic resonance: every undamped string tuned to an overtone of
    // a sounding note picks up energy. Lower strings vibrate in the matching
    // mode (two loops for the octave, three for the twelfth…).
    const targets = new Map();
    const push = (midi, amp, mode) => {
      if (amp > (targets.get(midi)?.amp ?? 0)) targets.set(midi, { amp, mode });
    };
    for (const s of this.notes.values()) {
      if (s.e < 0.03) continue;
      for (const [k, semis] of OVERTONES) {
        const amp = (s.e * 0.6) / k;
        if (this.#undamped(s.midi + semis)) push(s.midi + semis, amp, 1);
        if (this.#undamped(s.midi - semis)) push(s.midi - semis, amp, k);
      }
    }
    for (const [midi] of targets) this.#note(midi);
    for (const s of this.notes.values()) {
      const t = targets.get(s.midi);
      const goal = t?.amp ?? 0;
      if (t) s.mode = t.mode;
      s.sym += (goal - s.sym) * (1 - Math.exp(-dt / (goal > s.sym ? 0.18 : 0.12)));
      if (s.sym < 0.004 && goal === 0) s.sym = 0;
      else active = true;
    }

    this.draw();
    if (active) requestAnimationFrame(this.frame);
    else this.running = false;
  }

  lengthOf(midi) {
    // Bass strings are long and treble strings short; together they draw
    // the curve of a grand piano's case.
    const room = this.h - 16;
    return room * (0.14 + 0.82 * clamp((108 - midi) / 87, 0, 1) ** 1.25);
  }

  draw() {
    const { ctx, w, h, dpr } = this;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bottom = h;
    const still = this.motion.matches;

    // The pressure bar the strings pass under, just above the keys.
    ctx.fillStyle = 'rgba(201, 163, 91, 0.16)';
    ctx.fillRect(0, bottom - 9, w, 1);

    // Hitch pins along the top: the curve of the case.
    ctx.beginPath();
    this.keys.forEach((k, i) => {
      const y = bottom - this.lengthOf(k.midi);
      if (i === 0) ctx.moveTo(k.x, y);
      else ctx.lineTo(k.x, y);
    });
    ctx.strokeStyle = 'rgba(201, 163, 91, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();

    for (const k of this.keys) {
      const s = this.notes.get(k.midi);
      const len = this.lengthOf(k.midi);
      const top = bottom - len;
      const wound = k.midi < WOUND_BELOW;
      const count = k.midi < 34 ? 1 : wound ? 2 : 3;
      const gap = wound ? 2.2 : 1.5;
      const width = k.midi < 34 ? 2 : wound ? 1.3 : 0.7;
      const color = wound ? COPPER : STEEL;
      let alpha = wound ? 0.55 : 0.32;
      if (this.scale) alpha *= this.scale.pcs.includes(k.midi % 12) ? 1.3 : 0.55;

      const own = s?.e ?? 0;
      const sym = s?.sym ?? 0;
      const energy = Math.max(own, sym);
      const mode = own >= sym ? 1 : s.mode;
      const amp = this.maxAmp * clamp(energy, 0, 1);
      const sway = still ? 0 : Math.cos(s?.phase ?? 0);

      // Pins
      ctx.fillStyle = 'rgba(214, 180, 112, 0.55)';
      for (let i = 0; i < count; i++) {
        ctx.fillRect(k.x + (i - (count - 1) / 2) * gap - 0.6, top - 1.2, 1.2, 1.2);
      }

      if (amp < 0.15) {
        ctx.strokeStyle = rgba(color, alpha);
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x = k.x + (i - (count - 1) / 2) * gap;
          ctx.moveTo(x, bottom);
          ctx.lineTo(x, top);
        }
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation = 'lighter';
        // The blur of a vibrating string: a spindle, with nodes between loops.
        ctx.fillStyle = rgba(GLOW, 0.05 + 0.16 * energy);
        ctx.beginPath();
        for (let j = 0; j <= SAMPLES; j++) {
          const p = j / SAMPLES;
          ctx.lineTo(k.x - amp * Math.abs(Math.sin(mode * Math.PI * p)) - 1.5, bottom - p * len);
        }
        for (let j = SAMPLES; j >= 0; j--) {
          const p = j / SAMPLES;
          ctx.lineTo(k.x + amp * Math.abs(Math.sin(mode * Math.PI * p)) + 1.5, bottom - p * len);
        }
        ctx.fill();

        ctx.strokeStyle = rgba(HOT, 0.3 + 0.6 * energy);
        ctx.lineWidth = width + 0.3;
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
          const x0 = k.x + (i - (count - 1) / 2) * gap;
          for (let j = 0; j <= SAMPLES; j++) {
            const p = j / SAMPLES;
            const x = x0 + amp * Math.sin(mode * Math.PI * p) * sway;
            if (j === 0) ctx.moveTo(x, bottom);
            else ctx.lineTo(x, bottom - p * len);
          }
        }
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      // Where the hammer met the string.
      if (s?.flash) {
        const y = bottom - len * 0.1;
        const r = 5 + 16 * s.flash;
        const g = ctx.createRadialGradient(k.x, y, 0, k.x, y, r);
        g.addColorStop(0, rgba(HOT, 0.7 * s.flash));
        g.addColorStop(1, rgba(GLOW, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(k.x - r, y - r, r * 2, r * 2);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Dampers: felt blocks resting on the strings, lifted by the key or pedal.
      if (k.midi < FIRST_UNDAMPED) {
        const lift = s?.lift ?? 0;
        const dw = (count - 1) * gap + 7;
        const y = bottom - Math.max(24, len * 0.18) - lift * 9;
        ctx.fillStyle = `rgba(30, 22, 18, ${0.96 - lift * 0.3})`;
        ctx.fillRect(k.x - dw / 2, y, dw, 11);
        ctx.fillStyle = `rgba(122, 35, 49, ${0.85 - lift * 0.35})`;
        ctx.fillRect(k.x - dw / 2, y + 9, dw, 2);
      }
    }
  }
}
