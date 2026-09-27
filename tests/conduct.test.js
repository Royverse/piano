import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Conductor, tempoMark, dynamicMark } from '../src/conduct/gesture.js';
import { Score, SECTIONS } from '../src/conduct/score.js';
import { cameraProblem } from '../src/conduct/hands.js';
import { OneEuro, HandStabilizer } from '../src/conduct/filter.js';
import { mod12, noteName, spellInKey } from '../src/theory.js';

// A conducting hand: bouncing down and up at `bpm`, sampled like a camera.
function conduct(conductor, { bpm = 80, seconds = 6, size = 0.2, fps = 30, jitter = 0.004, open = 1 } = {}) {
  const beats = [];
  const period = 60 / bpm;
  let seed = 7;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2 * jitter;
  };
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i / fps) * 1000;
    // Rest at the top, then a quick fall into the beat — like a real baton.
    const phase = ((i / fps) % period) / period;
    const y = 0.35 + size * (phase < 0.75 ? 1 - phase / 0.75 : (phase - 0.75) / 0.25) ** 2 + noise();
    conductor.update({ t, hands: [{ x: 0.6, y, open }] });
  }
  return beats;
}

test('hears one beat per stroke and reads the tempo', () => {
  for (const bpm of [60, 90, 132]) {
    const beats = [];
    const c = new Conductor({ beat: (b) => beats.push(b) });
    conduct(c, { bpm, seconds: 8 });
    const expected = Math.floor((8 * bpm) / 60);
    assert.ok(Math.abs(beats.length - expected) <= 1, `${bpm} bpm: ${beats.length} beats, expected ~${expected}`);
    assert.ok(Math.abs(c.tempo - bpm) < bpm * 0.08, `${bpm} bpm read as ${c.tempo?.toFixed(1)}`);
  }
});

test('ignores a hand that only trembles', () => {
  const beats = [];
  const c = new Conductor({ beat: (b) => beats.push(b) });
  conduct(c, { bpm: 90, size: 0.012, jitter: 0.006 });
  assert.equal(beats.length, 0);
});

test('bigger beats play louder', () => {
  const small = new Conductor();
  conduct(small, { size: 0.07 });
  const big = new Conductor();
  conduct(big, { size: 0.32 });
  assert.ok(big.dynamic > small.dynamic + 0.3, `${small.dynamic.toFixed(2)} vs ${big.dynamic.toFixed(2)}`);
});

test('a closed fist cuts the orchestra off, once', () => {
  let cuts = 0;
  const c = new Conductor({ cutoff: () => cuts++ });
  for (let i = 0; i < 30; i++) c.update({ t: i * 33, hands: [{ x: 0.5, y: 0.5, open: 0.1 }] });
  assert.equal(cuts, 1);
});

test('raising and lowering the hand is noticed', () => {
  const events = [];
  const c = new Conductor({ raise: () => events.push('raise'), lower: () => events.push('lower') });
  c.update({ t: 0, hands: [{ x: 0.5, y: 0.5, open: 1 }] });
  c.update({ t: 100, hands: [] });
  c.update({ t: 1000, hands: [] });
  assert.deepEqual(events, ['raise', 'lower']);
});

test('names tempo and dynamics the way a score does', () => {
  assert.equal(tempoMark(50), 'Largo');
  assert.equal(tempoMark(84), 'Andante');
  assert.equal(tempoMark(140), 'Allegro');
  assert.equal(dynamicMark(0), 'pp');
  assert.equal(dynamicMark(0.55), 'mf');
  assert.equal(dynamicMark(1), 'ff');
});

test('the Canon walks its ground bass: D A B F♯ G D G A', () => {
  const score = new Score('canon');
  const roots = [];
  for (let i = 0; i < 16; i++) {
    const plan = score.next({ intensity: 0.5 });
    if (plan.changed) roots.push(noteName(spellInKey(plan.chord.rootPc, score.key)));
  }
  assert.deepEqual(roots, ['D', 'A', 'B', 'F♯', 'G', 'D', 'G', 'A']);
});

test('every section stays in range and the chord is complete', () => {
  const RANGES = { basses: [28, 50], cellos: [36, 62], violas: [48, 74], violins2: [55, 81], violins1: [62, 91] };
  for (const piece of ['canon', 'lament', 'anthem', 'nocturne']) {
    const score = new Score(piece);
    for (let i = 0; i < 32; i++) {
      const plan = score.next({ intensity: (i % 4) / 3 });
      for (const s of SECTIONS) {
        const m = plan.notes[s];
        assert.ok(m >= RANGES[s][0] && m <= RANGES[s][1], `${piece} beat ${i}: ${s} out of range (${m})`);
      }
      if (plan.changed) {
        const sounding = new Set(SECTIONS.map((s) => mod12(plan.notes[s])));
        if (plan.chord.thirdPc != null) assert.ok(sounding.has(plan.chord.thirdPc), `${piece} beat ${i}: no third`);
        assert.equal(mod12(plan.notes.basses), plan.chord.bassPc, `${piece} beat ${i}: wrong bass`);
      }
    }
  }
});

