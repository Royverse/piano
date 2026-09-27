import { Engine, ROOMS } from './audio/engine.js';
import { VOICES } from './audio/synth.js';
import { Keyboard, visibleRange, LOWEST, HIGHEST } from './keyboard.js';
import { Strings } from './strings.js';
import { Readout } from './readout.js';
import {
  analyze, makeKey, diatonicChords, mod12, noteName, spellInKey, SCALES, SCALE_GROUPS, CIRCLE_OF_FIFTHS, JUST_CENTS,
} from './theory.js';
import { Recorder, Player, EVENT, encode, decode, duration } from './take.js';
import { connectMidi, midiAllowed, midiSupported } from './midi.js';
import { loadSettings, saveSettings } from './settings.js';
import { ConductMode } from './conduct/conduct.js';
import { PIECES } from './conduct/score.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const DYNAMICS = [['pp', 0.3], ['p', 0.42], ['mp', 0.55], ['mf', 0.68], ['f', 0.82], ['ff', 0.96]];
const VOICE_IDS = Object.keys(VOICES);

// Computer keyboard, by physical key so it works on any layout:
// the middle row plays white keys, the row above plays black keys.
const CHROMATIC_CODES = ['KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG', 'KeyY', 'KeyH',
  'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP', 'Semicolon', 'Quote'];
// "Stay in key": the middle row walks up the scale, the top row repeats it an octave higher.
const HOME_ROW = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
const TOP_ROW = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight'];
const CODE_FALLBACK = { Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']' };

const settings = loadSettings();
if (!VOICES[settings.voice]) settings.voice = 'grand';
const save = () => saveSettings(settings);

const state = {
  key: settings.keyTonic == null ? null : makeKey(settings.keyTonic, settings.keyMode),
  held: new Map(), // midi → sources holding it down (pointer, key, MIDI, chord, take)
  sustained: new Set(), // released while the pedal was down: still sounding
  struck: new Map(), // midi → when it was last struck
  pedal: new Set(), // sources holding the pedal
  keyMap: new Map(), // key code → midi
  lastNotes: [], // what the readout last showed
  lastNotesAt: 0,
  group: [], // notes struck together since the hands last lifted
  groupAt: 0,
};
const keysDown = new Map(); // key code → midi it started, so octave changes never strand a note
const chordsDown = new Map(); // source → notes of a held chord

/* ------------------------------------------------------------- elements */

const ui = {
  keys: $('[data-keyboard]'),
  range: $('[data-range]'),
  dynamic: $('[data-dynamic-value]'),
  pedal: $('[data-pedal]'),
  keyValue: $('[data-key-value]'),
  roomValue: $('[data-room-value]'),
  circle: $('[data-circle]'),
  keyOff: $('[data-key-off]'),
  mode: $('[data-mode]'),
  stay: $('[data-stay]'),
  tuningNote: $('[data-tuning-note]'),
  volume: $('[data-volume]'),
  chords: $('[data-chords]'),
  chordsKey: $('[data-chords-key]'),
  chordsRow: $('[data-chords-row]'),
  help: $('[data-help]'),
  toast: $('[data-toast]'),
  midiStatus: $('[data-midi-status]'),
  midiText: $('[data-midi-text]'),
  midiConnect: $('[data-midi-connect]'),
  take: $('[data-take]'),
  takeRecordLabel: $('[data-take-record-label]'),
  takeTime: $('[data-take-time]'),
  takePlay: $('[data-take-play]'),
};

const engine = new Engine();
engine.setVoice(settings.voice);
engine.setRoom(settings.room);
engine.setVolume(settings.volume);

const velocity = () => DYNAMICS[settings.dynamic][1];
const keyboard = new Keyboard(ui.keys, {
  onPress: (midi, vel, source) => press(midi, vel, source),
  onRelease: (midi, source) => release(midi, source),
  velocity,
});
const strings = new Strings($('[data-strings]'));
const readout = new Readout($('[data-readout]'));
const recorder = new Recorder();
const conduct = new ConductMode({
  engine,
  keyboard,
  strings,
  readout,
  getKey: () => state.key,
  getHeld: () => [...state.held.keys()],
  onChange: syncConduct,
});
if (PIECES[settings.piece]) conduct.pieceId = settings.piece;
// The key marked on the keys: while conducting, the key of the music being played.
const shownKey = () => (conduct.active ? conduct.score.key : state.key);

/* ------------------------------------------------------- playing notes */

