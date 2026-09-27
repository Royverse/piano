// The conductor's light: tracked hands drawn in gold, a glowing baton tip,
// dynamic ribbon trails, beat ripples, stardust sparks, and clear visual cues.
import { BONES } from './hands.js';

const TRAIL_MS = 750;

export class BatonView {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.hands = [];
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
    this.fistProgress = 0;
    this.state = 'intro';
    this.beats = 0;
    this.source = 'camera';
    this.running = false;
    this.frame = this.frame.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  // Camera coordinates are relative to the video, which is cropped to cover
  // the stage; mouse coordinates are already relative to the stage.
  toStage(p) {
    if (this.source !== 'camera' || !this.video.videoWidth) return { x: p.x * this.w, y: p.y * this.h };
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const scale = Math.max(this.w / vw, this.h / vh);
    return {
      x: p.x * vw * scale + (this.w - vw * scale) / 2,
      y: p.y * vh * scale + (this.h - vh * scale) / 2,
    };
  }

  show(hands, t, { fistProgress = 0, state = 'playing', beats = 0 } = {}) {
    this.hands = hands;
    this.fistProgress = fistProgress;
    this.state = state;
    this.beats = beats;

    const baton = [...hands].sort((a, b) => a.x - b.x).pop();
    if (baton) {
      const pt = this.toStage(baton);
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 2 || t - last.t > 35) {
        this.trail.push({ ...pt, t });
      }
    }
    this.#wake();
  }

  beat(point, strength) {
    const pt = this.toStage(point);
    this.ripples.push({ ...pt, t: performance.now(), strength });
    const count = 10 + Math.round(strength * 16);
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (30 + Math.random() * 110) * (0.6 + 0.6 * strength);
      this.sparks.push({
        x: pt.x,
        y: pt.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        t: now,
        life: 500 + Math.random() * 400,
        size: 1.4 + Math.random() * 2.4,
      });
    }
    this.#wake();
  }

  setState(state, beats = this.beats) {
    this.state = state;
    this.beats = beats;
    this.#wake();
  }

  clear() {
    this.hands = [];
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
    this.fistProgress = 0;
    this.beats = 0;
    this.#wake();
  }

  #wake() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  frame(now) {
    const { ctx, w, h, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    this.trail = this.trail.filter((p) => now - p.t < TRAIL_MS);
    this.ripples = this.ripples.filter((r) => now - r.t < 750);
    this.sparks = this.sparks.filter((s) => now - s.t < s.life);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const sortedHands = [...this.hands].sort((a, b) => a.x - b.x);
    const batonHand = sortedHands[sortedHands.length - 1];
    const exprHand = sortedHands.length > 1 ? sortedHands[0] : null;

    // Hands: thin gold bones with soft luminous joints
    for (const hand of this.hands) {
      if (!hand.points) continue;
      const isBaton = hand === batonHand;
      const pts = hand.points.map((p) => this.toStage(p));

      ctx.strokeStyle = isBaton ? 'rgba(237, 210, 154, 0.55)' : 'rgba(214, 180, 112, 0.35)';
      ctx.lineWidth = isBaton ? 1.8 : 1.4;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();

      // Fingertips
      ctx.fillStyle = isBaton ? 'rgba(255, 235, 180, 0.95)' : 'rgba(230, 210, 160, 0.75)';
      for (const i of [4, 8, 12, 16, 20]) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, i === 8 && isBaton ? 5 : 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Radiant glowing Baton Tip at index finger
      if (isBaton && pts[8]) {
        const tip = pts[8];
        const radGlow = ctx.createRadialGradient(tip.x, tip.y, 2, tip.x, tip.y, 24);
        radGlow.addColorStop(0, 'rgba(255, 248, 220, 0.95)');
        radGlow.addColorStop(0.35, 'rgba(237, 210, 154, 0.45)');
        radGlow.addColorStop(1, 'rgba(237, 210, 154, 0)');
        ctx.fillStyle = radGlow;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 24, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Silky luminous ribbon trail
    if (this.trail.length > 1) {
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1];
        const b = this.trail[i];
        const life = Math.max(0, 1 - (now - b.t) / TRAIL_MS);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        ctx.strokeStyle = `rgba(255, 226, 160, ${0.85 * life})`;
        ctx.lineWidth = 1.5 + 6.0 * life;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x, a.y, midX, midY);
        ctx.stroke();
      }
    }

    // Beat shockwave ripples
    for (const r of this.ripples) {
      const p = (now - r.t) / 750;
      ctx.strokeStyle = `rgba(255, 218, 150, ${(1 - p) * (0.45 + 0.55 * r.strength)})`;
      ctx.lineWidth = 2.5 * (1 - p) + 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + p * (46 + 60 * r.strength), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Conductor's stardust
    for (const s of this.sparks) {
      const age = (now - s.t) / s.life;
      const elapsed = (now - s.t) / 1000;
      const px = s.x + s.vx * elapsed;
      const py = s.y + s.vy * elapsed + 26 * elapsed ** 2;
      const alpha = (1 - age) * 0.95;
      ctx.fillStyle = `rgba(255, 235, 175, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.6, s.size * (1 - age * 0.45)), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    // Clenched fist cut-off countdown ring
    if (this.fistProgress > 0.05 && batonHand) {
      const p = this.toStage(batonHand.points?.[0] ?? batonHand);
      ctx.save();
      ctx.strokeStyle = 'rgba(210, 66, 79, 0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 36, -Math.PI / 2, -Math.PI / 2 + this.fistProgress * Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(245, 235, 215, 0.95)';
      ctx.font = '500 12px "Jost", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Cut off…', p.x, p.y - 46);
      ctx.restore();
    }

    // Friendly guide prompts rendered directly on the stage when waiting
    if (this.beats === 0 && (this.state === 'ready' || this.state === 'tuning')) {
      const pulse = 0.75 + 0.25 * Math.sin(now / 350);
      const cx = w * 0.5;
      const cy = h * 0.45;
      const isCam = this.source === 'camera';
      const mainText = isCam ? 'Wave hand down & up to strike the beat' : 'Drag down & up or tap to beat';
      const subText = isCam ? 'Your pace sets the tempo · Larger gestures play louder' : 'Press Space or click [♩ Beat] at your tempo';

      ctx.save();
      ctx.fillStyle = `rgba(237, 210, 154, ${pulse * 0.9})`;
      ctx.font = 'italic 500 20px "Bodoni Moda", serif';
      ctx.textAlign = 'center';
      ctx.fillText(mainText, cx, cy);

      ctx.fillStyle = `rgba(214, 180, 112, ${pulse * 0.65})`;
      ctx.font = '400 13px "Jost", sans-serif';
      ctx.fillText(subText, cx, cy + 26);

      // Downward chevron guide
      const arrowY = cy + 42 + Math.sin(now / 300) * 8;
      ctx.strokeStyle = `rgba(237, 210, 154, ${pulse * 0.8})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx - 14, arrowY);
      ctx.lineTo(cx, arrowY + 12);
      ctx.lineTo(cx + 14, arrowY);
      ctx.stroke();
      ctx.restore();
    } else if (this.state === 'holding') {
      const cx = w * 0.5;
      const cy = h * 0.42;
      const pulse = 0.7 + 0.3 * Math.sin(now / 400);

      ctx.save();
      ctx.fillStyle = `rgba(237, 210, 154, ${pulse * 0.95})`;
      ctx.font = 'italic 500 21px "Bodoni Moda", serif';
      ctx.textAlign = 'center';
      ctx.fillText('Holding (fermata) — wave to continue', cx, cy);
      ctx.restore();
    }

    const needsNext = this.trail.length || this.ripples.length || this.sparks.length ||
      this.hands.length || this.beats === 0 || this.state === 'holding';
    if (needsNext) requestAnimationFrame(this.frame);
    else this.running = false;
  }
}
