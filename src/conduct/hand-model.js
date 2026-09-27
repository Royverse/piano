// The gesture guide: an animated hand (the same 21 landmarks MediaPipe
// tracks) demonstrating each conducting gesture in a loop.

import { BONES } from './hands.js';

// Base resting hand coordinates in local 3D space (centered at wrist)
const REST_HAND = [
  { x: 0, y: 0, z: 0 },          // 0: Wrist
  // Thumb
  { x: -0.15, y: -0.12, z: 0.02 }, // 1
  { x: -0.26, y: -0.24, z: 0.04 }, // 2
  { x: -0.34, y: -0.36, z: 0.06 }, // 3
  { x: -0.40, y: -0.48, z: 0.08 }, // 4: Thumb tip
  // Index
  { x: -0.12, y: -0.42, z: 0 },    // 5
  { x: -0.14, y: -0.60, z: 0 },    // 6
  { x: -0.15, y: -0.74, z: 0 },    // 7
  { x: -0.16, y: -0.88, z: 0 },    // 8: Index tip
  // Middle
  { x: 0.00, y: -0.45, z: 0 },     // 9
  { x: 0.00, y: -0.65, z: 0 },     // 10
  { x: 0.00, y: -0.82, z: 0 },     // 11
  { x: 0.00, y: -0.96, z: 0 },     // 12: Middle tip
  // Ring
  { x: 0.12, y: -0.41, z: 0 },     // 13
  { x: 0.13, y: -0.58, z: 0 },     // 14
  { x: 0.14, y: -0.73, z: 0 },     // 15
  { x: 0.15, y: -0.86, z: 0 },     // 16: Ring tip
  // Pinky
  { x: 0.22, y: -0.34, z: 0 },     // 17
  { x: 0.25, y: -0.48, z: 0 },     // 18
  { x: 0.27, y: -0.60, z: 0 },     // 19
  { x: 0.29, y: -0.72, z: 0 },     // 20: Pinky tip
];

// Clenched fist curl multipliers for fingers
const FIST_CURL = [
  { x: 0, y: 0, z: 0 },
  { x: -0.10, y: -0.10, z: 0.08 },
  { x: -0.15, y: -0.18, z: 0.12 },
  { x: -0.12, y: -0.25, z: 0.14 },
  { x: -0.06, y: -0.28, z: 0.14 },
  // Index curled
  { x: -0.10, y: -0.32, z: 0.08 },
  { x: -0.10, y: -0.38, z: 0.16 },
  { x: -0.09, y: -0.30, z: 0.18 },
  { x: -0.08, y: -0.24, z: 0.14 },
  // Middle curled
  { x: 0.00, y: -0.34, z: 0.08 },
  { x: 0.00, y: -0.40, z: 0.17 },
  { x: 0.00, y: -0.32, z: 0.19 },
  { x: 0.00, y: -0.25, z: 0.15 },
  // Ring curled
  { x: 0.10, y: -0.31, z: 0.08 },
  { x: 0.10, y: -0.37, z: 0.16 },
  { x: 0.09, y: -0.29, z: 0.18 },
  { x: 0.08, y: -0.23, z: 0.14 },
  // Pinky curled
  { x: 0.18, y: -0.27, z: 0.07 },
  { x: 0.19, y: -0.32, z: 0.14 },
  { x: 0.18, y: -0.25, z: 0.16 },
  { x: 0.16, y: -0.20, z: 0.12 },
];