const pedalDown = () => state.pedal.size > 0;

// Visual updates for scheduled notes (takes, rolled chords) land on time.
function atTime(at, fn) {
  const delay = at ? (at - engine.ctx.currentTime) * 1000 : 0;
  if (delay > 4) setTimeout(fn, delay);
  else fn();
}

function press(midi, vel, source, at = 0) {
  if (midi < LOWEST || midi > HIGHEST) return;
  if (!engine.running) {
    engine.resume();
    if (source === 'midi') notifySoundOff();
  }
  if (!state.held.size) {
    state.group = [];
    state.groupAt = performance.now();
  }
  state.group.push(midi);
  let sources = state.held.get(midi);
  if (!sources) state.held.set(midi, (sources = new Set()));
  sources.add(source);
  state.sustained.delete(midi);
  state.struck.set(midi, performance.now());
  engine.noteOn(midi, vel, at);
  if (source !== 'take') recorder.log(EVENT.ON, midi, vel);
  atTime(at, () => {
    strings.strike(midi, vel, settings.voice);
    keyboard.setDown(midi, true);
  });
  refreshReadout();
}

function release(midi, source, at = 0) {
  const sources = state.held.get(midi);
  if (!sources?.delete(source) || sources.size) return;
  state.held.delete(midi);
  if (source !== 'take') recorder.log(EVENT.OFF, midi);
  if (pedalDown()) state.sustained.add(midi);
  else engine.noteOff(midi, at);
  atTime(at, () => {
    strings.release(midi);
    keyboard.setDown(midi, false);
  });
  refreshReadout();
}

function releaseAll(prefix) {
  for (const [midi, sources] of [...state.held]) {
    for (const s of [...sources]) if (s.startsWith(prefix)) release(midi, s);
  }
}

function setPedal(source, down, at = 0) {
  const was = pedalDown();
  if (down) state.pedal.add(source);
  else state.pedal.delete(source);
  const now = pedalDown();
  if (was === now) return;
  if (source !== 'take') recorder.log(now ? EVENT.PEDAL_DOWN : EVENT.PEDAL_UP);
  engine.setPedal(now);
  if (!now) {
    for (const midi of state.sustained) engine.noteOff(midi, at);
    state.sustained.clear();
  }
  atTime(at, () => {
    strings.setPedal(now);
    ui.pedal.setAttribute('aria-pressed', String(now));
  });
  refreshReadout();
}

let soundHintShown = false;
function notifySoundOff() {
  if (soundHintShown) return;
  soundHintShown = true;
  toast('Click anywhere on the page to turn the sound on.');
}

/* ------------------------------------------------------------- readout */

let readoutTimer = 0;
let staleTimer = 0;
// Wait a moment so the notes of a chord land together.
function refreshReadout() {
  clearTimeout(readoutTimer);
  readoutTimer = setTimeout(updateReadout, 30);
}

function soundingNotes() {
  // Held keys, plus pedalled notes struck in the last few seconds —
  // so an arpeggio played into the pedal reads as its chord.
  const now = performance.now();
  const notes = [...state.held.keys()];
  for (const m of state.sustained) if (now - (state.struck.get(m) ?? 0) < 4000) notes.push(m);
  return notes;
}

function updateReadout() {
  const notes = soundingNotes();
  const opts = { key: state.key, tuning: settings.tuning };
  clearTimeout(staleTimer);
  if (conduct.active) return; // the orchestra has the readout
  if (state.sustained.size) staleTimer = setTimeout(updateReadout, 1000);
  if (notes.length) {
    state.lastNotes = notes;
    state.lastNotesAt = performance.now();
    const analysis = analyze(notes, state.key, opts);
    readout.show(analysis, opts);
    matchChord(analysis);
  } else if (state.lastNotes.length || state.group.length) {
    // A tap can be over before the readout catches it: fall back to the
    // notes struck together most recently.
    const notesToShow = state.lastNotesAt >= state.groupAt ? state.lastNotes : state.group;
    const analysis = analyze(notesToShow, state.key, opts);
    readout.show(analysis, opts);
    matchChord(analysis);
    readout.rest();
  } else {
    readout.idle(state.key);
  }
}

/* ----------------------------------------------------- computer keyboard */

let layoutMap = null;
navigator.keyboard?.getLayoutMap?.().then((map) => {
  layoutMap = map;
  updateLabels();
}).catch(() => {});

