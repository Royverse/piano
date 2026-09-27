import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNote, VOICES } from '../src/audio/synth.js';

const RATE = 48000;

for (const voice of Object.keys(VOICES)) {
  test(`${voice}: every key renders a clean, audible note`, () => {
    for (let midi = 21; midi <= 108; midi += 5) {
      const { samples, rate } = renderNote(voice, midi, RATE);
      assert.ok(rate === RATE || rate === RATE / 2, `rate ${rate}`);
      let peak = 0;
      let early = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        assert.ok(Number.isFinite(v), `${voice} ${midi}: non-finite sample at ${i}`);
        peak = Math.max(peak, Math.abs(v));
        if (i < rate * 0.2) early += v * v;
      }
      assert.ok(peak < 1, `${voice} ${midi}: peak ${peak.toFixed(2)} clips`);
      assert.ok(Math.sqrt(early / (rate * 0.2)) > 0.05, `${voice} ${midi}: too quiet`);
      assert.ok(Math.abs(samples[0]) < 1e-9, 'starts at silence (no click)');
      assert.ok(Math.abs(samples[samples.length - 1]) < 1e-3, 'ends at silence');
    }
  });
}

test('the same note always renders the same samples', () => {
  const a = renderNote('grand', 60, RATE).samples;
  const b = renderNote('grand', 60, RATE).samples;
  assert.deepEqual(a.slice(0, 2000), b.slice(0, 2000));
});