// Pinch pose coordinates (thumb tip 4 and index tip 8 meet)
const PINCH_POSE = [
  { x: 0, y: 0, z: 0 },            // 0: Wrist
  // Thumb arched towards index
  { x: -0.12, y: -0.12, z: 0.02 }, // 1
  { x: -0.19, y: -0.24, z: 0.04 }, // 2
  { x: -0.22, y: -0.38, z: 0.05 }, // 3
  { x: -0.20, y: -0.52, z: 0.06 }, // 4: Thumb tip
  // Index curled down towards thumb tip
  { x: -0.12, y: -0.42, z: 0 },    // 5
  { x: -0.15, y: -0.52, z: 0.02 }, // 6
  { x: -0.18, y: -0.58, z: 0.04 }, // 7
  { x: -0.20, y: -0.52, z: 0.06 }, // 8: Index tip meets thumb tip
  // Middle, ring, pinky remain gracefully open
  { x: 0.00, y: -0.45, z: 0 },     // 9
  { x: 0.02, y: -0.63, z: -0.02 }, // 10
  { x: 0.03, y: -0.78, z: -0.04 }, // 11
  { x: 0.04, y: -0.90, z: -0.05 }, // 12
  { x: 0.12, y: -0.41, z: 0 },     // 13
  { x: 0.14, y: -0.56, z: -0.02 }, // 14
  { x: 0.16, y: -0.69, z: -0.04 }, // 15
  { x: 0.17, y: -0.80, z: -0.05 }, // 16
  { x: 0.22, y: -0.34, z: 0 },     // 17
  { x: 0.25, y: -0.46, z: -0.02 }, // 18
  { x: 0.27, y: -0.56, z: -0.04 }, // 19
  { x: 0.28, y: -0.66, z: -0.05 }, // 20
];

