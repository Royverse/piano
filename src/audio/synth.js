// Offline synthesis of single notes into sample buffers.
// Runs inside a worker (render-worker.js) and on the main thread as a
// fallback, so it must stay free of DOM and Web Audio APIs.

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const freqOf = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const VOICES = {
  grand: { label: 'Grand', kind: 'piano' },
  felt: { label: 'Felt', kind: 'piano' },
  electric: { label: 'Electric', kind: 'electric' },
  celesta: { label: 'Celesta', kind: 'celesta' },
};

// Two pianos from one string model. `slope` is how fast the partials fall
// away (hammer hardness), `strike` where along the string the hammer lands,
// `felt` an extra low-pass from a felt strip between hammer and string.
const PIANOS = {
  grand: {
    slope: 1.05, strike: 1 / 8.3, felt: 0, sustain: 1, inharmonicity: 1, unison: 0.9,
    aftersound: 0.34, hfDamping: 0.9, attack: 0.0012, thump: 0.2, click: 0.012,
  },
  felt: {
    slope: 1.5, strike: 1 / 7.2, felt: 3, sustain: 0.72, inharmonicity: 1.15, unison: 1.7,
    aftersound: 0.3, hfDamping: 1.7, attack: 0.0045, thump: 0.32, click: 0.024,
  },
};

/** Seconds a piano string keeps its "aftersound" — long in the bass, short at the top. */
export const sustainTime = (midi) => 17 * 2 ** (-(midi - 21) / 22);

/** Render one note. Returns mono samples and the rate they were rendered at. */
export function renderNote(voice, midi, sampleRate) {
  if (voice === 'electric') return renderElectric(midi, sampleRate);
  if (voice === 'celesta') return renderCelesta(midi, sampleRate);
  return renderPiano(PIANOS[voice] ?? PIANOS.grand, voice, midi, sampleRate);
}

/* ------------------------------------------------------------ piano */

function renderPiano(p, voice, midi, baseRate) {
  // Bass and middle notes carry little above 11 kHz: render them at half rate.
  const rate = midi < 64 && baseRate >= 44100 ? baseRate / 2 : baseRate;
  const f0 = freqOf(midi);
  const rand = rng(midi * 7919 + voice.length * 131);

  const after = p.sustain * sustainTime(midi);
  const prompt = after / 5.5;
  const len = Math.ceil(clamp(after * 1.1, 1.6, 6) * rate);
  const out = new Float32Array(len);

  // Stiff strings stretch their upper partials sharp; more so in the treble.
  const B = p.inharmonicity * 3.8e-4 * 2 ** ((midi - 60) / 18);
  const maxHz = Math.min(rate * 0.45, 12000);
  // One wound string in the low bass, pairs in the tenor, then trichords.
  const strings = midi < 34 ? 1 : midi < 46 ? 2 : 3;
  const spread = p.unison * (0.55 + rand() * 0.5);
  const detunes = strings === 1 ? [0] : strings === 2 ? [-spread / 2, spread / 2] : [-spread * 0.6, 0.08, spread * 0.7];
  const feltHz = p.felt ? Math.max(900, f0 * p.felt) : Infinity;

  for (let n = 1; n <= 64; n++) {
    const fn = n * f0 * Math.sqrt(1 + B * n * n);
    if (fn > maxHz) break;
    // Hammer excitation: the strike point notches out some partials.
    let amp = Math.abs(Math.sin(Math.PI * n * p.strike)) / n ** p.slope;
    amp /= 1 + (fn / feltHz) ** 2;
    // The soundboard barely radiates the lowest fundamentals.
    if (fn < 90) amp *= 0.35 + 0.65 * (fn / 90);
    if (amp < 2e-4) continue;

    // Higher partials lose energy faster.
    const damping = 1 + p.hfDamping * (fn / 1000) ** 1.4;
    const unison = n <= 6 ? detunes : [0];
    for (const cents of unison) {
      const f = fn * 2 ** (cents / 1200);
      const a = amp / unison.length;
      // Two-stage decay: a quick "prompt" sound, then the long aftersound.
      decaySine(out, rate, f, a * (1 - p.aftersound), prompt / damping);
      if (n <= 10) decaySine(out, rate, f, a * p.aftersound, after / damping);
    }
  }

  normalize(out, rate, 0.16 * clamp(1 + (60 - midi) * 0.005, 0.8, 1.2));
  addHammer(out, rate, f0, p, rand);
  fadeIn(out, rate, p.attack);
  fadeTail(out, 0.25);
  return { samples: out, rate };
}

// Felt-and-wood noise of the hammer: a low thump plus a short click.
function addHammer(out, rate, f0, p, rand) {
  const thump = bandpass(clamp(f0, 70, 420), 1.2, rate);
  const click = bandpass(clamp(f0 * 6, 1500, 5000), 0.9, rate);
  const n = Math.min(out.length, Math.floor(rate * 0.09));
  for (let i = 0; i < n; i++) {
    const noise = rand() * 2 - 1;
    out[i] += thump(noise) * p.thump * Math.exp(-i / (rate * 0.012))
      + click(noise) * p.click * Math.exp(-i / (rate * 0.004));
  }
}

/* --------------------------------------------------------- electric */

