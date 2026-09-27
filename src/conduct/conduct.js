// Conduct mode: the concert, start to finish. The orchestra tunes, falls
// silent when the baton goes up, starts on your first beat, then keeps
// flowing at your tempo while you conduct — every beat you give pulls it
// back into step. Hold still for a fermata, close your hand to stop them,
// and finish big for applause.
import { Orchestra, sectionLevel } from '../audio/orchestra.js';
import { Conductor, tempoMark, dynamicMark } from './gesture.js';
import { Score, PIECES, SECTIONS } from './score.js';
import { startHands, warmHands, cameraProblem } from './hands.js';
import { BatonView } from './baton.js';
import { HandModel } from './hand-model.js';
import { analyze, mod12, noteName, noteLabel, spellInKey } from '../theory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const BRAVO_BEATS = 16; // at least four bars…
const BRAVO_DYNAMIC = 0.42; // …ending with some conviction
const PUMP_MS = 20; // how often the flow is checked
const LOOKAHEAD_MS = 45; // beats are scheduled this far ahead, on the audio clock

// What each tab of the gesture guide shows.
const GUIDE = {
  wave: ['Beat time', 'Move your hand down into each beat and let it bounce back up. The orchestra plays on every beat and follows your tempo — faster for allegro, slower for adagio.'],
  dynamics: ['Height is volume', 'Raise your hand for forte, lower it towards the desk for piano. Raise both hands for a full tutti swell.'],
  pinch: ['Pinch to pluck', 'Touch thumb and index finger together and the strings play pizzicato. Open your hand again to go back to the bow.'],
  cutoff: ['Close your hand to stop', 'Make a fist and hold it for a moment: everyone stops together. Esc and the Cut off button do the same.'],
};

export class ConductMode {
  constructor({ engine, keyboard, strings, readout, getKey, getHeld, onChange }) {
    Object.assign(this, { engine, keyboard, strings, readout, getKey, getHeld, onChange });
    this.active = false;
    this.state = 'off';
    this.pieceId = 'canon';
    this.orchestra = new Orchestra(engine);
    this.conductor = new Conductor({
      beat: (b) => this.#given(b),
      cutoff: () => this.#cutoff(),
      raise: () => this.#raise(),
    });

    this.ui = {
      stage: $('.stage'),
      intro: $('[data-conduct-intro]'),
      introError: $('[data-conduct-error]'),
      bar: $('[data-conduct-bar]'),
      status: $('[data-conduct-status]'),
      source: $('[data-conduct-source]'),
      reflectionToggle: $('[data-reflection-toggle]'),
      sections: $('[data-sections]'),
      video: $('[data-reflection]'),
    };
    this.meters = Object.fromEntries(SECTIONS.map((id) => [id, $(`[data-section="${id}"]`, this.ui.sections)]));
    this.baton = new BatonView($('[data-baton]'), this.ui.video);

    $('[data-conduct-camera]').addEventListener('click', () => this.begin('camera'));
    $('[data-conduct-mouse]').addEventListener('click', () => this.begin('mouse'));
    $('[data-conduct-cut]').addEventListener('click', () => this.#cutoff());
    this.ui.reflectionToggle.addEventListener('click', () => {
      const hidden = this.ui.video.classList.toggle('is-hidden');
      this.ui.reflectionToggle.textContent = hidden ? 'Show camera' : 'Hide camera';
    });
    this.#setupGuide();
    this.#bindPointer();
  }

  /* ------------------------------------------------------------ mode */

  enter() {
    if (this.active) return;
    this.active = true;
    this.state = 'intro';
    this.score = new Score(this.pieceId, this.getKey()?.tonicPc ?? null);
    this.ui.intro.hidden = false;
    this.ui.introError.textContent = '';
    document.body.classList.add('is-conducting');
    this.#showKey();
    this.onChange?.();
    // Start loading hand tracking now, so the camera is quick to respond.
    // Any failure is reported when the camera is actually chosen.
    warmHands().catch(() => {});
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.state = 'off';
    this.hands?.stop();
    this.hands = null;
    this.orchestra.stop();
    clearInterval(this.pump);
    this.#bow(null);
    this.baton.clear();
    this.baton.setState('off');
    this.ui.intro.hidden = true;
    this.ui.bar.hidden = true;
    this.ui.sections.hidden = true;
    this.ui.video.hidden = true;
    document.body.classList.remove('is-conducting');
    this.onChange?.();
  }

  /** Esc: cut the orchestra off if it's playing, otherwise leave. */
  escape() {
    if (this.state === 'playing' || this.state === 'holding') this.#cutoff();
    else this.exit();
  }

  setPiece(id) {
    if (!PIECES[id]) return;
    this.pieceId = id;
    if (!this.active) return;
    this.score = new Score(id, this.getKey()?.tonicPc ?? null);
    this.#showKey();
    if (this.state === 'playing' || this.state === 'holding') {
      this.#say(PIECES[id].label, `${cap(PIECES[id].about)}.`, 'It begins on your next beat.');
    }
  }

  keyChanged() {
    if (this.active) this.setPiece(this.pieceId);
  }

  #showKey() {
    this.keyboard.setScale(this.score.key);
    this.strings.setScale(this.score.key);
  }

