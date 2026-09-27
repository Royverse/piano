import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, makeKey, spellInKey, noteName, romanNumeral, CHORD_BY_ID, diatonicChords, identifyChord,
} from '../src/theory.js';

const C4 = 60;
const chordOf = (midis, key) => {
  const a = analyze(midis, key);
  return a.kind === 'chord' ? `${a.symbol.root}${a.symbol.quality}${a.symbol.bass ? `/${a.symbol.bass}` : ''}` : a.kind;
};

test('names common chords in root position', () => {
  assert.equal(chordOf([60, 64, 67]), 'C');
  assert.equal(chordOf([57, 60, 64]), 'Am');
  assert.equal(chordOf([59, 62, 65]), 'B°');
  assert.equal(chordOf([60, 64, 68]), 'C+');
  assert.equal(chordOf([55, 59, 62, 65]), 'G7');
  assert.equal(chordOf([60, 64, 67, 71]), 'Cmaj7');
  assert.equal(chordOf([62, 65, 69, 72]), 'Dm7');
  assert.equal(chordOf([59, 62, 65, 69]), 'Bø7');
  assert.equal(chordOf([59, 62, 65, 68]), 'B°7');
  assert.equal(chordOf([60, 65, 67]), 'Csus4');
  assert.equal(chordOf([60, 62, 67]), 'Csus2');
  assert.equal(chordOf([48, 55, 60]), 'C5');
});

test('names inversions as slash chords', () => {
  assert.equal(chordOf([64, 67, 72]), 'C/E');
  assert.equal(chordOf([67, 72, 76]), 'C/G');
  assert.equal(chordOf([53, 55, 59, 62]), 'G7/F');
  assert.match(analyze([64, 67, 72]).name, /first inversion/);
  assert.match(analyze([67, 72, 76]).name, /second inversion/);
  assert.match(analyze([53, 55, 59, 62]).name, /third inversion/);
});

test('prefers the reading a musician would use', () => {
  assert.equal(chordOf([60, 64, 67, 69]), 'C6');       // not Am7/C
  assert.equal(chordOf([57, 60, 64, 67]), 'Am7');      // not C6/A
  assert.equal(chordOf([48, 64, 70]), 'C7');           // no fifth
  assert.equal(chordOf([48, 52, 55, 58, 62]), 'C9');
  assert.equal(chordOf([60, 62, 64]), 'unknown');
});

test('spells chords by interval, not by default sharps', () => {
  assert.equal(analyze([63, 67, 70]).notes.map((n) => n.name).join(' '), 'E♭ G B♭');
  assert.equal(analyze([61, 64, 68]).notes.map((n) => n.name).join(' '), 'C♯ E G♯');
  assert.equal(analyze([66, 70, 73]).notes.map((n) => n.name).join(' '), 'F♯ A♯ C♯');
  assert.equal(analyze([68, 72, 75]).notes.map((n) => n.name).join(' '), 'A♭ C E♭');
  assert.equal(chordOf([61, 65, 68, 71]), 'D♭7');
});

test('picks key signatures with the fewest accidentals', () => {
  assert.equal(makeKey(6, 'major').name, 'F♯ major');
  assert.equal(makeKey(3, 'minor').name, 'E♭ minor');
  assert.equal(makeKey(1, 'minor').name, 'C♯ minor');
  assert.equal(makeKey(10, 'major').name, 'B♭ major');
  assert.equal(makeKey(2, 'dorian').notes.map(noteName).join(' '), 'D E F G A B C');
  assert.equal(makeKey(9, 'harmonicMinor').notes.map(noteName).join(' '), 'A B C D E F G♯');
  assert.equal(makeKey(9, 'blues').notes.map(noteName).join(' '), 'A C D E♭ E G');
  assert.equal(makeKey(3, 'major').notes.map(noteName).join(' '), 'E♭ F G A♭ B♭ C D');
});

test('spells chromatic notes against the key', () => {
  const F = makeKey(5, 'major');
  assert.equal(noteName(spellInKey(10, F)), 'B♭');
  assert.equal(noteName(spellInKey(11, F)), 'B');
  const C = makeKey(0, 'major');
  assert.equal(noteName(spellInKey(1, C)), 'D♭');
  assert.equal(noteName(spellInKey(6, C)), 'F♯');
  assert.equal(noteName(spellInKey(10, C)), 'B♭');
});

test('names intervals, including compound ones and ratios', () => {
  assert.equal(analyze([60, 67]).name, 'Perfect fifth');
  assert.deepEqual(analyze([60, 67]).interval.ratio, [3, 2]);
  assert.equal(analyze([60, 64]).name, 'Major third');
  assert.equal(analyze([60, 63]).name, 'Minor third');
  assert.equal(analyze([60, 66]).name, 'Augmented fourth');
  assert.equal(analyze([60, 72]).name, 'Octave');
  assert.equal(analyze([48, 72]).name, 'Double octave');
  assert.equal(analyze([60, 74]).name, 'Major ninth');
  assert.deepEqual(analyze([60, 76]).interval.ratio, [5, 2]);
  assert.equal(analyze([63, 66]).name, 'Minor third');   // E♭–G♭, not E♭–F♯
  const Am = makeKey(9, 'harmonicMinor');
  assert.equal(analyze([65, 68], Am).name, 'Augmented second'); // F–G♯
});

test('describes single notes, with their role in a key', () => {
  const a = analyze([69]);
  assert.equal(a.kind, 'note');
  assert.equal(Math.round(a.frequency), 440);
  const D = makeKey(2, 'major');
  assert.equal(analyze([69], D).name, 'Dominant of D major');
  assert.equal(analyze([73], D).name, 'Leading tone of D major');
  assert.equal(analyze([60], D).name, 'Outside D major');
});

test('gives each chord its roman numeral', () => {
  const C = makeKey(0, 'major');
  const roman = (midis, key = C) => analyze(midis, key).numeral;
  assert.equal(roman([67, 71, 74, 77]), 'V7');
  assert.equal(roman([62, 65, 69]), 'ii');
  assert.equal(roman([59, 62, 65]), 'vii°');
  assert.equal(roman([60, 64, 67, 71]), 'Imaj7');
  assert.equal(roman([62, 66, 69, 72]), 'V7/V');
  assert.equal(roman([57, 61, 64]), 'V/ii');
  assert.equal(roman([58, 62, 65]), '♭VII');
  assert.equal(roman([56, 60, 63]), '♭VI');
  const Am = makeKey(9, 'minor');
  assert.equal(roman([64, 68, 71], Am), 'V');
  assert.equal(roman([60, 64, 67], Am), 'III');
  assert.equal(romanNumeral(0, CHORD_BY_ID.maj, null), null);
});

test('builds the chords of a key', () => {
  const C = makeKey(0, 'major');
  assert.deepEqual(diatonicChords(C).map((c) => c.numeral), ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
  assert.deepEqual(diatonicChords(C, true).map((c) => c.symbol), ['Cmaj7', 'Dm7', 'Em7', 'Fmaj7', 'G7', 'Am7', 'Bø7']);
  const Am = makeKey(9, 'harmonicMinor');
  assert.equal(diatonicChords(Am)[4].symbol, 'E');
  assert.equal(diatonicChords(Am)[2].symbol, 'C+');
  assert.equal(diatonicChords(makeKey(0, 'majorPentatonic')).length, 0);
});

test('treats symmetric chords by their bass', () => {
  assert.equal(identifyChord([0, 3, 6, 9], 3).rootPc, 3);
  assert.equal(chordOf([C4, C4 + 4, C4 + 8]), 'C+');
});
