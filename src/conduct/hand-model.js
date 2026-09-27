// Interactive articulated hand model for demonstrating conductor gestures.
// Renders 21 anatomical landmarks and conductor baton with smooth 60fps animations.

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

export class HandModel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mode = 'wave'; // 'wave' | 'dynamics' | 'cue' | 'cutoff'
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
    let batonLength = handScale * 1.5;
    let showBaton = true;
    let beatLabel = '';

    // Calculate pose depending on mode
    if (this.mode === 'wave') {
      // 4/4 Conductor pattern animation:
      // Beat 1: Downbeat (t = 0.0)
      // Beat 2: Inward left (t = 0.25)
      // Beat 3: Outward right (t = 0.50)
      // Beat 4: Upbeat (t = 0.75)
      const period = 1.35; // ~88 BPM
      const phase = (time % period) / period;
      const angle = phase * Math.PI * 2;

      let dx = 0, dy = 0;
      if (phase < 0.25) {
        // Downbeat (1)
        const p = phase / 0.25;
        dx = -0.05 * Math.sin(p * Math.PI);
        dy = 0.18 * Math.sin(p * Math.PI / 2);
        if (p > 0.85) beatLabel = '1 · Down';
      } else if (phase < 0.50) {
        // Inward (2)
        const p = (phase - 0.25) / 0.25;
        dx = -0.22 * Math.sin(p * Math.PI / 2);
        dy = 0.18 - 0.08 * Math.sin(p * Math.PI / 2);
        if (p > 0.85) beatLabel = '2 · Left';
      } else if (phase < 0.75) {
        // Outward (3)
        const p = (phase - 0.50) / 0.25;
        dx = -0.22 + 0.44 * Math.sin(p * Math.PI / 2);
        dy = 0.10 - 0.04 * Math.sin(p * Math.PI / 2);
        if (p > 0.85) beatLabel = '3 · Right';
      } else {
        // Upbeat (4)
        const p = (phase - 0.75) / 0.25;
        dx = 0.22 - 0.22 * Math.sin(p * Math.PI / 2);
        dy = 0.06 - 0.24 * Math.sin(p * Math.PI / 2);
        if (p > 0.85) beatLabel = '4 · Up';
      }

      handPos.x = w * 0.5 + dx * w * 0.6;
      handPos.y = h * 0.52 + dy * h * 0.6;
      handRot = dx * 0.7;

      // Spawn beat ripples at bottom of downstroke
      if (phase > 0.22 && phase < 0.26 && (!this.lastRip || now - this.lastRip > 800)) {
        this.lastRip = now;
        this.ripples.push({ x: handPos.x, y: handPos.y + handScale * 0.9, t: now });
      }
    } else if (this.mode === 'dynamics') {
      // Swell up and down
      const p = 0.5 + 0.5 * Math.sin(time * 2.2);
      handPos.y = h * (0.68 - 0.32 * p);
      handScale = Math.min(w, h) * (0.28 + 0.12 * p);
      showBaton = false;
      curl = 0;
      beatLabel = p > 0.6 ? 'Forte (Loud)' : 'Piano (Soft)';
    } else if (this.mode === 'cue') {
      // Point left or right
      const p = Math.sin(time * 1.8);
      handPos.x = w * (0.5 + 0.25 * p);
      handRot = p * 0.5;
      showBaton = true;
      beatLabel = p < -0.2 ? 'Point Left (Cellos & Basses)' : p > 0.2 ? 'Point Right (Violins)' : 'Full Orchestra';
    } else if (this.mode === 'cutoff') {
      // Open hand then clench into fist
      const cycle = time % 3.0;
      if (cycle < 1.4) {
        curl = 0;
        beatLabel = 'Open hand (Playing)';
      } else if (cycle < 2.5) {
        curl = Math.min(1, (cycle - 1.4) / 0.3);
        beatLabel = 'Clench Fist (Cut off)';
      } else {
        curl = 1 - (cycle - 2.5) / 0.5;
        beatLabel = 'Release';
      }
      showBaton = false;
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

    // Shockwave ripples
    this.ripples = this.ripples.filter((r) => now - r.t < 650);
    for (const r of this.ripples) {
      const p = (now - r.t) / 650;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 220, 140, ${(1 - p) * 0.8})`;
      ctx.lineWidth = 2.5 * (1 - p);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + p * 45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Interpolate points between rest and fist
    const pts = REST_HAND.map((base, i) => {
      const fist = FIST_CURL[i];
      const lx = base.x + (fist.x - base.x) * curl;
      const ly = base.y + (fist.y - base.y) * curl;

      // Rotate and position
      const cos = Math.cos(handRot);
      const sin = Math.sin(handRot);
      const rx = lx * cos - ly * sin;
      const ry = lx * sin + ly * cos;

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