const codeLabel = (code) => (layoutMap?.get(code) ?? CODE_FALLBACK[code] ?? code.replace(/^Key/, '')).toUpperCase();

function rebuildKeyMap() {
  state.keyMap.clear();
  const c = 12 * (settings.octave + 1);
  if (settings.stayInKey && state.key) {
    const { steps } = state.key.scale;
    const tonic = c + state.key.tonicPc - (state.key.tonicPc > 6 ? 12 : 0);
    const degree = (i) => tonic + steps[i % steps.length] + 12 * Math.floor(i / steps.length);
    HOME_ROW.forEach((code, i) => state.keyMap.set(code, degree(i)));
    TOP_ROW.forEach((code, i) => state.keyMap.set(code, degree(i + steps.length)));
  } else {
    CHROMATIC_CODES.forEach((code, i) => state.keyMap.set(code, c + i));
  }
}

function homeRange() {
  const codes = settings.stayInKey && state.key ? HOME_ROW : CHROMATIC_CODES;
  const midis = codes.map((code) => state.keyMap.get(code));
  return [Math.min(...midis), Math.max(...midis)];
}

const isTyping = (el) => el?.matches?.('select, textarea, input:not([type=radio]):not([type=checkbox]):not([type=range])');

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
  if (e.key === '?' || (e.code === 'Slash' && e.shiftKey)) {
    e.preventDefault();
    toggleHelp();
    return;
  }
  if (ui.help.open) return;

  if (conduct.active && conduct.state !== 'intro') {
    if (e.code === 'Space' || e.code === 'ArrowDown') {
      if (document.activeElement && document.activeElement !== document.body && !document.activeElement.matches?.('[data-conduct-beat]')) return;
      e.preventDefault();
      conduct.manualBeat();
      return;
    }
  }

  if (e.code === 'Space') {
    // Space still presses a focused button for keyboard users.
    if (document.activeElement && document.activeElement !== document.body) return;
    e.preventDefault();
    if (!e.repeat) setPedal('space', true);
    return;
  }

  const midi = state.keyMap.get(e.code);
  if (midi != null) {
    e.preventDefault();
    if (e.repeat || keysDown.has(e.code)) return;
    keysDown.set(e.code, midi);
    press(midi, velocity(), `key:${e.code}`);
    return;
  }
  if (e.repeat) return;

  const digit = /^Digit([1-7])$/.exec(e.code);
  if (digit && state.key?.heptatonic) {
    e.preventDefault();
    if (!chordsDown.has(`key:${e.code}`)) playChord(Number(digit[1]) - 1, e.shiftKey, `key:${e.code}`);
    return;
  }

  const actions = {
    KeyZ: () => shiftOctave(-1),
    KeyX: () => shiftOctave(1),
    KeyC: () => shiftDynamic(-1),
    KeyV: () => shiftDynamic(1),
    Escape: () => (conduct.active ? conduct.escape() : document.activeElement?.blur?.()),
  };
  if (actions[e.code]) {
    e.preventDefault();
    actions[e.code]();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') setPedal('space', false);
  if (keysDown.has(e.code)) {
    release(keysDown.get(e.code), `key:${e.code}`);
    keysDown.delete(e.code);
  }
  if (chordsDown.has(`key:${e.code}`)) releaseChord(`key:${e.code}`);
});

// Leaving the tab mid-note would otherwise leave keys stuck down.
function letGo() {
  releaseAll('key:');
  keysDown.clear();
  for (const source of [...chordsDown.keys()]) releaseChord(source);
  setPedal('space', false);
}
window.addEventListener('blur', letGo);
document.addEventListener('visibilitychange', () => document.hidden && letGo());

// After a mouse click, hand the focus back so Space works as the pedal.
document.addEventListener('pointerup', (e) => {
  const control = e.target.closest?.('button, label, input[type=radio], input[type=checkbox]');
  if (control && !control.closest('[popover], dialog')) requestAnimationFrame(() => document.activeElement?.blur?.());
});
document.addEventListener('pointerdown', () => engine.resume(), { capture: true });

/* --------------------------------------------------------------- layout */

