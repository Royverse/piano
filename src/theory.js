// Music theory: note spelling, keys, intervals, chords and roman numerals.
// Pure functions only — shared by the UI and the tests.

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTAL_GLYPHS = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };

export const mod12 = (n) => ((n % 12) + 12) % 12;
export const mod7 = (n) => ((n % 7) + 7) % 7;
export const midiToFreq = (midi, a4 = 440) => a4 * 2 ** ((midi - 69) / 12);
export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(mod12(midi));

/** Spell pitch class `pc` on letter `letter` (0 = C … 6 = B). */
export function spell(letter, pc) {
  letter = mod7(letter);
  let acc = mod12(pc - NATURAL_PC[letter]);
  if (acc > 6) acc -= 12;
  return { letter, acc };
}

export const pcOf = (sp) => mod12(NATURAL_PC[sp.letter] + sp.acc);
export const accidental = (acc) => ACCIDENTAL_GLYPHS[acc] ?? '';
export const noteName = (sp) => LETTERS[sp.letter] + accidental(sp.acc);
export const octaveOf = (midi, sp) => Math.floor((midi - sp.acc - NATURAL_PC[sp.letter]) / 12) - 1;
export const noteLabel = (midi, sp) => noteName(sp) + octaveOf(midi, sp);
/** Position on the staff: one step per letter, seven per octave. */
export const diatonicStep = (midi, sp) => sp.letter + 7 * octaveOf(midi, sp);

// The spelling most sheet music uses when there's no key to follow.
const PLAIN_LETTER = [0, 0, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
export const plainSpelling = (pc) => spell(PLAIN_LETTER[mod12(pc)], pc);

/** The other common name for a black-key note (C♯ ↔ D♭), or null. */
export function enharmonic(sp) {
  if (sp.acc === 0) return null;
  const alt = spell(sp.letter + (sp.acc > 0 ? 1 : -1), pcOf(sp));
  return Math.abs(alt.acc) <= 1 ? alt : null;
}

function singleAccidental(letter, pc) {
  const sp = spell(letter, pc);
  if (Math.abs(sp.acc) < 2) return sp;
  return spell(letter + Math.sign(sp.acc), pc);
}

/* ------------------------------------------------------------------ keys */

export const SCALES = {
  major: { label: 'major', steps: [0, 2, 4, 5, 7, 9, 11], signature: 'major' },
  minor: { label: 'minor', steps: [0, 2, 3, 5, 7, 8, 10], signature: 'minor' },
  harmonicMinor: { label: 'harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], signature: 'minor' },
  melodicMinor: { label: 'melodic minor', steps: [0, 2, 3, 5, 7, 9, 11], signature: 'minor' },
  dorian: { label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], signature: 'self' },
  phrygian: { label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], signature: 'self' },
  lydian: { label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], signature: 'self' },
  mixolydian: { label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], signature: 'self' },
  locrian: { label: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10], signature: 'self' },
  majorPentatonic: { label: 'major pentatonic', steps: [0, 2, 4, 7, 9], degrees: [1, 2, 3, 5, 6], signature: 'major' },
  minorPentatonic: { label: 'minor pentatonic', steps: [0, 3, 5, 7, 10], degrees: [1, 3, 4, 5, 7], signature: 'minor' },
  blues: { label: 'blues', steps: [0, 3, 5, 6, 7, 10], degrees: [1, 3, 4, 5, 5, 7], signature: 'minor' },
};

export const SCALE_GROUPS = [
  ['Common', ['major', 'minor']],
  ['Minor variants', ['harmonicMinor', 'melodicMinor']],
  ['Modes', ['dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian']],
  ['Five and six notes', ['majorPentatonic', 'minorPentatonic', 'blues']],
];

