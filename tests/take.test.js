import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, EVENT, pack, unpack } from '../src/take.js';

const events = [
  { t: 0, type: EVENT.ON, midi: 60, velocity: 0.7 },
  { t: 12, type: EVENT.ON, midi: 64, velocity: 0.5 },
  { t: 140, type: EVENT.PEDAL_DOWN },
  { t: 480, type: EVENT.OFF, midi: 60 },
  { t: 20000, type: EVENT.OFF, midi: 64 },
  { t: 20010, type: EVENT.PEDAL_UP },
];

test('packs and unpacks a take losslessly (to the millisecond)', () => {
  const { voiceIndex, events: back } = unpack(pack(events, 2));
  assert.equal(voiceIndex, 2);
  assert.equal(back.length, events.length);
  back.forEach((e, i) => {
    assert.equal(e.t, events[i].t);
    assert.equal(e.type, events[i].type);
    if (e.type !== EVENT.PEDAL_DOWN && e.type !== EVENT.PEDAL_UP) assert.equal(e.midi, events[i].midi);
    if (e.type === EVENT.ON) assert.ok(Math.abs(e.velocity - events[i].velocity) < 0.01);
  });
});

test('round-trips through a URL-safe string', async () => {
  const text = await encode(events, 1);
  assert.match(text, /^[zr][A-Za-z0-9_-]+$/);
  const { voiceIndex, events: back } = await decode(text);
  assert.equal(voiceIndex, 1);
  assert.equal(back.length, events.length);
});

test('rejects links that are not takes', async () => {
  await assert.rejects(() => decode('x123'));
  await assert.rejects(() => decode('rAAAA'));
});