function layout(force = false) {
  const width = ui.keys.clientWidth;
  if (!width) return;
  const target = width < 520 ? 38 : width < 900 ? 42 : 46;
  const count = clamp(Math.round(width / target), 8, 52);
  const [lo, hi] = homeRange();
  const [first, last] = visibleRange(count, lo, hi);
  if (force || first !== keyboard.first || last !== keyboard.last) {
    keyboard.setRange(first, last);
    keyboard.setScale(shownKey());
    for (const midi of state.held.keys()) keyboard.setDown(midi, true);
    updateLabels();
  }
  const name = (m) => noteName(spellInKey(m, state.key)) + (Math.floor(m / 12) - 1);
  ui.range.textContent = `${name(first)} – ${name(last)}`;
  requestAnimationFrame(() => strings.setKeys(keyboard.geometry()));
  prepareSounds();
}

function prepareSounds() {
  const [lo, hi] = homeRange();
  const mid = (lo + hi) / 2;
  const wanted = new Set(state.keyMap.values());
  for (let m = keyboard.first; m <= keyboard.last; m++) wanted.add(m);
  const mapped = new Set(state.keyMap.values());
  engine.prepare([...wanted].sort((a, b) => (mapped.has(b) - mapped.has(a)) || Math.abs(a - mid) - Math.abs(b - mid)));
}

function updateLabels() {
  const labels = new Map();
  if (settings.labels === 'letters') {
    for (const [code, midi] of state.keyMap) if (!labels.has(midi)) labels.set(midi, codeLabel(code));
  } else if (settings.labels === 'notes') {
    for (let m = keyboard.first; m <= keyboard.last; m++) labels.set(m, noteName(spellInKey(m, state.key)));
  }
  keyboard.setLabels(labels);
}

function shiftOctave(delta) {
  const next = clamp(settings.octave + delta, 1, 6);
  if (next === settings.octave) return;
  settings.octave = next;
  save();
  rebuildKeyMap();
  layout();
}

function shiftDynamic(delta) {
  settings.dynamic = clamp(settings.dynamic + delta, 0, DYNAMICS.length - 1);
  ui.dynamic.textContent = DYNAMICS[settings.dynamic][0];
  save();
}

new ResizeObserver(() => layout()).observe(ui.keys);
$$('[data-octave]').forEach((b) => b.addEventListener('click', () => shiftOctave(Number(b.dataset.octave))));
$$('[data-dynamic]').forEach((b) => b.addEventListener('click', () => shiftDynamic(Number(b.dataset.dynamic))));
ui.pedal.addEventListener('click', () => setPedal('button', !state.pedal.has('button')));

/* --------------------------------------------------------------- voices */

function setVoice(id) {
  if (!VOICES[id]) return;
  settings.voice = id;
  engine.setVoice(id);
  save();
  $$('[data-voice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.voice === id)));
  prepareSounds();
}

const voiceButtons = $$('[data-voice]');
voiceButtons.forEach((b, i) => {
  b.addEventListener('click', () => setVoice(b.dataset.voice));
  b.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = voiceButtons[(i + step + voiceButtons.length) % voiceButtons.length];
    next.focus();
    setVoice(next.dataset.voice);
  });
});

/* ------------------------------------------------------------------ key */

function buildKeyPanel() {
  CIRCLE_OF_FIFTHS.forEach((pc, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'circle-note';
    b.setAttribute('role', 'radio');
    b.dataset.pc = pc;
    b.style.setProperty('--i', i);
    b.addEventListener('click', () => setKey(pc, settings.keyMode));
    ui.circle.append(b);
  });
  for (const [label, ids] of SCALE_GROUPS) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const id of ids) {
      const label2 = SCALES[id].label;
      group.append(new Option(label2.charAt(0).toUpperCase() + label2.slice(1), id));
    }
    ui.mode.append(group);
  }
  ui.mode.addEventListener('change', () => setKey(settings.keyTonic ?? 0, ui.mode.value));
  ui.keyOff.addEventListener('click', () => setKey(null, settings.keyMode));
  ui.stay.addEventListener('change', () => {
    releaseAll('key:');
    keysDown.clear();
    settings.stayInKey = ui.stay.checked;
    save();
    rebuildKeyMap();
    layout();
    updateLabels();
  });
}

function updateKeyUI() {
  for (const b of $$('.circle-note', ui.circle)) {
    const pc = Number(b.dataset.pc);
    b.textContent = noteName(makeKey(pc, settings.keyMode).tonic);
    b.setAttribute('aria-checked', String(state.key?.tonicPc === pc));
  }
  ui.keyOff.setAttribute('aria-pressed', String(!state.key));
  ui.keyOff.textContent = state.key ? 'No key' : 'No key set';
  ui.keyValue.textContent = state.key ? state.key.name : 'Off';
  ui.mode.value = settings.keyMode;
  ui.stay.checked = settings.stayInKey;
  ui.stay.disabled = !state.key;
}