/** Tonics in circle-of-fifths order, starting from C at the top. */
export const CIRCLE_OF_FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export function makeKey(tonicPc, mode = 'major') {
  const scale = SCALES[mode] ?? SCALES.major;
  const degrees = scale.degrees ?? scale.steps.map((_, i) => i + 1);
  const sigSteps = scale.signature === 'major' ? SCALES.major.steps
    : scale.signature === 'minor' ? SCALES.minor.steps : scale.steps;
  const minorish = scale.steps[2] === 3 || scale.steps[1] === 3;

  let best = null;
  for (let letter = 0; letter < 7; letter++) {
    const tonic = spell(letter, tonicPc);
    if (Math.abs(tonic.acc) > 1) continue;
    const sig = sigSteps.map((st, i) => spell(letter + i, tonicPc + st));
    const cost = sig.reduce((sum, sp) => sum + (Math.abs(sp.acc) === 2 ? 10 : Math.abs(sp.acc)), 0);
    // F♯ major over G♭ major, E♭ minor over D♯ minor.
    const tie = tonic.acc === (minorish ? -1 : 1) ? 0 : 0.5;
    if (!best || cost + tie < best.score) best = { tonic, sig, score: cost + tie };
  }

  const { tonic, sig } = best;
  const notes = scale.steps.map((st, i) => spell(tonic.letter + degrees[i] - 1, tonicPc + st));
  const signature = Array(7).fill(0);
  for (const sp of sig) signature[sp.letter] = sp.acc;

  return {
    tonicPc,
    mode,
    scale,
    tonic,
    notes,
    degrees,
    pcs: notes.map(pcOf),
    signature,
    heptatonic: scale.steps.length === 7,
    name: `${noteName(tonic)} ${scale.label}`,
  };
}

// Chromatic notes borrow the nearest scale letter: ♭2 ♭3 ♯4 ♭6 ♭7.
const CHROMATIC_DEGREE = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];

export function spellInKey(pc, key) {
  if (!key) return plainSpelling(pc);
  const i = key.pcs.indexOf(mod12(pc));
  if (i >= 0) return key.notes[i];
  const offset = mod12(pc - key.tonicPc);
  return singleAccidental(key.tonic.letter + CHROMATIC_DEGREE[offset] - 1, pc);
}

const DEGREE_NAMES = ['tonic', 'supertonic', 'mediant', 'subdominant', 'dominant', 'submediant'];

/** "Dominant", "Leading tone" … for a pitch class in a key, or null if it's outside the scale. */
export function degreeName(pc, key) {
  if (!key || !key.pcs.includes(mod12(pc))) return null;
  const offset = mod12(pc - key.tonicPc);
  const degree = CHROMATIC_DEGREE[offset];
  if (degree === 7) return offset === 11 ? 'leading tone' : 'subtonic';
  return DEGREE_NAMES[degree - 1];
}

/* ------------------------------------------------------------- intervals */

const NUMBER_WORDS = ['', 'unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'double octave'];
const MAJOR_BASE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const PERFECT = new Set([1, 4, 5]);
// 5-limit just ratios for each semitone count inside an octave.
const JUST_RATIOS = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3], [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8]];
// Detune (cents) that turns an equal-tempered step into its just counterpart.
export const JUST_CENTS = [0, 11.73, 3.91, 15.64, -13.69, -1.96, -9.78, 1.96, 13.69, -15.64, 17.6, -11.73];

function qualityOf(simple, diff) {
  if (PERFECT.has(simple)) return { '-1': 'diminished', 0: 'perfect', 1: 'augmented' }[diff];
  return { '-2': 'diminished', '-1': 'minor', 0: 'major', 1: 'augmented' }[diff];
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** Name the interval between two spelled notes (low first). */
export function intervalBetween(low, high) {
  const steps = diatonicStep(high.midi, high.sp) - diatonicStep(low.midi, low.sp);
  const semis = high.midi - low.midi;
  const octaves = Math.floor(steps / 7);
  const simple = (steps % 7) + 1;
  const quality = qualityOf(simple, semis - MAJOR_BASE[simple] - 12 * octaves);
  const number = steps + 1;

  let name;
  if (!quality) name = `${semis} semitones`;
  else if (simple === 1 && quality === 'perfect') {
    name = octaves === 0 ? 'Unison' : octaves === 1 ? 'Octave' : octaves === 2 ? 'Double octave' : `${octaves} octaves`;
  } else if (number <= 14) {
    name = `${cap(quality)} ${NUMBER_WORDS[number]}`;
  } else {
    name = `${cap(quality)} ${NUMBER_WORDS[simple]} + ${octaves} octaves`;
  }

  const [n, d] = JUST_RATIOS[mod12(semis)];
  let num = n * 2 ** Math.floor(semis / 12);
  let den = d;
  const g = gcd(num, den);
  num /= g; den /= g;

  return { name, semis, quality, number, ratio: [num, den], tritone: mod12(semis) === 6 };
}

// Conventional spellings for an interval of n semitones: m2 M2 m3 M3 P4 A4 P5 m6 M6 m7 M7.
const INTERVAL_NUMBER = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];

