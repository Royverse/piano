// What the orchestra plays: a chord progression in a key, voiced for five
// string sections with smooth voice leading, and a first-violin line that
// grows busier the harder you conduct. Pure logic — no audio, no DOM.
import { makeKey, mod12, identifyChord, CHORD_BY_ID } from '../theory.js';

export const SECTIONS = ['basses', 'cellos', 'violas', 'violins2', 'violins1'];
export const SECTION_LABELS = {
  basses: 'Basses', cellos: 'Cellos', violas: 'Violas', violins2: 'Violins II', violins1: 'Violins I',
};

// Comfortable playing ranges, as MIDI notes.
const RANGE = { basses: [28, 50], cellos: [36, 62], violas: [48, 74], violins2: [55, 81], violins1: [64, 88] };
const START = { basses: 38, cellos: 50, violas: 60, violins2: 67, violins1: 74 };

// Chords as [semitones above the key note, chord type]. `tonic` is the
// default key note when no key has been chosen.
export const PIECES = {
  canon: {
    label: 'Canon', about: 'after Pachelbel', mode: 'major', tonic: 2, beatsPerChord: 2,
    chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [4, 'min'], [5, 'maj'], [0, 'maj'], [5, 'maj'], [7, 'maj']],
  },
  lament: {
    label: 'Lament', about: 'the Andalusian cadence', mode: 'minor', tonic: 9, beatsPerChord: 4,
    chords: [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, '7']],
  },
  anthem: {
    label: 'Anthem', about: 'I–V–vi–IV', mode: 'major', tonic: 0, beatsPerChord: 4,
    chords: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
  },
  nocturne: {
    label: 'Nocturne', about: 'sevenths, round the circle', mode: 'major', tonic: 3, beatsPerChord: 4,
    chords: [[0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, '7']],
  },
  yours: { label: 'Your chords', about: 'whatever you hold on the keys', follow: true, mode: 'major', tonic: 0 },
};

const between = ([lo, hi], pc) => {
  const out = [];
  for (let m = lo; m <= hi; m++) if (mod12(m) === pc) out.push(m);
  return out;
};
const tonesIn = (range, pcs) => pcs.flatMap((pc) => between(range, pc)).sort((a, b) => a - b);
const nearest = (options, to) => options.reduce((best, m) => (Math.abs(m - to) < Math.abs(best - to) ? m : best), options[0]);

function describe(rootPc, def, bassPc = rootPc) {
  const pcOfDegree = (d) => {
    const tone = def?.tones.find(([, degree]) => degree === d);
    return tone ? mod12(rootPc + tone[0]) : null;
  };
  const pcs = def ? [...new Set(def.tones.map(([s]) => mod12(rootPc + s)))] : [rootPc];
  if (!pcs.includes(bassPc)) pcs.push(bassPc);
  return { rootPc, def, bassPc, pcs, thirdPc: pcOfDegree(3), seventhPc: pcOfDegree(7) };
}

/** Next scale note above (dir = 1) or below (dir = -1) `midi`. */
function scaleStep(midi, dir, pcs) {
  for (let k = 1; k <= 12; k++) {
    const m = midi + dir * k;
    if (pcs.includes(mod12(m))) return m;
  }
  return midi;
}

export class Score {
  constructor(pieceId = 'canon', tonicPc = null) {
    this.id = PIECES[pieceId] ? pieceId : 'canon';
    this.piece = PIECES[this.id];
    this.key = makeKey(tonicPc ?? this.piece.tonic, this.piece.mode);
    this.restart();
  }

  restart() {
    this.beat = 0;
    this.voices = null;
    this.chord = null;
  }

  chordAt(index) {
    const { chords } = this.piece;
    const [offset, id] = chords[((index % chords.length) + chords.length) % chords.length];
    return describe(mod12(this.key.tonicPc + offset), CHORD_BY_ID[id]);
  }

