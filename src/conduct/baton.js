// The conductor's light: tracked hands drawn in gold, a glowing baton tip
// and its trail, a ripple and a scatter of sparks on every beat, a dynamics
// gauge that follows your hand, and a short prompt while the orchestra waits.
import { BONES } from './hands.js';

const TRAIL_MS = 700;
const RIPPLE_MS = 750;
const PROMPTS = {
  tuning: { camera: ['Raise your hand', 'The orchestra is tuning. They\'ll quiet down and watch you.'],
    mouse: ['Press on the stage', 'Then drag down to give the first beat.'] },
  ready: { camera: ['Beat down to begin', 'Drop your hand into the beat and let it bounce back up.'],
    mouse: ['Drag down to begin', 'Or tap the stage, or press Space, on each beat.'] },
  holding: { camera: ['Holding', 'Beat again to go on, or close your hand to stop.'],
    mouse: ['Holding', 'Beat again to go on, or press Esc to stop.'] },
};

export class BatonView {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.video = video;
    this.source = 'camera';
    this.state = 'off';
    this.beats = 0;
    this.hands = [];
    this.snap = {};
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
    this.running = false;
    this.top = 0;
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
    this.#measure();
    this.#wake();
  }

  // On narrow screens the readout sits above the strings rather than beside
  // them: keep the gauge and prompts in the open space below it.
  #measure() {
    const readout = document.querySelector('[data-readout]');
    const canvas = this.canvas.getBoundingClientRect();
    const stacked = readout && getComputedStyle(readout).position !== 'absolute';
    this.top = stacked ? Math.max(0, readout.getBoundingClientRect().bottom - canvas.top) : 0;
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

  /** New hand positions, plus what the conductor makes of them. */
  show(hands, t, snap) {
    this.hands = hands;
    this.snap = snap;
    const baton = this.#baton();
    if (baton) {
      const pt = this.toStage(baton);
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 2 || t - last.t > 35) this.trail.push({ ...pt, t });
    }
    this.#wake();
  }

  beat(point, strength) {
    const pt = this.toStage(point);
    const now = performance.now();
    this.ripples.push({ ...pt, t: now, strength });
    const count = Math.round(4 + strength * 18);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (30 + Math.random() * 100) * (0.6 + 0.6 * strength);
      this.sparks.push({
        x: pt.x,
        y: pt.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 25,
        t: now,
        life: 450 + Math.random() * 400,
        size: 1.2 + Math.random() * 2.2,
      });
    }
    this.#wake();
  }

  setState(state, beats = this.beats) {
    this.state = state;
    this.beats = beats;
    this.#measure();
    this.#wake();
  }

  clear() {
    this.hands = [];
    this.snap = {};
    this.trail = [];
    this.ripples = [];
    this.sparks = [];
    this.#wake();
  }

  #baton() {
    return [...this.hands].sort((a, b) => a.x - b.x).pop();
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
    this.ripples = this.ripples.filter((r) => now - r.t < RIPPLE_MS);
    this.sparks = this.sparks.filter((s) => now - s.t < s.life);

    const conducting = ['tuning', 'ready', 'playing', 'holding', 'cut', 'bravo'].includes(this.state);
    if (!conducting) {
      this.running = false;
      return;
    }

    const snap = this.snap ?? {};
    const sorted = [...this.hands].sort((a, b) => a.x - b.x);
    const baton = sorted[sorted.length - 1];

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Hands: thin gold bones; the baton hand a little brighter.
    for (const hand of this.hands) {
      if (!hand.points) continue;
      const lead = hand === baton;
      const pts = hand.points.map((p) => this.toStage(p));
      ctx.strokeStyle = lead ? 'rgba(237, 210, 154, 0.55)' : 'rgba(214, 180, 112, 0.32)';
      ctx.lineWidth = lead ? 1.8 : 1.3;
      ctx.beginPath();
      for (const [a, b] of BONES) {
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
      }
      ctx.stroke();
      ctx.fillStyle = lead ? 'rgba(255, 235, 180, 0.95)' : 'rgba(230, 210, 160, 0.7)';
      for (const i of [4, 8, 12, 16, 20]) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, i === 8 && lead ? 4.5 : 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The baton tip glows wherever it is — a hand or the mouse.
    if (baton) {
      const tip = this.toStage(baton.points?.[8] ?? baton);
      const glow = ctx.createRadialGradient(tip.x, tip.y, 2, tip.x, tip.y, 22);
      glow.addColorStop(0, 'rgba(255, 248, 220, 0.9)');
      glow.addColorStop(0.35, 'rgba(237, 210, 154, 0.4)');
      glow.addColorStop(1, 'rgba(237, 210, 154, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 22, 0, Math.PI * 2);
      ctx.fill();
    }

    // The trail, thinning as it fades.
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const life = Math.max(0, 1 - (now - b.t) / TRAIL_MS);
      ctx.strokeStyle = `rgba(255, 226, 160, ${0.8 * life})`;
      ctx.lineWidth = 1.2 + 5.5 * life;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Each beat: a ring spreading from where it landed…
    for (const r of this.ripples) {
      const p = (now - r.t) / RIPPLE_MS;
      ctx.strokeStyle = `rgba(255, 218, 150, ${(1 - p) * (0.35 + 0.55 * r.strength)})`;
      ctx.lineWidth = 2.4 * (1 - p) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 9 + p * (40 + 60 * r.strength), 0, Math.PI * 2);
      ctx.stroke();
    }
    // …and a scatter of sparks.
    for (const s of this.sparks) {
      const age = (now - s.t) / s.life;
      const el = (now - s.t) / 1000;
      ctx.fillStyle = `rgba(255, 235, 175, ${(1 - age) * 0.9})`;
      ctx.beginPath();
      ctx.arc(s.x + s.vx * el, s.y + s.vy * el + 26 * el ** 2, Math.max(0.5, s.size * (1 - age * 0.45)), 0, Math.PI * 2);
      ctx.fill();
    }

    // Both hands high: a bridge of light between them.
    if (sorted.length > 1 && snap.gesture === 'tutti') {
      const p1 = this.toStage(sorted[0].points?.[8] ?? sorted[0]);
      const p2 = this.toStage(sorted[1].points?.[8] ?? sorted[1]);
      const g = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
      g.addColorStop(0, 'rgba(255, 215, 120, 0.35)');
      g.addColorStop(0.5, 'rgba(255, 245, 220, 0.75)');
      g.addColorStop(1, 'rgba(255, 215, 120, 0.35)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo((p1.x + p2.x) / 2, Math.min(p1.y, p2.y) - 28, p2.x, p2.y);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Closing the hand: a ring fills before the cut-off lands.
    if ((snap.fistProgress ?? 0) > 0.05 && baton) {
      const p = this.toStage(baton.points?.[0] ?? baton);
      ctx.strokeStyle = 'rgba(210, 66, 79, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34, -Math.PI / 2, -Math.PI / 2 + snap.fistProgress * Math.PI * 2);
      ctx.stroke();
    }

    // Score marks at the baton tip for the special gestures.
    const mark = snap.pizzicato ? 'pizz.' : snap.gesture === 'tutti' ? 'tutti' : null;
    if (mark && baton) {
      const tip = this.toStage(baton.points?.[8] ?? baton);
      ctx.font = 'italic 600 17px "Bodoni Moda", serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(246, 226, 173, 0.95)';
      ctx.fillText(mark, tip.x, Math.max(20, tip.y - 30));
    }

    this.#gauge(snap);
    const prompting = this.#prompt(now);

    const busy = this.trail.length || this.ripples.length || this.sparks.length || this.hands.length
      || prompting || (snap.fistProgress ?? 0) > 0;
    if (busy) requestAnimationFrame(this.frame);
    else this.running = false;
  }

  // Height is volume: a slim gauge on the left, marked as a score would.
  #gauge(snap) {
    if (!this.hands.length && this.state !== 'playing') return;
    const { ctx, h } = this;
    const x = 30;
    const room = h - this.top;
    const top = this.top + room * 0.14;
    const bottom = this.top + room * 0.72;
    const level = Math.min(1, Math.max(0.03, snap.dynamic ?? 0.35));
    const y = bottom - level * (bottom - top);

    ctx.strokeStyle = 'rgba(237, 210, 154, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();

    const fill = ctx.createLinearGradient(0, bottom, 0, top);
    fill.addColorStop(0, 'rgba(214, 180, 112, 0.3)');
    fill.addColorStop(1, 'rgba(255, 235, 180, 0.9)');
    ctx.strokeStyle = fill;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 245, 220, 0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'italic 700 14px "Bodoni Moda", serif';
    ctx.textAlign = 'left';
    const marks = [['ff', top, level > 0.72], ['mf', (top + bottom) / 2, level >= 0.38 && level <= 0.72], ['p', bottom, level < 0.38]];
    for (const [label, my, on] of marks) {
      ctx.fillStyle = on ? 'rgba(255, 235, 180, 0.95)' : 'rgba(214, 180, 112, 0.4)';
      ctx.fillText(label, x + 12, my + 5);
    }
  }

  // While the orchestra waits, say what to do — in the middle of the stage,
  // where the eyes already are.
  #prompt(now) {
    const text = PROMPTS[this.state]?.[this.source === 'camera' ? 'camera' : 'mouse'];
    if (!text || (this.state !== 'holding' && this.beats > 0)) return false;
    const { ctx, w, h } = this;
    const pulse = 0.78 + 0.22 * Math.sin(now / 380);
    const cx = this.top ? w * 0.5 : w * 0.42;
    const cy = this.top + (h - this.top) * 0.42;
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(237, 210, 154, ${0.95 * pulse})`;
    ctx.font = 'italic 400 26px "Bodoni Moda", serif';
    ctx.fillText(text[0], cx, cy);
    ctx.fillStyle = 'rgba(214, 190, 150, 0.7)';
    ctx.font = '400 13px "Jost", sans-serif';
    ctx.fillText(text[1], cx, cy + 26);
    if (this.state === 'ready') {
      const ay = cy + 44 + Math.sin(now / 300) * 6;
      ctx.strokeStyle = `rgba(237, 210, 154, ${0.8 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - 12, ay);
      ctx.lineTo(cx, ay + 10);
      ctx.lineTo(cx + 12, ay);
      ctx.stroke();
    }
    return true;
  }
}
