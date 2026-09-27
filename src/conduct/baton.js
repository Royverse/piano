// The conductor's light: tracked hands drawn in gold, a trail behind the
// baton, and a ripple wherever a beat lands.
import { BONES } from './hands.js';

const TRAIL_MS = 650;

export class BatonView {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.hands = [];
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
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

  show(hands, t) {
    this.hands = hands;
    const baton = [...hands].sort((a, b) => a.x - b.x).pop();
    if (baton) this.trail.push({ ...this.toStage(baton), t });
    this.#wake();
  }

  beat(point, strength) {
    const pt = this.toStage(point);
    this.ripples.push({ ...pt, t: performance.now(), strength });
    const count = 8 + Math.round(strength * 14);
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (25 + Math.random() * 95) * (0.6 + 0.6 * strength);
      this.sparks.push({
        x: pt.x,
        y: pt.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 22,
        t: now,
        life: 450 + Math.random() * 350,
        size: 1.2 + Math.random() * 2.2,
      });
    }
    this.#wake();
  }

  clear() {
    this.hands = [];
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
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
    this.ripples = this.ripples.filter((r) => now - r.t < 700);

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Hands: thin gold bones, bright fingertips.
    for (const hand of this.hands) {
      if (!hand.points) continue;
      const pts = hand.points.map((p) => this.toStage(p));
      ctx.strokeStyle = 'rgba(214, 180, 112, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      ctx.fillStyle = 'rgba(246, 226, 173, 0.9)';
      for (const i of [4, 8, 12, 16, 20]) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, i === 8 ? 4 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The baton's trail, thinning as it fades.
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const life = 1 - (now - b.t) / TRAIL_MS;
      ctx.strokeStyle = `rgba(255, 222, 160, ${0.75 * life})`;
      ctx.lineWidth = 1 + 5 * life;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Each beat: a ring spreading out from where it landed.
    for (const r of this.ripples) {
      const p = (now - r.t) / 700;
      ctx.strokeStyle = `rgba(255, 214, 150, ${(1 - p) * (0.4 + 0.5 * r.strength)})`;
      ctx.lineWidth = 2 * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 8 + p * (40 + 50 * r.strength), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Conductor's stardust: golden particles that burst and float from the ictus
    this.sparks = this.sparks.filter((s) => now - s.t < s.life);
    for (const s of this.sparks) {
      const age = (now - s.t) / s.life;
      const elapsed = (now - s.t) / 1000;
      const px = s.x + s.vx * elapsed;
      const py = s.y + s.vy * elapsed + 24 * elapsed ** 2;
      const alpha = (1 - age) * 0.9;
      ctx.fillStyle = `rgba(255, 226, 160, ${alpha})`;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0.5, s.size * (1 - age * 0.5)), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    if (this.trail.length || this.ripples.length || this.sparks.length || this.hands.length) requestAnimationFrame(this.frame);
    else this.running = false;
  }
}
