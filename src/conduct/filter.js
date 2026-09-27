// High-performance 1-Euro adaptive temporal filter for hand landmarks.
// Eliminates jitter when resting/moving slowly (low cutoff), while adding
// zero lag when moving quickly (dynamic cutoff increases with speed).

export class OneEuro {
  constructor({ minCutoff = 1.2, beta = 6.0, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.lastTime = null;
  }

  filter(val, t) {
    if (this.x == null || this.lastTime == null) {
      this.x = val;
      this.dx = 0;
      this.lastTime = t;
      return val;
    }
    const dt = Math.max(1e-4, Math.min(0.2, (t - this.lastTime) / 1000));
    this.lastTime = t;

    // Filter derivative to prevent noise in the velocity estimate
    const dVal = (val - this.x) / dt;
    const alphaD = this.#alpha(dt, this.dCutoff);
    this.dx += alphaD * (dVal - this.dx);

    // Adaptive cutoff: rises proportionally with speed so fast motion has zero lag
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const alpha = this.#alpha(dt, cutoff);
    this.x += alpha * (val - this.x);
    return this.x;
  }

  #alpha(dt, cutoff) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.lastTime = null;
  }
}

export class PointFilter {
  constructor(options = {}) {
    this.fx = new OneEuro(options);
    this.fy = new OneEuro(options);
  }

  filter(pt, t) {
    return {
      x: this.fx.filter(pt.x, t),
      y: this.fy.filter(pt.y, t),
    };
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }
}

/**
 * Tracks and stabilizes hand landmarks over time, preserving identity
 * and filtering high-frequency noise from webcam video.
 */
export class HandStabilizer {
  constructor() {
    this.hands = new Map(); // id -> { landmarkFilters, openFilter, lastSeen, lastCenter }
    this.nextId = 1;
  }

  reset() {
    this.hands.clear();
    this.nextId = 1;
  }

  update(rawHands, t) {
    const now = t || performance.now();

    // Expire hands lost for more than 400ms
    for (const [id, hand] of this.hands.entries()) {
      if (now - hand.lastSeen > 400) this.hands.delete(id);
    }

    if (!rawHands.length) return [];

    // Match raw hands to existing tracked hands by wrist/center proximity
    const matched = [];
    const usedIds = new Set();

    for (const raw of rawHands) {
      const center = raw.points?.[9] ?? raw.points?.[0] ?? { x: raw.x, y: raw.y };
      let bestId = null;
      let bestDist = 0.35; // Maximum distance to consider the same hand

      for (const [id, hand] of this.hands.entries()) {
        if (usedIds.has(id)) continue;
        const d = Math.hypot(center.x - hand.lastCenter.x, center.y - hand.lastCenter.y);
        if (d < bestDist) {
          bestDist = d;
          bestId = id;
        }
      }

      let handState;
      if (bestId != null) {
        usedIds.add(bestId);
        handState = this.hands.get(bestId);
      } else {
        const id = this.nextId++;
        usedIds.add(id);
        const landmarkFilters = (raw.points || []).map(() => new PointFilter({ minCutoff: 1.5, beta: 6.0 }));
        handState = {
          id,
          landmarkFilters,
          openFilter: new OneEuro({ minCutoff: 2.0, beta: 5.0 }),
          lastSeen: now,
          lastCenter: center,
        };
        this.hands.set(id, handState);
      }

      handState.lastSeen = now;
      handState.lastCenter = center;

      // Filter all landmarks
      const smoothedPoints = raw.points
        ? raw.points.map((p, i) => {
            if (!handState.landmarkFilters[i]) {
              handState.landmarkFilters[i] = new PointFilter({ minCutoff: 1.5, beta: 6.0 });
            }
            return handState.landmarkFilters[i].filter(p, now);
          })
        : null;

      const smoothedOpen = handState.openFilter.filter(raw.open ?? 1, now);
      const batonPt = smoothedPoints?.[8] ?? { x: raw.x, y: raw.y };

      matched.push({
        id: handState.id,
        x: batonPt.x,
        y: batonPt.y,
        open: Math.max(0, Math.min(1, smoothedOpen)),
        points: smoothedPoints,
      });
    }

    return matched;
  }
}
