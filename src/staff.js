// A small grand staff that engraves whatever is being played.
import { diatonicStep, accidental } from './theory.js';

const NS = 'http://www.w3.org/2000/svg';
const HALF = 4; // half a staff space, in SVG units
const WIDTH = 176;
const HEIGHT = 188;

// Each staff: bottom line's y and the step (letter + 7·octave) that sits on it.
const TREBLE = { bottomY: 76, bottomStep: 30, top: 38 }; // E4 … F5
const BASS = { bottomY: 148, bottomStep: 18, top: 26 }; // G2 … A3

// Key-signature placement, as staff steps, in the order they're written.
const SHARP_STEPS = { treble: [38, 35, 39, 36, 33, 37, 34], bass: [24, 21, 25, 22, 19, 23, 20] };
const FLAT_STEPS = { treble: [34, 37, 33, 36, 32, 35, 31], bass: [20, 23, 19, 22, 18, 21, 17] };
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]; // F C G D A E B
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]; // B E A D G C F

const el = (name, attrs = {}, text) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  return node;
};

const yOf = (staff, step) => staff.bottomY - (step - staff.bottomStep) * HALF;

// A whole note: a tilted oval ring.
function notehead(x, y) {
  const rx = 5.4;
  const ry = 3.9;
  const ix = 2.1;
  const iy = 3.5;
  const a = (-55 * Math.PI) / 180;
  const cx = Math.cos(a) * ix;
  const cy = Math.sin(a) * ix;
  const d = `M${x - rx},${y}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z`
    + `M${x - cx},${y - cy}a${ix},${iy} -55 1,1 ${2 * cx},${2 * cy}a${ix},${iy} -55 1,1 ${-2 * cx},${-2 * cy}Z`;
  return el('path', { d, 'fill-rule': 'evenodd', class: 'staff-note' });
}

export function renderStaff(svg, notes, key) {
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  const g = el('g');

  // Lines and system bar.
  for (const staff of [TREBLE, BASS]) {
    for (let i = 0; i < 5; i++) {
      const y = staff.bottomY - i * 2 * HALF;
      g.append(el('line', { x1: 2, x2: WIDTH - 2, y1: y, y2: y, class: 'staff-line' }));
    }
  }
  g.append(el('line', { x1: 2, x2: 2, y1: yOf(TREBLE, TREBLE.top), y2: BASS.bottomY, class: 'staff-bar' }));
  g.append(el('text', { x: 6, y: yOf(TREBLE, 32) + 9.5, class: 'staff-clef staff-clef-treble' }, '𝄞'));
  g.append(el('text', { x: 6, y: yOf(BASS, 24) + 8.5, class: 'staff-clef staff-clef-bass' }, '𝄢'));

  // Key signature.
  const sig = key?.signature ?? Array(7).fill(0);
  const sharps = SHARP_ORDER.filter((l) => sig[l] > 0).length;
  const flats = FLAT_ORDER.filter((l) => sig[l] < 0).length;
  let x = 34;
  const count = Math.max(sharps, flats);
  for (const [name, staff] of [['treble', TREBLE], ['bass', BASS]]) {
    for (let i = 0; i < count; i++) {
      const step = (sharps ? SHARP_STEPS : FLAT_STEPS)[name][i];
      g.append(el('text', { x: x + i * 7, y: yOf(staff, step) + (sharps ? 4.5 : 3), class: 'staff-acc' }, sharps ? '♯' : '♭'));
    }
  }
  x += count * 7;

  // Notes: middle C and up on the treble staff, the rest on the bass.
  const noteX = Math.max(x + 34, 108);
  const placed = notes.map((n) => ({ ...n, step: diatonicStep(n.midi, n.sp) }));
  const treble = placed.filter((n) => n.midi >= 60);
  const bass = placed.filter((n) => n.midi < 60);

  for (const [staff, group, name] of [[TREBLE, treble, 'treble'], [BASS, bass, 'bass']]) {
    if (!group.length) continue;
    // Too many ledger lines: write it an octave away and say so.
    let shift = 0;
    const hi = Math.max(...group.map((n) => n.step));
    const lo = Math.min(...group.map((n) => n.step));
    if (name === 'treble' && hi > staff.top + 7) shift = -7;
    if (name === 'bass' && lo < staff.bottomStep - 6) shift = 7;
    if (shift) {
      const y = shift < 0 ? yOf(staff, staff.top) - 16 : staff.bottomY + 22;
      g.append(el('text', { x: noteX - 10, y, class: 'staff-ottava' }, shift < 0 ? '8va' : '8vb'));
    }

    // Seconds can't share a column: nudge the upper note to the right.
    const sorted = group.map((n) => ({ ...n, step: n.step + shift })).sort((a, b) => a.step - b.step);
    let prev = null;
    for (const n of sorted) {
      n.offset = prev && n.step - prev.step <= 1 && !prev.offset ? 11 : 0;
      prev = n;
    }

    for (const n of sorted) {
      const y = yOf(staff, n.step);
      const cx = noteX + n.offset;
      // Ledger lines above or below the staff.
      const ledgers = [];
      for (let s = staff.bottomStep - 2; s >= n.step; s -= 2) ledgers.push(s);
      for (let s = staff.top + 2; s <= n.step; s += 2) ledgers.push(s);
      for (const s of ledgers) {
        const ly = yOf(staff, s);
        g.append(el('line', { x1: cx - 9, x2: cx + 9, y1: ly, y2: ly, class: 'staff-ledger' }));
      }
      g.append(notehead(cx, y));
    }

    // Accidentals, stacked into columns so they never collide.
    const columns = [];
    for (const n of [...sorted].reverse()) {
      const shown = key ? n.sp.acc !== sig[n.sp.letter] : n.sp.acc !== 0;
      if (!shown) continue;
      let col = 0;
      while ((columns[col] ?? []).some((s) => Math.abs(s - n.step) < 6)) col++;
      (columns[col] ??= []).push(n.step);
      const glyph = n.sp.acc === 0 ? '♮' : accidental(n.sp.acc);
      g.append(el('text', { x: noteX - 16 - col * 9, y: yOf(staff, n.step) + 4.5, class: 'staff-acc' }, glyph));
    }
  }

  svg.replaceChildren(g);
}
