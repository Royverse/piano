// Reads conducting from a stream of hand positions: beats (the bottom of each
// downward stroke), tempo, dynamics, which section you're facing, and the
// cut-off. The same logic serves a camera-tracked hand or a mouse.
//
// Coordinates are normalised: x 0–1 left to right as seen on screen,
// y 0–1 top to bottom. `open` is 0 for a fist, 1 for a flat hand.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Italian tempo markings, by the upper edge of their range (beats per minute).
const TEMPO_MARKS = [[60, 'Largo'], [66, 'Larghetto'], [76, 'Adagio'], [108, 'Andante'], [120, 'Moderato'], [168, 'Allegro'], [Infinity, 'Presto']];
export const tempoMark = (bpm) => TEMPO_MARKS.find(([max]) => bpm < max)[1];

const DYNAMICS = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
export const dynamicMark = (level) => DYNAMICS[clamp(Math.floor(level * DYNAMICS.length), 0, DYNAMICS.length - 1)];

// Forgiving, natural stroke recognition:
// Slower downward movement is recognized as a conducting stroke (0.16 screen heights/s)
// Short, gentle waves count as beats (0.022 screen height excursion)
const MIN_STROKE = 0.022;
const MIN_GAP = 180; // ms between beats (up to 330 bpm)
const DOWN = 0.16; // speed that initiates a downward stroke
const TURN = 0.04; // speed threshold where stroke bottoms out (ictus)

export class Conductor {
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.reset();
  }

  reset() {
    this.x = null;
    this.y = null;
    this.phase = 'up';
    this.top = null;
    this.lastBeat = -Infinity;
    this.lastStroke = 0.12;
    this.tempo = null;
    this.dynamic = 0.35;
    this.focus = 0.5;
    this.present = false;
    this.seenAt = -Infinity;
    this.fistSince = null;
    this.fistProgress = 0;
    this.cut = false;
    this.last = null;
  }

  tapBeat(t = performance.now(), stroke = 0.16, pos = null) {
    this.present = true;
    this.cut = false;
    this.lastStroke = stroke;
    if (pos) {
      this.x = pos.x;
      this.y = pos.y;
    }
    const gap = t - this.lastBeat;
    if (gap < 2400) {
      const bpm = clamp(60000 / gap, 30, 240);
      this.tempo = this.tempo ? this.tempo * 0.4 + bpm * 0.6 : bpm;
    }
    this.lastBeat = t;
    this.handlers.beat?.({ x: this.x ?? 0.5, y: this.y ?? 0.6, stroke });
  }

  update({ t, hands }) {
    const dt = this.last == null ? 1 / 30 : clamp((t - this.last) / 1000, 1 / 240, 0.1);
    this.last = t;

    if (!hands.length) {
      if (this.present && t - this.seenAt > 700) {
        this.present = false;
        this.y = null;
        this.phase = 'up';
        this.handlers.lower?.();
      }
      return this.snapshot();
    }

    this.seenAt = t;
    if (!this.present) {
      this.present = true;
      this.handlers.raise?.();
    }

    // The hand furthest right beats time; a second hand shapes the sound.
    const sorted = [...hands].sort((a, b) => a.x - b.x);
    const baton = sorted[sorted.length - 1];
    const other = sorted.length > 1 ? sorted[0] : null;

    this.#watchFist(t, baton.open);

    const follow = 1 - Math.exp(-dt / 0.05);
    if (this.y == null) {
      this.x = baton.x;
      this.y = baton.y;
      this.top = baton.y;
    }
    const before = this.y;
    this.x += (baton.x - this.x) * follow;
    this.y += (baton.y - this.y) * follow;
    const speed = (this.y - before) / dt; // positive = moving down
    if (!this.cut) this.#watchBeat(t, speed);

    // Loudness: size of downstrokes or elevation of shaping hand.
    const fromStroke = clamp((this.lastStroke - 0.02) / 0.28, 0, 1);
    const fromHand = other ? clamp((0.88 - other.y) / 0.65, 0, 1) : null;
    const loud = fromHand == null ? fromStroke : 0.3 * fromStroke + 0.7 * fromHand;
    this.dynamic += (loud - this.dynamic) * (1 - Math.exp(-dt / 0.3));

    // Facing a section: pointing left features basses/cellos, right features violins.
    const facing = other ? other.x : this.x;
    this.focus += (facing - this.focus) * (1 - Math.exp(-dt / 0.25));
    return this.snapshot();
  }

  #watchFist(t, open) {
    if (open < 0.22) {
      this.fistSince ??= t;
      const duration = t - this.fistSince;
      this.fistProgress = clamp(duration / 380, 0, 1);
      if (!this.cut && duration > 380) {
        this.cut = true;
        this.handlers.cutoff?.();
      }
    } else {
      this.fistSince = null;
      this.fistProgress = 0;
      if (open > 0.45) this.cut = false;
    }
  }

  #watchBeat(t, speed) {
    if (this.phase === 'up') {
      this.top = Math.min(this.top, this.y);
      if (speed > DOWN) this.phase = 'down';
      return;
    }
    if (speed > TURN) return;

    // Stroke has bottomed out and is rebounding: the ictus!
    const stroke = this.y - this.top;
    this.phase = 'up';
    this.top = this.y;
    if (stroke < MIN_STROKE || t - this.lastBeat < MIN_GAP) return;

    const gap = t - this.lastBeat;
    if (gap < 2400) {
      const bpm = clamp(60000 / gap, 30, 240);
      this.tempo = this.tempo == null ? bpm : this.tempo * 0.55 + bpm * 0.45;
    }
    this.lastBeat = t;
    this.lastStroke = stroke;
    this.handlers.beat?.({ t, stroke, x: this.x, y: this.y, tempo: this.tempo });
  }

  snapshot() {
    return {
      present: this.present,
      x: this.x,
      y: this.y,
      phase: this.phase,
      dynamic: this.dynamic,
      focus: this.focus,
      tempo: this.tempo,
      cut: this.cut,
      fistProgress: this.fistProgress,
    };
  }
}