  /**
   * Advance one beat. `intensity` (0–1) is how hard you're conducting;
   * `held` is the MIDI notes held on the piano (used by "Your chords").
   * Returns the notes each section plays now, plus any notes that fall on
   * the half-beat ("after").
   */
  next({ intensity = 0.5, held = [] } = {}) {
    const beat = this.beat++;
    let chord;
    let changed;
    let target = null;

    if (this.piece.follow) {
      chord = this.#chordFromKeys(held) ?? this.chord;
      if (!chord) return { beat, bar: 1, beatInBar: 1, silent: true, notes: {}, after: [] };
      changed = !this.chord || chord.pcs.join() !== this.chord.pcs.join() || chord.bassPc !== this.chord.bassPc;
    } else {
      const per = this.piece.beatsPerChord;
      const index = Math.floor(beat / per);
      chord = this.chordAt(index);
      changed = beat % per === 0;
      if (!changed) target = this.#melodyTarget(this.chordAt(index + 1), this.voices.violins1);
    }

    let onBeat;
    let after = [];
    if (changed || !this.voices) {
      this.voices = this.#voice(chord);
      onBeat = this.voices.violins1;
      // Conducted hard, the first violins leap up through the chord on the half-beat.
      if (intensity > 0.72) {
        const up = tonesIn([onBeat + 1, RANGE.violins1[1]], chord.pcs)[0];
        if (up) after.push({ section: 'violins1', midi: up, at: 0.5 });
      }
    } else {
      ({ onBeat, after } = this.#melodyMotion(this.voices.violins1, target, intensity, beat));
    }

    const notes = { ...this.voices, violins1: onBeat };
    this.voices.violins1 = after.length ? after[after.length - 1].midi : onBeat;
    this.chord = chord;
    return { beat, bar: Math.floor(beat / 4) + 1, beatInBar: (beat % 4) + 1, changed, chord, notes, after };
  }

  #chordFromKeys(held) {
    if (!held.length) return null;
    const sorted = [...held].sort((a, b) => a - b);
    const pcs = [...new Set(sorted.map(mod12))];
    const bassPc = mod12(sorted[0]);
    const found = pcs.length >= 3 ? identifyChord(pcs, bassPc) : null;
    if (found) return describe(found.rootPc, found.chord, bassPc);
    return { rootPc: bassPc, def: null, bassPc, pcs, thirdPc: null, seventhPc: null };
  }

  // The top line: the chord tone closest to where the violins already are,
  // gently avoiding repeats and staying in a singing range.
  #melodyTarget(chord, from) {
    let best = null;
    for (const m of tonesIn(RANGE.violins1, chord.pcs)) {
      let cost = Math.abs(m - from);
      if (m === from) cost += 1.2;
      if (mod12(m) === chord.bassPc && chord.pcs.length > 2) cost += 0.8;
      cost += Math.max(0, m - 84) * 0.6 + Math.max(0, 67 - m) * 0.6;
      if (!best || cost < best.cost) best = { m, cost };
    }
    return best?.m ?? from;
  }

  #voice(chord) {
    const prev = this.voices ?? START;
    const basses = nearest(between(RANGE.basses, chord.bassPc), prev.basses);
    const cellos = basses + 12 <= RANGE.cellos[1] ? basses + 12 : nearest(between(RANGE.cellos, chord.bassPc), prev.cellos);
    const violins1 = this.#melodyTarget(chord, prev.violins1);

    // Inner voices: fill in the chord (the third above all), move as little
    // as possible, and keep the upper voices within an octave of each other.
    let best = null;
    for (const violas of tonesIn(RANGE.violas, chord.pcs)) {
      for (const violins2 of tonesIn(RANGE.violins2, chord.pcs)) {
        if (!(cellos < violas && violas < violins2 && violins2 < violins1)) continue;
        if (violins2 - violas > 12 || violins1 - violins2 > 12) continue;
        const used = [chord.bassPc, mod12(violas), mod12(violins2), mod12(violins1)];
        let cost = Math.abs(violas - prev.violas) + Math.abs(violins2 - prev.violins2);
        for (const pc of chord.pcs) {
          if (used.includes(pc)) continue;
          cost += pc === chord.thirdPc ? 24 : pc === chord.seventhPc ? 13 : pc === chord.rootPc ? 10 : 13;
        }
        if (chord.thirdPc != null && used.filter((pc) => pc === chord.thirdPc).length > 1) cost += 5;
        if (!best || cost < best.cost) best = { violas, violins2, cost };
      }
    }
    const violas = best?.violas ?? nearest(tonesIn(RANGE.violas, chord.pcs), prev.violas);
    const violins2 = best?.violins2 ?? nearest(tonesIn(RANGE.violins2, chord.pcs), prev.violins2);
    return { basses, cellos, violas, violins2, violins1 };
  }

  // Between chords the first violins move: passing notes toward the next
  // chord when conducted with some energy, running eighths when it's loud.
  #melodyMotion(now, target, intensity, beat) {
    const scale = this.key.pcs;
    if (intensity < 0.3 || (target == null && intensity <= 0.72)) return { onBeat: now, after: [] };
    let dir;
    let onBeat;
    if (target != null && Math.abs(target - now) >= 2) {
      dir = Math.sign(target - now);
      onBeat = scaleStep(now, dir, scale);
    } else {
      dir = beat % 2 ? 1 : -1; // a neighbour note, then back
      onBeat = scaleStep(now, dir, scale);
    }
    const after = [];
    if (intensity > 0.72) {
      const toward = target != null ? Math.sign(target - onBeat) || -dir : -dir;
      after.push({ section: 'violins1', midi: scaleStep(onBeat, toward, scale), at: 0.5 });
    }
    return { onBeat, after };
  }
}

