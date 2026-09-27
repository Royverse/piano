// The readout: names what you're playing — a note, an interval or a chord —
// and writes it on the staff.
import { renderStaff } from './staff.js';
import { noteName } from './theory.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fact = (label, value) => `<div class="fact"><dt>${label}</dt><dd>${value}</dd></div>`;
const noteList = (notes) => notes.map((n) => esc(n.label)).join('<span class="dot"> · </span>');

// Lead-sheet style: accidentals in a chord symbol sit small and raised.
const symbolText = (s) => esc(s).replace(/([♯♭𝄪𝄫])/gu, '<span class="sym-acc">$1</span>');

// Octave numbers in note labels read better as quiet subscripts.
const withOctave = (label) => esc(label).replace(/(-?\d+)$/, '<sub>$1</sub>');

export class Readout {
  constructor(root) {
    this.root = root;
    this.eyebrow = root.querySelector('[data-eyebrow]');
    this.symbol = root.querySelector('[data-symbol]');
    this.name = root.querySelector('[data-name]');
    this.facts = root.querySelector('[data-facts]');
    this.staff = root.querySelector('[data-staff]');
    this.live = document.querySelector('[data-announce]');
    this.last = null;
    this.announceTimer = 0;
  }

  /** Draw the key signature on an empty staff. */
  idle(key) {
    renderStaff(this.staff, [], key);
  }

  /** Keep the last thing played on screen, dimmed, once the hands lift. */
  rest() {
    if (this.last) this.root.dataset.state = 'resting';
  }

  /**
   * `eyebrow` replaces the kind label, `extra` adds [label, html] facts,
   * and `hideNotes` leaves the note list to the staff (used when conducting).
   */
  show(analysis, { key, tuning, eyebrow, extra = [], hideNotes = false }) {
    if (analysis.kind === 'empty') {
      this.rest();
      return;
    }
    this.last = analysis;
    this.root.dataset.state = 'live';
    this.root.dataset.kind = analysis.kind;
    renderStaff(this.staff, analysis.notes, key);

    const facts = [];
    switch (analysis.kind) {
      case 'note': {
        const { root, octave } = analysis.symbol;
        this.eyebrow.textContent = 'Note';
        this.symbol.innerHTML = `<span class="sym-root">${symbolText(root)}</span><span class="sym-octave">${octave}</span>`;
        this.name.textContent = analysis.name;
        facts.push(fact('Frequency', `${analysis.frequency.toFixed(1)} Hz`));
        if (analysis.enharmonic) facts.push(fact('Also written', esc(noteName(analysis.enharmonic))));
        break;
      }
      case 'interval': {
        const { interval, from, to } = analysis;
        this.eyebrow.textContent = 'Interval';
        this.symbol.innerHTML = `<span class="sym-words">${esc(interval.name)}</span>`;
        this.name.innerHTML = `${withOctave(from.label)} up to ${withOctave(to.label)}`;
        const exact = tuning === 'just' && key;
        facts.push(fact('Ratio', `${exact ? '' : '≈ '}${interval.ratio[0]} : ${interval.ratio[1]}`));
        facts.push(fact('Span', `${interval.semis} semitone${interval.semis === 1 ? '' : 's'}`));
        break;
      }
      case 'chord': {
        const { root, quality, bass } = analysis.symbol;
        this.eyebrow.textContent = 'Chord';
        this.symbol.innerHTML = `<span class="sym-root">${symbolText(root)}</span>`
          + (quality ? `<span class="sym-quality">${esc(quality)}</span>` : '')
          + (bass ? `<span class="sym-bass">/${symbolText(bass)}</span>` : '');
        this.name.textContent = analysis.name;
        if (!hideNotes) facts.push(fact('Notes', noteList(analysis.notes)));
        if (key && analysis.numeral) facts.push(fact(`In ${esc(key.name)}`, `<span class="numeral">${esc(analysis.numeral)}</span>`));
        break;
      }
      default: {
        this.eyebrow.textContent = 'Notes';
        this.symbol.innerHTML = `<span class="sym-words">${analysis.notes.map((n) => esc(n.name)).join(' ')}</span>`;
        this.name.textContent = analysis.name;
        facts.push(fact('Notes', noteList(analysis.notes)));
      }
    }
    if (eyebrow) this.eyebrow.textContent = eyebrow;
    for (const [label, html] of extra) facts.push(fact(esc(label), html));
    this.facts.innerHTML = facts.join('');
    this.#announce(analysis);
  }

  /** A moment in words, in the display face: "Tuning to A.", "Bravo." */
  say({ eyebrow, words, name, key }) {
    this.last = { kind: 'message' };
    this.root.dataset.state = 'live';
    this.root.dataset.kind = 'message';
    renderStaff(this.staff, [], key);
    this.eyebrow.textContent = eyebrow;
    this.symbol.innerHTML = `<span class="sym-words">${esc(words)}</span>`;
    this.name.textContent = name;
    this.facts.innerHTML = '';
    if (this.live) this.live.textContent = `${words} ${name}`;
  }

  // Screen readers hear the name once the hands settle, not every keystroke.
  #announce(analysis) {
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => {
      if (!this.live) return;
      const text = analysis.kind === 'interval' ? analysis.interval.name
        : analysis.kind === 'note' ? `${analysis.symbol.root}${analysis.symbol.octave}` : analysis.name;
      this.live.textContent = text;
    }, 450);
  }
}
