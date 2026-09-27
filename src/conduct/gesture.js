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

// Musical stroke recognition:
// Requires a clear downstroke (MIN_STROKE = 0.038) and realistic debounce (MIN_GAP = 260ms, up to 230 bpm)
// preventing rapid accidental triggering.
const MIN_STROKE = 0.038;
const MIN_GAP = 260; // ms between beats (allows allegro/presto up to 230 bpm)
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
    this.gesture = 'ready';
    this.motion = 0;
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

    // Two-hand detection: in mirrored coordinates, rightmost hand (higher x)
    // acts as baton leader, and leftmost hand (lower x) acts as expressive sculptor.
    let baton, other;
    if (hands.length === 1) {
      baton = hands[0];
      other = null;
    } else {
      const sorted = [...hands].sort((a, b) => a.x - b.x);
      baton = sorted[sorted.length - 1];
      other = sorted[0];
    }

    // Cut-off: either hand forming a closed fist triggers the cut-off countdown
    const isFist = (baton.open < 0.22) || (other && other.open < 0.22);
    this.#watchFist(t, isFist ? 0.15 : Math.min(baton.open, other?.open ?? 1));

    // Pinch: either hand pinching thumb and index triggers pizzicato
    const isPinch = (baton.pinch > 0.55) || (other && other.pinch > 0.55);

    const follow = 1 - Math.exp(-dt / 0.045);
    if (this.y == null) {
      this.x = baton.x;
      this.y = baton.y;
      this.top = baton.y;
      this.speed = 0;
    }
    const beforeX = this.x;
    const before = this.y;
    this.x += (baton.x - this.x) * follow;
    this.y += (baton.y - this.y) * follow;
    const rawSpeed = (this.y - before) / dt; // positive = moving down
    this.speed = this.speed == null ? rawSpeed : this.speed * 0.4 + rawSpeed * 0.6;
    // Any movement at all, in any direction: stillness means a fermata.
    const rawMotion = Math.hypot(this.x - beforeX, this.y - before) / dt;
    this.motion = (this.motion ?? rawMotion) + (rawMotion - (this.motion ?? rawMotion)) * (1 - Math.exp(-dt / 0.25));
    if (!this.cut) this.#watchBeat(t, this.speed);

    // Height & Stroke Dynamics:
    // In front of a laptop webcam, hand elevation (vertical Y) naturally sets volume:
    // Higher up in frame (lower y) = Forte (loud / bright);
    // Lower down near desk (higher y) = Piano (soft / intimate).
    const fromStroke = clamp((this.lastStroke - 0.02) / 0.28, 0, 1);
    const fromBatonHeight = clamp((0.85 - baton.y) / 0.65, 0, 1);
    const fromOtherHeight = other ? clamp((0.85 - other.y) / 0.65, 0, 1) : null;

    let loud;
    if (other) {
      // Two hands: the higher hand commands dynamics; both hands raised = Grand Tutti swell!
      const twoHandHeight = Math.max(fromBatonHeight, fromOtherHeight);
      loud = 0.35 * fromStroke + 0.65 * twoHandHeight;
      if (fromBatonHeight > 0.6 && fromOtherHeight > 0.6) {
        loud = Math.min(1.0, loud * 1.25);
      }
    } else {
      // One hand: combination of stroke intensity and vertical hand elevation
      loud = 0.72 * fromStroke + 0.28 * fromBatonHeight;
    }
    this.dynamic += (loud - this.dynamic) * (1 - Math.exp(-dt / 0.22));

    // Section Focus:
    // Aiming or gesturing left (x < 0.38) features Basses & Cellos.
    // Aiming right (x > 0.62) features Violins. Center is balanced tutti.
    const targetFocus = other ? other.x : this.x;
    this.focus += (targetFocus - this.focus) * (1 - Math.exp(-dt / 0.22));

    this.isPinch = isPinch;
    this.hasOther = !!other;
    this.other = other;
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
    let gesture = 'wave';
    if (this.cut || this.fistProgress > 0.35) {
      gesture = 'fist';
    } else if (this.isPinch) {
      gesture = 'pinch';
    } else if ((this.motion ?? 0) < 0.05 && (this.last ?? 0) - this.lastBeat > 1200) {
      gesture = 'hold';
    } else if (this.hasOther && this.dynamic > 0.75) {
      gesture = 'tutti';
    } else if (this.focus < 0.38) {
      gesture = 'basses';
    } else if (this.focus > 0.62) {
      gesture = 'violins';
    }

    return {
      present: this.present,
      twoHands: this.hasOther,
      x: this.x,
      y: this.y,
      otherX: this.other?.x ?? null,
      otherY: this.other?.y ?? null,
      phase: this.phase,
      dynamic: this.dynamic,
      focus: this.focus,
      tempo: this.tempo,
      cut: this.cut,
      fistProgress: this.fistProgress,
      pizzicato: !!this.isPinch,
      gesture,
    };
  }
}
