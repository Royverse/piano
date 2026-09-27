// The on-screen keys: layout with real piano proportions, and pointer input
// (click, multi-touch, and dragging across keys for a glissando).
import { isBlack, mod12 } from './theory.js';

export const LOWEST = 21; // A0
export const HIGHEST = 108; // C8

// Black keys aren't centred between white keys. On a real keyboard the
// C–E group splits its back edge into five equal parts and the F–B group
// into seven, which pushes C♯ and F♯ left and D♯ and A♯ right.
const WHITE_SLOT = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const BLACK_CENTER = { 1: 0.9, 3: 2.1, 6: 3 + 6 / 7, 8: 5, 10: 6 + 1 / 7 };
const BLACK_WIDTH = 0.58;

const unitLeft = (midi) => {
  const octave = Math.floor(midi / 12) * 7;
  const pc = mod12(midi);
  return isBlack(midi) ? octave + BLACK_CENTER[pc] - BLACK_WIDTH / 2 : octave + WHITE_SLOT[pc];
};

export const WHITE_KEYS = [];
for (let m = LOWEST; m <= HIGHEST; m++) if (!isBlack(m)) WHITE_KEYS.push(m);

/** The white keys to show so that `low…high` sits in the middle of `count` keys. */
export function visibleRange(count, low, high) {
  const lowIndex = WHITE_KEYS.findIndex((m) => m >= low);
  let highIndex = WHITE_KEYS.findIndex((m) => m >= high);
  if (highIndex < 0) highIndex = WHITE_KEYS.length - 1;
  const span = highIndex - lowIndex + 1;
  let start = count >= span ? lowIndex - Math.floor((count - span) / 2) : lowIndex;
  start = Math.max(0, Math.min(WHITE_KEYS.length - count, start));
  return [WHITE_KEYS[start], WHITE_KEYS[Math.min(WHITE_KEYS.length - 1, start + count - 1)]];
}

export class Keyboard {
  constructor(el, { onPress, onRelease, velocity }) {
    this.el = el;
    this.onPress = onPress;
    this.onRelease = onRelease;
    this.baseVelocity = velocity;
    this.keys = new Map();
    this.pointers = new Map();
    this.first = 48;
    this.last = 84;

    el.addEventListener('pointerdown', (e) => this.#down(e));
    el.addEventListener('pointermove', (e) => this.#move(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, (e) => this.#up(e));
    }
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setRange(first, last) {
    this.first = first;
    this.last = last;
    const origin = unitLeft(first);
    const total = unitLeft(last) + 1 - origin;
    const frag = document.createDocumentFragment();
    this.keys.clear();
    for (let midi = first; midi <= last; midi++) {
      const black = isBlack(midi);
      const key = document.createElement('div');
      key.className = `key ${black ? 'key-black' : 'key-white'}`;
      key.dataset.midi = midi;
      key.style.left = `${((unitLeft(midi) - origin) / total) * 100}%`;
      key.style.width = `${((black ? BLACK_WIDTH : 1) / total) * 100}%`;
      key.innerHTML = '<span class="key-mark"></span><span class="key-label"></span>';
      if (mod12(midi) === 0) {
        const octave = document.createElement('span');
        octave.className = 'key-octave';
        octave.textContent = `C${midi / 12 - 1}`;
        if (midi === 60) octave.title = 'Middle C';
        key.append(octave);
      }
      frag.append(key);
      this.keys.set(midi, key);
    }
    this.el.replaceChildren(frag);
    if (this.bowed) this.setBowed(this.bowed);
    this.el.style.setProperty('--white-count', WHITE_KEYS.filter((m) => m >= first && m <= last).length);
  }

  setDown(midi, down) {
    this.keys.get(midi)?.classList.toggle('is-down', down);
  }

  /** Notes the orchestra is holding, lit more softly than pressed keys. */
  setBowed(midis) {
    this.bowed = midis;
    for (const [midi, el] of this.keys) el.classList.toggle('is-bowed', midis.has(midi));
  }

  /** Letters (or note names) printed on the keys. */
  setLabels(labels) {
    for (const [midi, key] of this.keys) {
      key.querySelector('.key-label').textContent = labels.get(midi) ?? '';
    }
  }

  /** Mark the notes of a key: a dot on scale notes, a ring on the tonic. */
  setScale(key) {
    for (const [midi, el] of this.keys) {
      const inScale = key ? key.pcs.includes(mod12(midi)) : false;
      el.classList.toggle('in-scale', inScale);
      el.classList.toggle('is-tonic', !!key && mod12(midi) === key.tonicPc);
      el.classList.toggle('is-outside', !!key && !inScale);
    }
  }

  /** Where each key's centre is, in viewport pixels. */
  geometry() {
    return [...this.keys].map(([midi, el]) => {
      const r = el.getBoundingClientRect();
      return { midi, black: isBlack(midi), x: r.left + r.width / 2, width: r.width };
    });
  }

  #velocity(e, key) {
    // Playing nearer the front edge of a key is louder, as if you'd struck it harder.
    const r = key.getBoundingClientRect();
    const depth = (e.clientY - r.top) / r.height;
    return Math.min(1, Math.max(0.12, this.baseVelocity() + (depth - 0.55) * 0.5));
  }

  #keyAt(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest('.key');
    return hit && this.el.contains(hit) ? hit : null;
  }

  #down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const key = e.target.closest('.key');
    if (!key) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const midi = Number(key.dataset.midi);
    this.pointers.set(e.pointerId, midi);
    this.onPress(midi, this.#velocity(e, key), `pointer:${e.pointerId}`);
  }

  #move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const current = this.pointers.get(e.pointerId);
    const key = this.#keyAt(e.clientX, e.clientY);
    const midi = key ? Number(key.dataset.midi) : null;
    if (midi === current) return;
    const source = `pointer:${e.pointerId}`;
    if (current != null) this.onRelease(current, source);
    if (midi != null) this.onPress(midi, this.#velocity(e, key) * 0.9, source);
    this.pointers.set(e.pointerId, midi);
  }

  #up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const midi = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (midi != null) this.onRelease(midi, `pointer:${e.pointerId}`);
  }
}