function setKey(tonicPc, mode) {
  releaseAll('key:');
  keysDown.clear();
  settings.keyTonic = tonicPc;
  settings.keyMode = mode;
  save();
  state.key = tonicPc == null ? null : makeKey(tonicPc, mode);
  keyboard.setScale(state.key);
  strings.setScale(state.key);
  applyTuning();
  rebuildKeyMap();
  layout();
  updateLabels();
  renderChords();
  updateKeyUI();
  updateReadout();
  conduct.keyChanged();
}

/* --------------------------------------------------------------- chords */

function renderChords() {
  const show = !!state.key?.heptatonic;
  ui.chords.hidden = !show;
  if (!show) return;
  ui.chordsKey.textContent = state.key.name;
  ui.chordsRow.replaceChildren(...diatonicChords(state.key).map((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chord';
    b.dataset.index = i;
    b.setAttribute('aria-label', `Play ${c.numeral}, ${c.symbol}`);
    b.innerHTML = `<span class="chord-digit" aria-hidden="true">${i + 1}</span>`
      + `<span class="chord-numeral">${c.numeral}</span><span class="chord-symbol">${c.symbol}</span>`;
    return b;
  }));
}

function chordNotes(index, sevenths) {
  const chord = diatonicChords(state.key, sevenths)[index];
  // Chords stay in the warm middle of the piano, whatever octave the letters play.
  const c = 12 * (clamp(settings.octave, 3, 5) + 1);
  const root = c + chord.rootPc - (chord.rootPc > 7 ? 12 : 0);
  return [root - 12, ...chord.intervals.map((i) => root + i)];
}

function playChord(index, sevenths, source) {
  const notes = chordNotes(index, sevenths);
  chordsDown.set(source, notes);
  // A slight roll from the bass up, as a pianist would place it.
  const t = engine.ctx.currentTime;
  notes.forEach((m, i) => press(m, velocity() * (i === 0 ? 0.85 : 1), source, i ? t + i * 0.014 : 0));
}

function releaseChord(source) {
  const notes = chordsDown.get(source) ?? [];
  chordsDown.delete(source);
  notes.forEach((m) => release(m, source));
}

function matchChord(analysis) {
  const buttons = $$('.chord', ui.chordsRow);
  buttons.forEach((b) => b.classList.remove('is-match'));
  if (analysis.kind !== 'chord' || !state.key?.heptatonic) return;
  const triads = diatonicChords(state.key);
  const sevenths = diatonicChords(state.key, true);
  const i = triads.findIndex((c, k) => c.rootPc === analysis.rootPc
    && (c.chord.id === analysis.chord.id || sevenths[k].chord.id === analysis.chord.id));
  if (i >= 0) buttons[i].classList.add('is-match');
}

ui.chordsRow.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.chord');
  if (!b) return;
  e.preventDefault();
  b.setPointerCapture(e.pointerId);
  playChord(Number(b.dataset.index), e.shiftKey, `chord:${e.pointerId}`);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  ui.chordsRow.addEventListener(type, (e) => {
    if (chordsDown.has(`chord:${e.pointerId}`)) releaseChord(`chord:${e.pointerId}`);
  });
}
// Keyboard activation (Enter on a focused chord) plays it briefly.
ui.chordsRow.addEventListener('click', (e) => {
  const b = e.target.closest('.chord');
  if (!b || e.detail !== 0) return;
  playChord(Number(b.dataset.index), false, 'chord:key');
  setTimeout(() => releaseChord('chord:key'), 700);
});

/* ---------------------------------------------------------------- sound */

function applyTuning() {
  const just = settings.tuning === 'just' && state.key;
  engine.setDetune(just ? (m) => JUST_CENTS[mod12(m - state.key.tonicPc)] : null);
  if (settings.tuning === 'equal') ui.tuningNote.textContent = 'Every semitone the same size, as on a modern piano.';
  else if (state.key) ui.tuningNote.textContent = `Pure intervals above ${noteName(state.key.tonic)}. Chords in the key ring without beating.`;
  else ui.tuningNote.textContent = 'Just intonation is tuned to a key note. Choose a key to hear it.';
}