  /** Start the concert with the camera or the mouse. */
  async begin(source) {
    await this.engine.resume();
    this.source = source;
    this.conductor.reset();
    this.beats = 0;
    this.recent = [];
    this.lastBeatAt = 0;
    this.nextBeatAt = null;
    this.ui.intro.hidden = true;
    this.ui.bar.hidden = false;
    this.ui.sections.hidden = false;
    const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.ui.source.textContent = source === 'camera' ? 'Camera' : touch ? 'Touch' : 'Mouse';
    this.ui.reflectionToggle.hidden = source !== 'camera';
    this.baton.source = source;
    this.baton.resize();

    this.state = 'tuning';
    this.baton.setState('tuning', 0);
    this.orchestra.tune(this.engine.ctx.currentTime + 0.05);
    // The A strings shimmer while the orchestra tunes to them.
    setTimeout(() => this.state === 'tuning' && this.#bow({ basses: 33, cellos: 45, violas: 57, violins: 69 }, 0.05), 1000);
    this.#say('Orchestra', 'Tuning to A.', source === 'camera'
      ? 'Raise your hand when you\'re ready.'
      : 'Press on the stage when you\'re ready, then drag down to beat.');
    this.#status(source === 'camera' ? 'Starting the camera…' : 'Drag down on the stage, tap it, or press Space to beat');

    clearInterval(this.pump);
    this.tick = 0;
    this.pump = setInterval(() => this.#pump(), PUMP_MS);

    if (source !== 'camera') return;
    try {
      this.ui.video.hidden = false;
      this.hands?.stop();
      this.hands = await startHands(this.ui.video, {
        onStatus: (text) => this.#status(text),
        onFrame: (frame) => this.#frame(frame),
      });
      if (!this.active) {
        this.hands.stop();
        return;
      }
      this.#status('Raise your hand to begin');
    } catch (error) {
      this.ui.video.hidden = true;
      if (!this.active) return;
      clearInterval(this.pump);
      this.orchestra.stop();
      this.baton.setState('intro', 0);
      this.ui.bar.hidden = true;
      this.ui.sections.hidden = true;
      this.ui.intro.hidden = false;
      this.ui.introError.textContent = cameraProblem(error);
      this.state = 'intro';
    }
  }

  /* ----------------------------------------------------------- input */

  #setupGuide() {
    const canvas = $('[data-gesture-canvas]');
    if (!canvas) return;
    this.handModel = new HandModel(canvas);
    $('#gesture-guide')?.addEventListener('toggle', (e) => {
      if (e.newState === 'open') this.handModel.start();
      else this.handModel.stop();
    });
    const desc = $('[data-gesture-desc]');
    const tabs = $$('[data-gesture-tab]');
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
        const mode = tab.dataset.gestureTab;
        this.handModel.setMode(mode);
        const [title, text] = GUIDE[mode];
        desc.innerHTML = `<b>${title}</b><p>${text}</p>`;
      });
    }
  }

  #frame(frame) {
    if (!this.active) return;
    const snap = this.conductor.update(frame);
    this.baton.show(frame.hands, frame.t, snap);
    this.#guideStatus(snap);
  }

  // The gesture guide's live badge mirrors what the camera currently sees.
  #guideStatus(snap) {
    const badge = $('[data-gesture-live-text]');
    if (!badge) return;
    let text = 'No hand in view';
    if (snap.cut || snap.fistProgress > 0.3) text = 'Fist · cut off';
    else if (snap.pizzicato) text = 'Pinch · pizz.';
    else if (snap.gesture === 'tutti') text = 'Both hands · tutti';
    else if (snap.gesture === 'hold') text = 'Still · fermata';
    else if (snap.tempo) text = `${tempoMark(snap.tempo)} · ${Math.round(snap.tempo)} bpm`;
    else if (snap.present) text = snap.twoHands ? 'Two hands ready' : 'Hand ready';
    badge.textContent = text;
  }

  /** A beat given by tapping the stage, the Space key or the down arrow. */
  manualBeat(pos = null) {
    if (!this.active || this.state === 'intro' || this.state === 'off') return;
    if (this.state === 'tuning') this.#raise();
    this.conductor.tapBeat(performance.now(), 0.18, pos ?? { x: this.conductor.x ?? 0.5, y: this.conductor.y ?? 0.6 });
  }

  #bindPointer() {
    const stage = this.ui.stage;
    let down = null;
    const at = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, open: 1, pinch: 0 };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (!this.active || this.state === 'intro' || this.state === 'off') return;
      if (e.target.closest('button, a, [popover]')) return;
      // With the camera, a tap on the stage gives a beat.
      if (this.source === 'camera') {
        this.manualBeat(at(e));
        return;
      }
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      down = { id: e.pointerId, t: performance.now(), y: e.clientY, moved: false };
      this.#frame({ t: performance.now(), hands: [at(e)] });
    });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerId !== down?.id) return;
      if (Math.abs(e.clientY - down.y) > 6) down.moved = true;
      // Every sample between frames, so fast strokes aren't missed.
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) this.#frame({ t: ev.timeStamp || performance.now(), hands: [at(ev)] });
    });
    const up = (e) => {
      if (e.pointerId !== down?.id) return;
      // A quick tap without a stroke still counts as a beat.
      if (!down.moved && performance.now() - down.t < 300) this.manualBeat(at(e));
      down = null;
      this.#frame({ t: performance.now(), hands: [] });
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  /* ---------------------------------------------------------- events */

  #raise() {
    if (this.state !== 'tuning' && this.state !== 'cut' && this.state !== 'bravo') return;
    this.orchestra.hush(this.engine.ctx.currentTime);
    this.#fadeBow();
    this.state = 'ready';
    this.baton.setState('ready', 0);
    this.#say('Orchestra', 'Ready.', `${PIECES[this.pieceId].label}, in ${this.score.key.name}. Beat down to begin.`);
    this.#status('Beat down to begin');
  }

  #interval() {
    const tempo = this.conductor.tempo;
    return tempo ? clamp(60000 / tempo, 280, 1600) : null;
  }

  // A beat from the conductor. Starting, it plays at once. Once the music is
  // flowing, a beat that lands just after the one the orchestra played pulls
  // the next beat into step; a beat that arrives early is played right away.
  #given(b) {
    if (!this.active || this.state === 'intro' || this.state === 'off') return;
    const now = performance.now();
    this.lastGivenAt = now;
    const interval = this.#interval();
    if (this.state === 'playing' && interval && this.lastBeatAt) {
      const phase = (now - this.lastBeatAt) / interval;
      if (phase < 0.45) {
        this.nextBeatAt = this.lastBeatAt + interval + 0.5 * (now - this.lastBeatAt);
        this.baton.beat({ x: b.x, y: b.y }, clamp(b.stroke / 0.3, 0, 1));
        return;
      }
    }
    this.#play(now, { stroke: b.stroke ?? 0.16, x: b.x, y: b.y, given: true });
    this.nextBeatAt = interval ? now + interval : null;
  }

  // Keep time between the conductor's beats, and notice when they stop.
  #pump() {
    if (!this.active) return;
    const now = performance.now();
    const snap = this.conductor.snapshot();
    const interval = this.#interval();

    if (this.state === 'playing') {
      // A hand in view keeps the music flowing while it moves. Taps alone
      // (Space, or the stage with no hand) carry it for about one missing beat.
      const handInView = snap.present && now - this.conductor.seenAt < 400;
      const flowing = handInView
        ? !snap.cut && snap.fistProgress < 0.3 && snap.gesture !== 'hold'
        : now - (this.lastGivenAt ?? 0) < (interval ?? 0) * 1.6;
      if (flowing && interval && this.nextBeatAt != null && this.nextBeatAt - now <= LOOKAHEAD_MS) {
        const at = this.nextBeatAt;
        this.nextBeatAt = at + interval;
        this.#play(at, { stroke: 0.1, x: snap.x, y: snap.y, given: false });
        return;
      }
      // No beat coming: hold the chord and let it fade — a fermata.
      if (now - this.lastBeatAt > Math.max(1500, (interval ?? 750) * 2.2)) {
        this.state = 'holding';
        this.orchestra.hold(this.engine.ctx.currentTime);
        this.baton.setState('holding', this.beats);
        this.#fadeBow();
        this.#status('Holding — beat to go on');
        return;
      }
    }

    // Follow the hands between beats: swells, and facing a section.
    if (this.state === 'playing' && this.tick++ % 5 === 0) {
      this.orchestra.express(snap.dynamic, snap.focus, this.engine.ctx.currentTime);
      this.#meters(snap.dynamic, snap.focus);
    }
  }

  /** Play one beat of the score at `at` (performance time, now or just ahead). */
  #play(at, { stroke, x, y, given }) {
    const delay = Math.max(0, at - performance.now());
    const t = this.engine.ctx.currentTime + 0.005 + delay / 1000;
    if (this.state === 'tuning') this.orchestra.hush(t);
    this.orchestra.start();

    const snap = this.conductor.snapshot();
    const plan = this.score.next({ intensity: snap.dynamic, held: this.getHeld() });
    if (plan.silent) {
      this.#say('Your chords', 'Hold a chord.', 'Hold some keys on the piano, then beat: the orchestra plays what you hold.');
      return;
    }
    const interval = this.#interval() ?? 750;
    const strength = given ? clamp(stroke / 0.3, 0, 1) : 0.2;
    this.orchestra.play(plan, t, {
      dynamic: snap.dynamic,
      focus: snap.focus,
      strength,
      beatSeconds: interval / 1000,
      pizzicato: snap.pizzicato,
    });

    this.state = 'playing';
    this.lastBeatAt = at;
    this.beats += 1;
    this.recent = [...this.recent, snap.dynamic].slice(-8);

    // Show it the moment it sounds.
    setTimeout(() => {
      if (!this.active) return;
      this.#bow(plan.notes, snap.dynamic);
      for (const { section, midi, at: when } of plan.after) {
        setTimeout(() => this.state === 'playing' && this.#bow({ ...plan.notes, [section]: midi }, snap.dynamic), when * interval);
      }
      this.baton.beat({ x: x ?? 0.5, y: y ?? 0.6 }, given ? strength : 0.15);
      this.baton.setState('playing', this.beats);
      this.#meters(snap.dynamic, snap.focus);
      this.#readout(plan, snap);
      const mark = snap.pizzicato ? 'pizz. · ' : snap.gesture === 'tutti' ? 'tutti · ' : '';
      this.#status(`${mark}Bar ${plan.bar}, beat ${plan.beatInBar}${this.conductor.tempo ? ` · ${Math.round(this.conductor.tempo)} bpm` : ''}`);
    }, delay);
  }

  #cutoff() {
    if (this.state !== 'playing' && this.state !== 'holding') return;
    const t = this.engine.ctx.currentTime;
    this.orchestra.cut(t);
    this.#bow(null);
    this.nextBeatAt = null;
    const bars = Math.ceil(this.beats / 4);
    const avg = this.recent.reduce((a, b) => a + b, 0) / (this.recent.length || 1);
    const tempo = this.conductor.tempo;
    this.score.restart();
    if (this.beats >= BRAVO_BEATS && avg >= BRAVO_DYNAMIC) {
      this.state = 'bravo';
      this.orchestra.applause(t + 0.45);
      this.#say('Applause', 'Bravo.', `${bars} bars of ${PIECES[this.pieceId].label}${tempo ? `, ${tempoMark(tempo).toLowerCase()}` : ''}. Take a bow — then beat to play it again.`);
      this.#status('Bravo');
    } else {
      this.state = 'cut';
      this.#say('Orchestra', 'Cut off.', this.beats >= BRAVO_BEATS
        ? 'A quiet ending. Finish big for applause — or beat to begin again.'
        : 'Beat down to begin again.');
      this.#status('Cut off');
    }
    this.beats = 0;
    this.baton.setState(this.state, 0);
  }

  /* --------------------------------------------------------- display */

  #bow(notes, dynamic = 0.5) {
    const map = new Map();
    if (notes) for (const midi of Object.values(notes)) if (midi != null) map.set(midi, 0.35 + 0.55 * dynamic);
    this.strings.setBowed(map);
    this.keyboard.setBowed(new Set(map.keys()));
    if (!notes) this.#meters(0, 0.5);
  }

  #fadeBow() {
    this.strings.setBowed(new Map());
    this.keyboard.setBowed(new Set());
    this.#meters(0, 0.5);
  }

  #meters(dynamic, focus) {
    let facing = null;
    let best = -1;
    for (const id of SECTIONS) {
      const level = sectionLevel(id, dynamic, focus) / sectionLevel(id, 1, null);
      this.meters[id].style.setProperty('--level', clamp(level, 0, 1).toFixed(3));
      if (level > best) {
        best = level;
        facing = id;
      }
    }
    for (const id of SECTIONS) this.meters[id].classList.toggle('is-facing', dynamic > 0.05 && id === facing);
  }

  #readout(plan, snap) {
    // Name the harmony (one of each chord tone above the bass), not the
    // passing notes in the violins; the staff still shows every note played.
    const key = this.score.key;
    const bass = plan.notes.basses;
    const harmony = [bass, ...plan.chord.pcs.map((pc) => bass + 12 + mod12(pc - bass))];
    const analysis = analyze(harmony, key);
    const spelled = new Map(analysis.notes.map((n) => [mod12(n.midi), n.sp]));
    analysis.notes = [...new Set(Object.values(plan.notes))].sort((a, b) => a - b).map((midi) => {
      const sp = spelled.get(mod12(midi)) ?? spellInKey(midi, key);
      return { midi, sp, name: noteName(sp), label: noteLabel(midi, sp) };
    });
    const tempo = this.conductor.tempo;
    const extra = [];
    if (tempo) extra.push(['Tempo', `<i class="mark">${tempoMark(tempo)}</i> ♩ = ${Math.round(tempo)}`]);
    extra.push(['Dynamic', `<b class="dynamic-mark">${dynamicMark(snap.dynamic)}</b>${snap.pizzicato ? ' <i class="mark">pizz.</i>' : ''}`]);
    extra.push(['Bar', `${plan.bar} <span class="dot">·</span> beat ${plan.beatInBar}`]);
    this.readout.show(analysis, { key, eyebrow: PIECES[this.pieceId].label, extra, hideNotes: true });
  }

  #say(eyebrow, words, name) {
    this.readout.say({ eyebrow, words, name, key: this.score?.key });
  }

  #status(text) {
    this.ui.status.textContent = text;
  }
}