/** Spell `midi` as the conventional interval above an already spelled note. */
export function spellAbove(base, midi) {
  const semis = midi - base.midi;
  const letter = base.sp.letter + INTERVAL_NUMBER[mod12(semis)] - 1;
  const sp = spell(letter, mod12(midi));
  return Math.abs(sp.acc) < 2 ? sp : plainSpelling(midi);
}

/* ---------------------------------------------------------------- chords */

// Each tone is [semitones above the root, chord degree]. Rank: lower is more common.
const chord = (id, symbol, name, tones, rank) => ({ id, symbol, name, tones, rank });
export const CHORDS = [
  chord('maj', '', 'major', [[0, 1], [4, 3], [7, 5]], 0),
  chord('min', 'm', 'minor', [[0, 1], [3, 3], [7, 5]], 0),
  chord('dim', '°', 'diminished', [[0, 1], [3, 3], [6, 5]], 1.5),
  chord('aug', '+', 'augmented', [[0, 1], [4, 3], [8, 5]], 2),
  chord('sus4', 'sus4', 'suspended fourth', [[0, 1], [5, 4], [7, 5]], 2.5),
  chord('sus2', 'sus2', 'suspended second', [[0, 1], [2, 2], [7, 5]], 3),
  chord('7', '7', 'dominant seventh', [[0, 1], [4, 3], [7, 5], [10, 7]], 1),
  chord('maj7', 'maj7', 'major seventh', [[0, 1], [4, 3], [7, 5], [11, 7]], 1),
  chord('m7', 'm7', 'minor seventh', [[0, 1], [3, 3], [7, 5], [10, 7]], 1),
  chord('m7b5', 'ø7', 'half-diminished seventh', [[0, 1], [3, 3], [6, 5], [10, 7]], 1.5),
  chord('dim7', '°7', 'diminished seventh', [[0, 1], [3, 3], [6, 5], [9, 7]], 1.5),
  chord('mmaj7', 'm(maj7)', 'minor major seventh', [[0, 1], [3, 3], [7, 5], [11, 7]], 3),
  chord('aug7', '+7', 'augmented seventh', [[0, 1], [4, 3], [8, 5], [10, 7]], 3.5),
  chord('augmaj7', '+maj7', 'augmented major seventh', [[0, 1], [4, 3], [8, 5], [11, 7]], 3.5),
  chord('7sus4', '7sus4', 'dominant seventh, suspended fourth', [[0, 1], [5, 4], [7, 5], [10, 7]], 2.5),
  chord('7b5', '7♭5', 'dominant seventh, flat fifth', [[0, 1], [4, 3], [6, 5], [10, 7]], 4),
  chord('6', '6', 'major sixth', [[0, 1], [4, 3], [7, 5], [9, 6]], 2),
  chord('m6', 'm6', 'minor sixth', [[0, 1], [3, 3], [7, 5], [9, 6]], 2),
  chord('add9', 'add9', 'major, added ninth', [[0, 1], [4, 3], [7, 5], [2, 9]], 2.5),
  chord('madd9', 'm(add9)', 'minor, added ninth', [[0, 1], [3, 3], [7, 5], [2, 9]], 2.5),
  chord('69', '6/9', 'six-nine', [[0, 1], [4, 3], [7, 5], [9, 6], [2, 9]], 3),
  chord('9', '9', 'dominant ninth', [[0, 1], [4, 3], [7, 5], [10, 7], [2, 9]], 2.5),
  chord('maj9', 'maj9', 'major ninth', [[0, 1], [4, 3], [7, 5], [11, 7], [2, 9]], 2.5),
  chord('m9', 'm9', 'minor ninth', [[0, 1], [3, 3], [7, 5], [10, 7], [2, 9]], 2.5),
  chord('7b9', '7♭9', 'dominant seventh, flat ninth', [[0, 1], [4, 3], [7, 5], [10, 7], [1, 9]], 3.5),
  chord('7s9', '7♯9', 'dominant seventh, sharp ninth', [[0, 1], [4, 3], [7, 5], [10, 7], [3, 9]], 3.5),
  chord('maj7s11', 'maj7♯11', 'major seventh, sharp eleventh', [[0, 1], [4, 3], [7, 5], [11, 7], [6, 11]], 4),
  chord('11', '11', 'dominant eleventh', [[0, 1], [4, 3], [7, 5], [10, 7], [2, 9], [5, 11]], 4.5),
  chord('m11', 'm11', 'minor eleventh', [[0, 1], [3, 3], [7, 5], [10, 7], [2, 9], [5, 11]], 4),
  chord('13', '13', 'dominant thirteenth', [[0, 1], [4, 3], [7, 5], [10, 7], [2, 9], [9, 13]], 4.5),
  chord('maj13', 'maj13', 'major thirteenth', [[0, 1], [4, 3], [7, 5], [11, 7], [2, 9], [9, 13]], 4.5),
  chord('m13', 'm13', 'minor thirteenth', [[0, 1], [3, 3], [7, 5], [10, 7], [2, 9], [9, 13]], 4.5),
];
export const CHORD_BY_ID = Object.fromEntries(CHORDS.map((c) => [c.id, c]));