test('inner voices move smoothly', () => {
  const score = new Score('nocturne');
  let prev = null;
  for (let i = 0; i < 32; i++) {
    const plan = score.next({ intensity: 0.2 });
    if (prev) for (const s of ['violas', 'violins2']) assert.ok(Math.abs(plan.notes[s] - prev[s]) <= 7, `${s} leapt ${plan.notes[s] - prev[s]}`);
    prev = plan.notes;
  }
});

test('conducting harder adds half-beat notes in the violins', () => {
  const calm = new Score('anthem');
  const wild = new Score('anthem');
  let calmAfter = 0;
  let wildAfter = 0;
  for (let i = 0; i < 16; i++) {
    calmAfter += calm.next({ intensity: 0.2 }).after.length;
    wildAfter += wild.next({ intensity: 0.9 }).after.length;
  }
  assert.equal(calmAfter, 0);
  assert.ok(wildAfter >= 12);
});

test('"Your chords" follows the keys you hold', () => {
  const score = new Score('yours', 0);
  assert.ok(score.next({ held: [] }).silent);
  const plan = score.next({ held: [57, 60, 64] }); // A minor
  assert.equal(mod12(plan.notes.basses), 9);
  const sounding = new Set(SECTIONS.map((s) => mod12(plan.notes[s])));
  for (const pc of [9, 0, 4]) assert.ok(sounding.has(pc));
  const held = score.next({ held: [] }); // let go: the orchestra keeps the chord
  assert.equal(mod12(held.notes.basses), 9);
});

test('cameraProblem explains failures in clear, actionable terms', () => {
  assert.match(cameraProblem({ name: 'NotAllowedError' }), /blocked/i);
  assert.match(cameraProblem({ name: 'NotFoundError' }), /No camera was found/i);
  assert.match(cameraProblem({ name: 'NotReadableError' }), /Another app is using the camera/i);
  assert.match(cameraProblem(new Error('Network error')), /Hand tracking couldn't load/i);
});

test('tapBeat strikes a beat, tracks coordinates, and calculates tempo', () => {
  const beats = [];
  const c = new Conductor({ beat: (b) => beats.push(b) });
  c.tapBeat(1000, 0.25, { x: 0.4, y: 0.6 });
  c.tapBeat(1600, 0.25, { x: 0.45, y: 0.65 });
  assert.equal(beats.length, 2);
  assert.equal(beats[0].x, 0.4);
  assert.equal(beats[1].x, 0.45);
  assert.ok(Math.abs(c.tempo - 100) < 5, `Expected tempo ~100 bpm, got ${c.tempo}`);
});

test('OneEuro filter suppresses high frequency tremor while adapting to fast motion', () => {
  const filter = new OneEuro({ minCutoff: 1.0, beta: 6.0 });
  // Stationary with tremor (noise +/- 0.05 around 0.5)
  let sumTremor = 0;
  for (let i = 0; i < 30; i++) {
    const raw = 0.5 + (i % 2 === 0 ? 0.05 : -0.05);
    const out = filter.filter(raw, i * 33);
    if (i > 10) sumTremor += Math.abs(out - 0.5);
  }
  const avgTremor = sumTremor / 20;
  assert.ok(avgTremor < 0.02, `Tremor should be smoothed out, got ${avgTremor}`);

  // Fast movement to 0.9: should quickly track within 2 frames
  filter.filter(0.9, 1000);
  const fast = filter.filter(0.9, 1033);
  assert.ok(fast > 0.82, `Fast movement should follow with low lag, got ${fast}`);
});

test('HandStabilizer tracks hand identity and smooths coordinates', () => {
  const stab = new HandStabilizer();
  const raw1 = [{ x: 0.6, y: 0.4, open: 0.8, points: Array(21).fill({ x: 0.6, y: 0.4 }) }];
  const s1 = stab.update(raw1, 100);
  assert.equal(s1.length, 1);
  const initialId = s1[0].id;

  // Next frame: slightly moved
  const raw2 = [{ x: 0.61, y: 0.41, open: 0.79, points: Array(21).fill({ x: 0.61, y: 0.41 }) }];
  const s2 = stab.update(raw2, 133);
  assert.equal(s2.length, 1);
  assert.equal(s2[0].id, initialId, 'Hand ID should remain consistent across frames');
});

test('a still hand holds (fermata); a drifting one keeps the music going', () => {
  const still = new Conductor();
  const drifting = new Conductor();
  for (let i = 0; i < 90; i++) {
    const t = i * 33;
    still.update({ t, hands: [{ x: 0.5, y: 0.5, open: 1 }] });
    drifting.update({ t, hands: [{ x: 0.5 + 0.12 * Math.sin(t / 400), y: 0.5, open: 1 }] });
  }
  assert.equal(still.snapshot().gesture, 'hold');
  assert.notEqual(drifting.snapshot().gesture, 'hold');
});