function bindRadios(name, value, onChange) {
  $$(`input[name="${name}"]`).forEach((input) => {
    input.checked = input.value === value;
    input.addEventListener('change', () => input.checked && onChange(input.value));
  });
}

bindRadios('room', settings.room, (v) => {
  settings.room = v;
  engine.setRoom(v);
  ui.roomValue.textContent = ROOMS[v].label;
  save();
});
bindRadios('tuning', settings.tuning, (v) => {
  settings.tuning = v;
  applyTuning();
  save();
  refreshReadout();
});
bindRadios('labels', settings.labels, (v) => {
  settings.labels = v;
  updateLabels();
  save();
});
ui.volume.value = settings.volume;
ui.volume.addEventListener('input', () => {
  settings.volume = Number(ui.volume.value);
  engine.setVolume(settings.volume);
  save();
});

/* ----------------------------------------------------------------- MIDI */

async function startMidi() {
  if (!midiSupported()) {
    ui.midiText.textContent = "This browser can't use MIDI keyboards. Chrome, Edge and Firefox can.";
    ui.midiConnect.hidden = true;
    return;
  }
  engine.resume();
  try {
    await connectMidi({
      onNote: (m, v) => press(m, v, 'midi'),
      onRelease: (m) => release(m, 'midi'),
      onPedal: (down) => setPedal('midi', down),
      onDevices: (names) => {
        ui.midiConnect.hidden = true;
        ui.midiStatus.hidden = !names.length;
        ui.midiStatus.textContent = names.length ? `MIDI · ${names[0]}` : '';
        ui.midiText.textContent = names.length
          ? `Playing from ${names.join(', ')}.`
          : 'No keyboard found yet. Plug one in and it connects by itself.';
      },
    });
  } catch {
    ui.midiText.textContent = 'MIDI access is blocked. Allow MIDI for this site in your browser settings, then choose Connect again.';
  }
}
ui.midiConnect.addEventListener('click', startMidi);
midiAllowed().then((ok) => ok && startMidi());

/* ----------------------------------------------------------------- take */

let take = null;
let player = null;
let clock = 0;

const formatTime = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function setTakeState(name) {
  ui.take.dataset.state = name;
  ui.takeRecordLabel.textContent = name === 'recording' ? 'Stop' : take ? 'Record again' : 'Record';
  ui.takePlay.textContent = name === 'playing' ? 'Stop' : 'Play take';
  if (take && name !== 'recording') ui.takeTime.textContent = formatTime(duration(take.events));
}

function startRecording() {
  stopPlayback();
  recorder.start();
  if (pedalDown()) recorder.log(EVENT.PEDAL_DOWN);
  setTakeState('recording');
  ui.takeTime.textContent = '0:00';
  clock = setInterval(() => { ui.takeTime.textContent = formatTime(recorder.elapsed); }, 250);
}

function stopRecording() {
  clearInterval(clock);
  const events = recorder.stop();
  if (!events.some((e) => e.type === EVENT.ON)) {
    setTakeState(take ? 'ready' : 'idle');
    toast('Nothing was recorded. Press Record, then play.');
    return;
  }
  // Close any notes still held so the take ends cleanly.
  const t = events[events.length - 1].t;
  for (const midi of state.held.keys()) events.push({ t, type: EVENT.OFF, midi });
  if (pedalDown()) events.push({ t, type: EVENT.PEDAL_UP });
  take = { events, voiceIndex: VOICE_IDS.indexOf(settings.voice) };
  history.replaceState(null, '', location.pathname + location.search);
  setTakeState('ready');
}

async function startPlayback() {
  if (!take) return;
  await engine.resume();
  setVoice(VOICE_IDS[take.voiceIndex] ?? settings.voice);
  player = new Player(take.events, {
    now: () => engine.ctx.currentTime,
    schedule: (e, at) => {
      if (e.type === EVENT.ON) press(e.midi, e.velocity, 'take', at);
      else if (e.type === EVENT.OFF) release(e.midi, 'take', at);
      else setPedal('take', e.type === EVENT.PEDAL_DOWN, at);
    },
    onEnd: stopPlayback,
  });
  player.start();
  setTakeState('playing');
}

function stopPlayback() {
  if (!player) return;
  player.stop();
  player = null;
  releaseAll('take');
  setPedal('take', false);
  setTakeState('ready');
}