const setKey = (semis) => [...new Set(semis.map(mod12))].sort((a, b) => a - b).join(',');

// Every chord shape, plus the common "no fifth" voicings of seventh chords and up.
const SHAPES = new Map();
for (const c of CHORDS) {
  const full = setKey(c.tones.map((t) => t[0]));
  if (!SHAPES.has(full)) SHAPES.set(full, []);
  SHAPES.get(full).push({ chord: c, omitted: false });
  if (c.tones.some((t) => t[1] === 7) && c.tones.some((t) => t[0] === 7)) {
    const no5 = setKey(c.tones.filter((t) => t[0] !== 7).map((t) => t[0]));
    if (!SHAPES.has(no5)) SHAPES.set(no5, []);
    SHAPES.get(no5).push({ chord: c, omitted: true });
  }
}

const MAJOR_THIRD_IDS = new Set(['maj', 'aug', '7', 'maj7', 'aug7', 'augmaj7', '7b5', '6', 'add9', '69', '9', 'maj9', '7b9', '7s9', 'maj7s11', '11', '13', 'maj13']);
const DOMINANT_IDS = new Set(['maj', '7', '9', '7b9', '7s9', '13']);

/** Find the best chord name for a set of pitch classes with a given bass. */
export function identifyChord(pcs, bassPc) {
  const unique = [...new Set(pcs.map(mod12))];
  if (unique.length < 3) return null;
  let best = null;
  for (const root of unique) {
    const shape = setKey(unique.map((p) => p - root));
    for (const match of SHAPES.get(shape) ?? []) {
      const score = match.chord.rank + (match.omitted ? 1 : 0) + (root === mod12(bassPc) ? 0 : 1.5);
      if (!best || score < best.score) best = { rootPc: root, chord: match.chord, omitted: match.omitted, score };
    }
  }
  return best;
}

// Chord roots without a key: D♭ and A♭ major but C♯, F♯ and G♯ minor.
const PLAIN_MAJOR_LETTER = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
const PLAIN_MINOR_LETTER = [0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6, 6];

