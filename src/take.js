// Record a take, play it back, and pack it into a link.
// Format (before compression): version, voice, then per event a varint
// delay in ms, a type byte, and the note (plus velocity for note-ons).

export const EVENT = { ON: 0, OFF: 1, PEDAL_DOWN: 2, PEDAL_UP: 3 };
const VERSION = 1;
const MAX_MS = 10 * 60 * 1000;

export class Recorder {
  constructor() {
    this.events = [];
    this.startedAt = 0;
    this.recording = false;
  }

  start() {
    this.events = [];
    this.startedAt = performance.now();
    this.recording = true;
  }

  stop() {
    this.recording = false;
    // Trim silence at the start so playback begins with the first note.
    const first = this.events[0]?.t ?? 0;
    for (const e of this.events) e.t -= first;
    return this.events;
  }

  log(type, midi = 0, velocity = 0) {
    if (!this.recording) return;
    const t = performance.now() - this.startedAt;
    if (t > MAX_MS) return;
    this.events.push({ t, type, midi, velocity });
  }

  get elapsed() {
    return this.recording ? performance.now() - this.startedAt : 0;
  }
}

export const duration = (events) => (events.length ? events[events.length - 1].t : 0);

/** Play events against a clock, scheduling a little ahead for tight timing. */
export class Player {
  constructor(events, { now, schedule, onEnd }) {
    this.events = events;
    this.now = now; // seconds, on the audio clock
    this.schedule = schedule;
    this.onEnd = onEnd;
    this.index = 0;
    this.timer = 0;
  }

  start() {
    this.origin = this.now() + 0.08;
    this.tick();
    this.timer = setInterval(() => this.tick(), 25);
  }

  tick() {
    const horizon = this.now() + 0.15;
    while (this.index < this.events.length) {
      const e = this.events[this.index];
      const at = this.origin + e.t / 1000;
      if (at > horizon) break;
      this.schedule(e, at);
      this.index++;
    }
    if (this.index >= this.events.length) {
      clearInterval(this.timer);
      const tail = Math.max(0, this.origin + duration(this.events) / 1000 - this.now()) * 1000;
      this.endTimer = setTimeout(() => this.onEnd?.(), tail + 400);
    }
  }

  stop() {
    clearInterval(this.timer);
    clearTimeout(this.endTimer);
  }
}

/* ------------------------------------------------------------- encoding */

function writeVarint(bytes, n) {
  n = Math.max(0, Math.round(n));
  while (n >= 0x80) {
    bytes.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  bytes.push(n);
}

function readVarint(bytes, pos) {
  let n = 0;
  let scale = 1;
  for (;;) {
    const b = bytes[pos.i++];
    if (b === undefined) throw new Error('Take is cut short');
    n += (b & 0x7f) * scale;
    if (b < 0x80) return n;
    scale *= 128;
  }
}

export function pack(events, voiceIndex = 0) {
  const bytes = [VERSION, voiceIndex];
  let last = 0;
  for (const e of events) {
    writeVarint(bytes, e.t - last);
    last = Math.round(e.t);
    bytes.push(e.type);
    if (e.type === EVENT.ON) bytes.push(e.midi, Math.max(1, Math.min(127, Math.round(e.velocity * 127))));
    else if (e.type === EVENT.OFF) bytes.push(e.midi);
  }
  return new Uint8Array(bytes);
}

export function unpack(bytes) {
  if (bytes[0] !== VERSION) throw new Error('This take was made with a different version');
  const voiceIndex = bytes[1];
  const events = [];
  const pos = { i: 2 };
  let t = 0;
  while (pos.i < bytes.length) {
    t += readVarint(bytes, pos);
    const type = bytes[pos.i++];
    if (type === EVENT.ON) events.push({ t, type, midi: bytes[pos.i++], velocity: bytes[pos.i++] / 127 });
    else if (type === EVENT.OFF) events.push({ t, type, midi: bytes[pos.i++] });
    else if (type === EVENT.PEDAL_DOWN || type === EVENT.PEDAL_UP) events.push({ t, type });
    else throw new Error('Take contains an unknown event');
  }
  return { voiceIndex, events };
}

const toBase64Url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function through(stream, bytes) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Events → a short URL-safe string ("z…" when compressed). */
export async function encode(events, voiceIndex) {
  const raw = pack(events, voiceIndex);
  if (typeof CompressionStream === 'function') {
    try {
      return `z${toBase64Url(await through(new CompressionStream('deflate-raw'), raw))}`;
    } catch { /* fall through to uncompressed */ }
  }
  return `r${toBase64Url(raw)}`;
}

export async function decode(text) {
  const kind = text[0];
  let bytes = fromBase64Url(text.slice(1));
  if (kind === 'z') bytes = await through(new DecompressionStream('deflate-raw'), bytes);
  else if (kind !== 'r') throw new Error('Not a take link');
  return unpack(bytes);
}