$('[data-take-record]').addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));
ui.takePlay.addEventListener('click', () => (player ? stopPlayback() : startPlayback()));
$('[data-take-delete]').addEventListener('click', () => {
  stopPlayback();
  take = null;
  history.replaceState(null, '', location.pathname + location.search);
  setTakeState('idle');
});
$('[data-take-copy]').addEventListener('click', async () => {
  if (!take) return;
  const code = await encode(take.events, take.voiceIndex);
  history.replaceState(null, '', `#take=${code}`);
  try {
    await navigator.clipboard.writeText(location.href);
    toast('Link copied. Anyone who opens it can play your take.');
  } catch {
    toast('Copy the link from the address bar to share your take.');
  }
});

async function loadSharedTake() {
  const match = /^#take=([\w-]+)$/.exec(location.hash);
  if (!match) return;
  try {
    const { voiceIndex, events } = await decode(match[1]);
    if (!events.length) throw new Error('empty');
    take = { events, voiceIndex };
    setTakeState('ready');
    toast('Someone shared a take with you. Press Play take to hear it.', 6000);
  } catch {
    toast("This take link is incomplete. Ask for the link again.", 6000);
  }
}

/* ----------------------------------------------------------------- help */

let miniBuilt = false;
function toggleHelp() {
  if (ui.help.open) {
    ui.help.close();
    return;
  }
  if (!miniBuilt) {
    const mini = new Keyboard($('[data-mini-keys]'), { onPress() {}, onRelease() {}, velocity });
    mini.setRange(60, 77);
    mini.setLabels(new Map(CHROMATIC_CODES.map((code, i) => [60 + i, codeLabel(code)])));
    miniBuilt = true;
  }
  document.querySelector(':popover-open')?.hidePopover?.();
  ui.help.showModal();
}
$('[data-help-open]').addEventListener('click', toggleHelp);
$('[data-help-close]').addEventListener('click', () => ui.help.close());
ui.help.addEventListener('click', (e) => e.target === ui.help && ui.help.close());

/* ------------------------------------------------------------- popovers */

// Place each panel under the button that opened it.
for (const panel of $$('[popover]')) {
  panel.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const button = document.activeElement?.closest(`[popovertarget="${panel.id}"]`) || $(`[popovertarget="${panel.id}"]`);
    if (!button) return;
    const r = button.getBoundingClientRect();
    const width = Math.min(panel.offsetWidth || 380, window.innerWidth - 32);
    const panelHeight = panel.offsetHeight || 380;
    const top = Math.min(Math.max(16, r.bottom + 10), Math.max(16, window.innerHeight - panelHeight - 16));
    panel.style.top = `${top}px`;
    panel.style.left = `${clamp(r.right - width, 16, window.innerWidth - width - 16)}px`;
  });
}

/* ---------------------------------------------------------------- toast */

let toastTimer = 0;
function toast(message, ms = 3600) {
  ui.toast.textContent = message;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), ms);
}

/* -------------------------------------------------------------- conduct */

function syncConduct() {
  const on = conduct.active;
  const button = $('[data-conduct]');
  button.setAttribute('aria-pressed', String(on));
  $('[data-conduct-label]').textContent = on ? 'Conducting' : 'Conduct';
  $('[data-pieces]').hidden = !on;
  if (!on) {
    keyboard.setScale(state.key);
    strings.setScale(state.key);
    updateReadout();
  }
}

$('[data-conduct]').addEventListener('click', () => (conduct.active ? conduct.exit() : conduct.enter()));

const pieceButtons = $$('[data-piece]');
function setPiece(id) {
  settings.piece = id;
  save();
  conduct.setPiece(id);
  pieceButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.piece === id)));
}
pieceButtons.forEach((b, i) => {
  b.addEventListener('click', () => setPiece(b.dataset.piece));
  b.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = pieceButtons[(i + step + pieceButtons.length) % pieceButtons.length];
    next.focus();
    setPiece(next.dataset.piece);
  });
});
pieceButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.piece === conduct.pieceId)));

/* ---------------------------------------------------------------- start */

buildKeyPanel();
rebuildKeyMap();
applyTuning();
setVoice(settings.voice);
ui.dynamic.textContent = DYNAMICS[settings.dynamic][0];
ui.roomValue.textContent = ROOMS[settings.room]?.label ?? 'Room';
strings.setScale(state.key);
layout(true);
renderChords();
updateKeyUI();
updateReadout();
setTakeState('idle');
loadSharedTake();

// For poking at the sound from the browser console: (await import('./src/main.js')).engine
export { engine };