// A tine piano: FM with a decaying index (the "bark"), a short metallic tine
// transient, and a little asymmetry from the pickup.
function renderElectric(midi, baseRate) {
  const rate = midi < 64 && baseRate >= 44100 ? baseRate / 2 : baseRate;
  const f0 = freqOf(midi);
  const tau = clamp(3.2 * 2 ** (-(midi - 48) / 22), 0.7, 5);
  const len = Math.ceil(clamp(tau * 1.6, 1.5, 6) * rate);
  const out = new Float32Array(len);

  const index0 = 2.1 * clamp(1 - (midi - 60) / 80, 0.5, 1.3);
  const indexFloor = 0.35;
  const indexTau = 0.25 + 0.3 * 2 ** (-(midi - 60) / 24);
  const tineHz = f0 * 7.1;
  const tineOn = tineHz < rate * 0.4;

  const dPhase = (TAU * f0) / rate;
  const dTine = (TAU * tineHz) / rate;
  const kIndex = Math.exp(-1 / (indexTau * rate));
  const kSlow = Math.exp(-1 / (tau * rate));
  const kFast = Math.exp(-1 / (tau * 0.22 * rate));
  const kTine = Math.exp(-1 / (0.012 * rate));

  let phase = 0, tinePhase = 0, eIndex = 1, eSlow = 1, eFast = 1, eTine = 1;
  let dcIn = 0, dcOut = 0;
  for (let i = 0; i < len; i++) {
    const index = indexFloor + (index0 - indexFloor) * eIndex;
    let y = Math.sin(phase + index * Math.sin(phase));
    y += 0.22 * y * y;
    if (tineOn) y += 0.3 * eTine * Math.sin(tinePhase);
    y *= 0.62 * eSlow + 0.38 * eFast;
    // DC blocker for the asymmetric pickup term.
    const v = y - dcIn + 0.995 * dcOut;
    dcIn = y; dcOut = v;
    out[i] = v;
    phase += dPhase; tinePhase += dTine;
    eIndex *= kIndex; eSlow *= kSlow; eFast *= kFast; eTine *= kTine;
  }

  normalize(out, rate, 0.15);
  fadeIn(out, rate, 0.001);
  fadeTail(out, 0.2);
  return { samples: out, rate };
}

/* ---------------------------------------------------------- celesta */

// Struck steel bars over wooden resonators: a strong fundamental, a faintly
// beating twin, and the bar's inharmonic partials dying away quickly.
const BAR_PARTIALS = [
  [1, 1, 1], [1.0008, 0.12, 0.8], [2, 0.16, 0.45], [2.76, 0.1, 0.2],
  [4, 0.05, 0.14], [5.4, 0.035, 0.08], [8.93, 0.02, 0.04],
];

function renderCelesta(midi, baseRate) {
  const rate = midi < 76 && baseRate >= 44100 ? baseRate / 2 : baseRate;
  const f0 = freqOf(midi);
  const tau = clamp(2.4 * 2 ** (-(midi - 72) / 20), 0.45, 3.2);
  const len = Math.ceil(clamp(tau * 1.8, 1.2, 4.5) * rate);
  const out = new Float32Array(len);
  for (const [ratio, amp, t] of BAR_PARTIALS) {
    if (f0 * ratio < rate * 0.45) decaySine(out, rate, f0 * ratio, amp, tau * t);
  }
  normalize(out, rate, 0.14);

  const rand = rng(midi * 31 + 7);
  const tink = highpass(3000, rate);
  const n = Math.min(len, Math.floor(rate * 0.02));
  for (let i = 0; i < n; i++) out[i] += tink(rand() * 2 - 1) * 0.05 * Math.exp(-i / (rate * 0.002));

  fadeIn(out, rate, 0.0006);
  fadeTail(out, 0.2);
  return { samples: out, rate };
}

/* ------------------------------------------------------------ tools */

// Add A·rⁿ·sin(ωn) using a two-pole resonator — far cheaper than Math.sin
// per sample. Stops once the partial has decayed below audibility.
function decaySine(out, rate, freq, amp, tau) {
  if (amp <= 1e-6 || tau <= 0) return;
  const w = (TAU * freq) / rate;
  const r = Math.exp(-1 / (tau * rate));
  const c1 = 2 * r * Math.cos(w);
  const c2 = r * r;
  const n = Math.min(out.length, Math.ceil(tau * rate * Math.log(amp / 1e-6)));
  let y2 = 0;
  let y1 = amp * r * Math.sin(w);
  if (n > 1) out[1] += y1;
  for (let i = 2; i < n; i++) {
    const y = c1 * y1 - c2 * y2;
    out[i] += y;
    y2 = y1;
    y1 = y;
  }
}

// Match loudness over the attack, but never let a bright attack peak past 0.8.
function normalize(out, rate, targetRms) {
  const n = Math.min(out.length, Math.floor(rate * 0.15));
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    sum += out[i] * out[i];
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const rms = Math.sqrt(sum / n) || 1;
  const g = Math.min(targetRms / rms, 0.8 / (peak || 1));
  for (let i = 0; i < out.length; i++) out[i] *= g;
}

function fadeIn(out, rate, seconds) {
  const n = Math.min(out.length, Math.max(1, Math.floor(rate * seconds)));
  for (let i = 0; i < n; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / n);
}

function fadeTail(out, fraction) {
  const n = Math.floor(out.length * fraction);
  const start = out.length - n;
  for (let i = 0; i < n; i++) out[start + i] *= Math.cos((Math.PI / 2) * (i / n)) ** 2;
}

function biquad(b0, b1, b2, a0, a1, a2) {
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function bandpass(freq, q, rate) {
  const w = (TAU * freq) / rate;
  const alpha = Math.sin(w) / (2 * q);
  return biquad(alpha, 0, -alpha, 1 + alpha, -2 * Math.cos(w), 1 - alpha);
}

function highpass(freq, rate) {
  const w = (TAU * freq) / rate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / Math.SQRT2;
  return biquad((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

// Small seeded generator so each note sounds the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