/** Spell a chord's root and tones by interval (a third is always two letters up). */
export function spellChord(rootPc, chordDef, key) {
  const minor = !MAJOR_THIRD_IDS.has(chordDef.id);
  const candidates = [];
  if (key) candidates.push(spellInKey(rootPc, key));
  candidates.push(spell((minor ? PLAIN_MINOR_LETTER : PLAIN_MAJOR_LETTER)[rootPc], rootPc));
  const alt = enharmonic(candidates[candidates.length - 1]);
  if (alt) candidates.push(alt);

  let best = null;
  candidates.forEach((root, order) => {
    const tones = new Map();
    for (const [semis, degree] of chordDef.tones) {
      tones.set(mod12(rootPc + semis), spell(root.letter + degree - 1, rootPc + semis));
    }
    const cost = [...tones.values()].reduce((s, sp) => s + (Math.abs(sp.acc) === 2 ? 10 : Math.abs(sp.acc)), 0)
      + Math.abs(root.acc) + order * 0.6;
    if (!best || cost < best.cost) best = { root, tones, cost };
  });
  return best;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// Roman-numeral suffix: lowercase numerals already say "minor".
const NUMERAL_SUFFIX = {
  maj: '', min: '', dim: '°', aug: '+', sus4: 'sus4', sus2: 'sus2', 7: '7', maj7: 'maj7', m7: '7',
  m7b5: 'ø7', dim7: '°7', mmaj7: '(maj7)', aug7: '+7', augmaj7: '+maj7', '7sus4': '7sus4', '7b5': '7♭5',
  6: '6', m6: '6', add9: 'add9', madd9: 'add9', 69: '6/9', 9: '9', maj9: 'maj9', m9: '9', '7b9': '7♭9',
  '7s9': '7♯9', maj7s11: 'maj7♯11', 11: '11', m11: '11', 13: '13', maj13: 'maj13', m13: '13',
};

function numeralFor(degreeIndex, alteration, chordDef) {
  const upper = MAJOR_THIRD_IDS.has(chordDef.id) || chordDef.id.startsWith('sus') || chordDef.id === '7sus4';
  const base = ROMAN[degreeIndex];
  return accidental(alteration) + (upper ? base : base.toLowerCase()) + NUMERAL_SUFFIX[chordDef.id];
}

function triadQuality(pcs) {
  const set = setKey(pcs.map((p) => p - pcs[0]));
  return { '0,4,7': 'maj', '0,3,7': 'min', '0,3,6': 'dim', '0,4,8': 'aug' }[set] ?? null;
}

/** The function of a chord in a key: "V7", "ii", "♭VII", "V7/V". */
export function romanNumeral(rootPc, chordDef, key) {
  if (!key || !key.heptatonic) return null;
  const offset = mod12(rootPc - key.tonicPc);
  const chordPcs = chordDef.tones.map(([s]) => mod12(rootPc + s));
  const diatonic = chordPcs.every((p) => key.pcs.includes(p));
  const degreeIndex = key.pcs.indexOf(mod12(rootPc));

  if (diatonic && degreeIndex >= 0) return numeralFor(degreeIndex, 0, chordDef);

  // Dominant of the tonic with a raised leading tone (V in minor).
  if (offset === 7 && DOMINANT_IDS.has(chordDef.id)) return numeralFor(4, 0, chordDef);

  // Secondary dominant: a major or dominant chord a fifth above a diatonic major/minor chord.
  if (DOMINANT_IDS.has(chordDef.id)) {
    const target = key.pcs.indexOf(mod12(rootPc - 7));
    if (target > 0) {
      const triad = [0, 2, 4].map((s) => key.pcs[(target + s) % 7]);
      const q = triadQuality(triad);
      if (q === 'maj' || q === 'min') {
        const t = ROMAN[target];
        return `${numeralFor(4, 0, chordDef)}/${q === 'maj' ? t : t.toLowerCase()}`;
      }
    }
  }

  // Borrowed or chromatic root: name it against the nearest scale degree.
  if (degreeIndex >= 0) return numeralFor(degreeIndex, 0, chordDef);
  const below = key.pcs.indexOf(mod12(rootPc - 1));
  const above = key.pcs.indexOf(mod12(rootPc + 1));
  if (above >= 0 && offset !== 6) return numeralFor(above, -1, chordDef);
  if (below >= 0) return numeralFor(below, 1, chordDef);
  return numeralFor(above, -1, chordDef);
}

/** Triads (or sevenths) built on each degree of a seven-note key. */
export function diatonicChords(key, sevenths = false) {
  if (!key?.heptatonic) return [];
  return key.pcs.map((rootPc, i) => {
    const size = sevenths ? 4 : 3;
    const pcs = Array.from({ length: size }, (_, k) => key.pcs[(i + 2 * k) % 7]);
    const found = identifyChord(pcs, rootPc);
    const chordDef = found?.chord ?? CHORD_BY_ID.maj;
    const spelled = spellChord(rootPc, chordDef, key);
    return {
      degree: i + 1,
      rootPc,
      chord: chordDef,
      intervals: pcs.map((p, k) => mod12(p - rootPc) + (k > 0 && mod12(p - rootPc) === 0 ? 12 : 0)),
      numeral: numeralFor(i, 0, chordDef),
      symbol: noteName(spelled.root) + chordDef.symbol,
    };
  });
}

/* --------------------------------------------------------------- analyze */

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const INVERSIONS = { 3: 'first inversion', 5: 'second inversion', 7: 'third inversion' };

/**
 * Describe what's being played: a note, an interval or a chord.
 * Returns everything the readout and the staff need, already spelled.
 */
export function analyze(midis, key = null, { a4 = 440, tuning = 'equal' } = {}) {
  const sorted = [...new Set(midis)].sort((a, b) => a - b);
  if (!sorted.length) return { kind: 'empty', notes: [] };

  const pcs = [...new Set(sorted.map(mod12))];
  const bass = sorted[0];

  if (pcs.length >= 3) {
    const found = identifyChord(pcs, mod12(bass));
    if (found) {
      const spelled = spellChord(found.rootPc, found.chord, key);
      const notes = sorted.map((m) => ({ midi: m, sp: spelled.tones.get(mod12(m)) ?? spellInKey(m, key) }));
      const rootName = noteName(spelled.root);
      const bassSp = notes[0].sp;
      const inverted = mod12(bass) !== found.rootPc;
      const bassDegree = found.chord.tones.find(([s]) => mod12(found.rootPc + s) === mod12(bass))?.[1];
      let name = `${rootName} ${found.chord.name}`;
      if (inverted) name += `, ${INVERSIONS[bassDegree] ?? `over ${noteName(bassSp)}`}`;
      if (found.omitted) name += ' (no fifth)';
      return {
        kind: 'chord',
        notes: withLabels(notes),
        rootPc: found.rootPc,
        chord: found.chord,
        symbol: { root: rootName, quality: found.chord.symbol, bass: inverted ? noteName(bassSp) : '' },
        name,
        numeral: romanNumeral(found.rootPc, found.chord, key),
      };
    }
    const notes = sorted.map((m) => ({ midi: m, sp: spellInKey(m, key) }));
    return { kind: 'unknown', notes: withLabels(notes), name: 'No standard chord name' };
  }

  if (pcs.length === 1 && sorted.length === 1) {
    const sp = spellInKey(bass, key);
    const degree = degreeName(bass, key);
    const cents = tuning === 'just' && key ? JUST_CENTS[mod12(bass - key.tonicPc)] : 0;
    return {
      kind: 'note',
      notes: withLabels([{ midi: bass, sp }]),
      symbol: { root: noteName(sp), octave: octaveOf(bass, sp) },
      name: key ? (degree ? `${cap(degree)} of ${key.name}` : `Outside ${key.name}`) : noteNameLong(sp),
      frequency: midiToFreq(bass, a4) * 2 ** (cents / 1200),
      enharmonic: enharmonic(sp),
    };
  }

  // Two pitch classes (or one, doubled): an interval, or a power chord.
  const top = pcs.length === 1 ? sorted[sorted.length - 1] : sorted.find((m) => mod12(m) !== mod12(bass));
  const low = { midi: bass, sp: spellInKey(bass, key) };
  const high = { midi: top, sp: key ? spellInKey(top, key) : spellAbove(low, top) };
  const interval = intervalBetween(low, high);
  const spOf = (m) => (mod12(m) === mod12(bass) ? low.sp : high.sp);
  const notes = withLabels(sorted.map((m) => ({ midi: m, sp: spOf(m) })));

  if (sorted.length > 2 && mod12(top - bass) === 7) {
    return {
      kind: 'chord',
      notes,
      rootPc: mod12(bass),
      chord: { id: '5', symbol: '5', name: 'power chord' },
      symbol: { root: noteName(low.sp), quality: '5', bass: '' },
      name: `${noteName(low.sp)} power chord — root and fifth`,
      numeral: null,
    };
  }
  return { kind: 'interval', notes, interval, name: interval.name, from: notes[0], to: notes.find((n) => n.midi === top) };
}

function withLabels(notes) {
  return notes.map((n) => ({ ...n, name: noteName(n.sp), label: noteLabel(n.midi, n.sp) }));
}

function noteNameLong(sp) {
  const acc = { '-2': ' double flat', '-1': ' flat', 0: '', 1: ' sharp', 2: ' double sharp' }[sp.acc];
  return `${LETTERS[sp.letter]}${acc}`;
}