export class HandModel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'wave'; // 'wave' | 'dynamics' | 'pinch' | 'cutoff'
    this.running = false;
    this.trail = [];
    this.ripples = [];
    this.animate = this.animate.bind(this);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width || 300;
    this.h = r.height || 260;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  setMode(mode) {
    this.mode = mode;
    this.trail = [];
    this.ripples = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.animate);
  }

  stop() {
    this.running = false;
  }

  animate(now) {
    if (!this.running) return;
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const time = now / 1000;
    let handPos = { x: w * 0.5, y: h * 0.55 };
    let handScale = Math.min(w, h) * 0.32;
    let handRot = 0;
    let curl = 0;
    let pinchAmount = 0;
    let batonLength = handScale * 1.5;
    let showBaton = true;
    let beatLabel = '';
    let showLadder = false;
    let ladderDynamic = 0.5;

    // Calculate pose depending on mode
    if (this.mode === 'wave') {
      // The beat the camera listens for: rise, then fall into the beat and rebound.
      showBaton = true;
      const period = 0.8;
      const phase = (time % period) / period;
      const depth = phase < 0.72 ? 1 - phase / 0.72 : (phase - 0.72) / 0.28; // 1 = bottom of the beat
      handPos.x = w * 0.5 + Math.sin(time * 0.9) * w * 0.05;
      handPos.y = h * 0.42 + depth ** 2 * h * 0.2;
      handRot = -0.12 + depth * 0.18;
      beatLabel = 'Down into each beat, then up again';

      // A ripple as the baton lands on the beat
      const isNadir = phase < 0.06 || phase > 0.97;
      if (isNadir && (!this.lastRip || now - this.lastRip > 450)) {
        this.lastRip = now;
        this.ripples.push({
          x: handPos.x + Math.sin(handRot - 0.25) * batonLength,
          y: handPos.y - Math.cos(handRot - 0.25) * batonLength,
          t: now,
          color: '255, 220, 140',
          maxR: 45
        });
      }
    } else if (this.mode === 'dynamics') {
      // Height = Volume (Dynamics): Hand raised high = Forte; lowered = Piano
      showBaton = false;
      showLadder = true;
      const p = 0.5 + 0.5 * Math.sin(time * 1.8);
      ladderDynamic = p;
      handPos.y = h * (0.76 - 0.48 * p);
      handScale = Math.min(w, h) * (0.27 + 0.09 * p);
      handPos.x = w * 0.54;

      if (p > 0.7) {
        beatLabel = 'Hand high · forte';
      } else if (p < 0.3) {
        beatLabel = 'Hand low · piano';
      } else {
        beatLabel = 'In between · mezzo-forte';
      }
    } else if (this.mode === 'pinch') {
      // Pinch = Pluck (Pizzicato)
      showBaton = false;
      const cycle = time % 2.8;
      if (cycle < 1.1) {
        pinchAmount = 0;
        beatLabel = 'Open hand · arco, bowed';
      } else if (cycle < 1.35) {
        pinchAmount = Math.min(1, (cycle - 1.1) / 0.25);
        beatLabel = 'Thumb meets index finger…';
      } else if (cycle < 2.3) {
        pinchAmount = 1;
        beatLabel = 'Pinched · pizz., plucked';
        if (!this.lastPluck || now - this.lastPluck > 1800) {
          this.lastPluck = now;
          this.ripples.push({
            x: handPos.x - 0.20 * handScale,
            y: handPos.y - 0.52 * handScale,
            t: now,
            color: '255, 235, 120',
            maxR: 35
          });
        }
      } else {
        pinchAmount = 1 - (cycle - 2.3) / 0.5;
        beatLabel = 'Open again for arco';
      }
    } else if (this.mode === 'cutoff') {
      // Open hand then clench into fist
      showBaton = false;
      const cycle = time % 3.0;
      if (cycle < 1.2) {
        curl = 0;
        beatLabel = 'Open hand · playing';
      } else if (cycle < 1.6) {
        curl = Math.min(1, (cycle - 1.2) / 0.4);
        beatLabel = 'Close your hand…';
      } else if (cycle < 2.4) {
        curl = 1;
        beatLabel = 'Fist · everyone stops';
      } else {
        curl = 1 - (cycle - 2.4) / 0.6;
        beatLabel = 'Open to begin again';
      }
    }

    // Render baton and trail
    if (showBaton) {
      const batonTipX = handPos.x + Math.sin(handRot - 0.25) * batonLength;
      const batonTipY = handPos.y - Math.cos(handRot - 0.25) * batonLength;

      this.trail.push({ x: batonTipX, y: batonTipY, t: now });
      this.trail = this.trail.filter((p) => now - p.t < 600);

      // Render glowing trail
      if (this.trail.length > 1) {
        ctx.save();
        ctx.lineCap = 'round';
        for (let i = 1; i < this.trail.length; i++) {
          const a = this.trail[i - 1];
          const b = this.trail[i];
          const alpha = 1 - (now - b.t) / 600;
          ctx.strokeStyle = `rgba(237, 210, 154, ${alpha * 0.75})`;
          ctx.lineWidth = 1.5 + 5.0 * alpha;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Render golden baton
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 235, 185, 0.95)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(handPos.x, handPos.y);
      ctx.lineTo(batonTipX, batonTipY);
      ctx.stroke();

      // Glowing tip
      const tipGlow = ctx.createRadialGradient(batonTipX, batonTipY, 2, batonTipX, batonTipY, 18);
      tipGlow.addColorStop(0, 'rgba(255, 255, 235, 1)');
      tipGlow.addColorStop(0.4, 'rgba(237, 210, 154, 0.6)');
      tipGlow.addColorStop(1, 'rgba(237, 210, 154, 0)');
      ctx.fillStyle = tipGlow;
      ctx.beginPath();
      ctx.arc(batonTipX, batonTipY, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw dynamic height ladder on the left in dynamics mode
    if (showLadder) {
      const topY = 32;
      const botY = h - 36;
      const trackX = 32;

      ctx.save();
      // Track line
      ctx.strokeStyle = 'rgba(237, 210, 154, 0.25)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(trackX, topY);
      ctx.lineTo(trackX, botY);
      ctx.stroke();

      // Active fill
      const beadY = botY - (botY - topY) * ladderDynamic;
      ctx.strokeStyle = 'rgba(237, 210, 154, 0.75)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(trackX, botY);
      ctx.lineTo(trackX, beadY);
      ctx.stroke();

      // Beads/ticks
      ctx.fillStyle = 'rgba(237, 210, 154, 0.85)';
      ctx.font = '600 11px "Jost", sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('ff', trackX - 8, topY + 4);
      ctx.fillText('mf', trackX - 8, (topY + botY) * 0.5 + 4);
      ctx.fillText('p', trackX - 8, botY + 4);

      // Tracking bead
      const beadGlow = ctx.createRadialGradient(trackX, beadY, 1, trackX, beadY, 12);
      beadGlow.addColorStop(0, 'rgba(255, 255, 235, 1)');
      beadGlow.addColorStop(0.5, 'rgba(237, 210, 154, 0.7)');
      beadGlow.addColorStop(1, 'rgba(237, 210, 154, 0)');
      ctx.fillStyle = beadGlow;
      ctx.beginPath();
      ctx.arc(trackX, beadY, 12, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(trackX, beadY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Dynamic swell aura in dynamics mode
    if (this.mode === 'dynamics') {
      ctx.save();
      const auraR = handScale * (0.8 + ladderDynamic * 0.9);
      const auraGlow = ctx.createRadialGradient(
        handPos.x, handPos.y - handScale * 0.4, 8,
        handPos.x, handPos.y - handScale * 0.4, auraR
      );
      auraGlow.addColorStop(0, `rgba(255, 220, 130, ${0.12 + ladderDynamic * 0.38})`);
      auraGlow.addColorStop(1, 'rgba(255, 220, 130, 0)');
      ctx.fillStyle = auraGlow;
      ctx.beginPath();
      ctx.arc(handPos.x, handPos.y - handScale * 0.4, auraR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Shockwave ripples
    this.ripples = this.ripples.filter((r) => now - r.t < 650);
    for (const r of this.ripples) {
      const p = (now - r.t) / 650;
      const maxRadius = r.maxR || 50;
      ctx.save();
      ctx.strokeStyle = `rgba(${r.color || '255, 220, 140'}, ${(1 - p) * 0.85})`;
      ctx.lineWidth = 2.5 * (1 - p);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6 + p * maxRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Interpolate points between rest, fist, or pinch
    const pts = REST_HAND.map((base, i) => {
      let targetX = base.x;
      let targetY = base.y;
      if (this.mode === 'cutoff') {
        const fist = FIST_CURL[i];
        targetX = base.x + (fist.x - base.x) * curl;
        targetY = base.y + (fist.y - base.y) * curl;
      } else if (this.mode === 'pinch') {
        const pinch = PINCH_POSE[i];
        targetX = base.x + (pinch.x - base.x) * pinchAmount;
        targetY = base.y + (pinch.y - base.y) * pinchAmount;
      }

      // Rotate and position
      const cos = Math.cos(handRot);
      const sin = Math.sin(handRot);
      const rx = targetX * cos - targetY * sin;
      const ry = targetX * sin + targetY * cos;

      return {
        x: handPos.x + rx * handScale,
        y: handPos.y + ry * handScale,
      };
    });

    // Draw skeletal hand with gold luminous style
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(237, 210, 154, 0.7)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    }
    ctx.stroke();

    // Draw joints
    ctx.fillStyle = 'rgba(255, 240, 200, 0.95)';
    for (let i = 0; i < pts.length; i++) {
      const r = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) ? 3.5 : 2.2;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sparkle burst at contact point when pinching
    if (this.mode === 'pinch' && pinchAmount > 0.85) {
      const pinchPt = pts[4];
      ctx.fillStyle = 'rgba(255, 245, 180, 0.95)';
      ctx.shadowColor = 'rgba(255, 220, 100, 1)';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(pinchPt.x, pinchPt.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cutoff indicator ring when fist is closed
    if (this.mode === 'cutoff' && curl > 0.5) {
      ctx.strokeStyle = 'rgba(215, 65, 80, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(handPos.x, handPos.y - handScale * 0.3, 38, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Bottom caption badge
    if (beatLabel) {
      ctx.fillStyle = 'rgba(255, 235, 195, 0.95)';
      ctx.font = '500 13px "Jost", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(beatLabel, w * 0.5, h - 14);
    }

    ctx.restore();

    requestAnimationFrame(this.animate);
  }
}
