// Conduct mode: the concert, start to finish. The orchestra tunes, falls
// silent when the baton goes up, plays one beat for every beat you give,
// holds when you stop, stops when you close your hand — and applauds a
// performance that earned it.
import { Orchestra, sectionLevel } from '../audio/orchestra.js';
import { Conductor, tempoMark, dynamicMark } from './gesture.js';
import { Score, PIECES, SECTIONS } from './score.js';
import { startHands, warmHands, cameraProblem } from './hands.js';
import { BatonView } from './baton.js';
import { HandModel } from './hand-model.js';
import { analyze, mod12, noteName, noteLabel, spellInKey } from '../theory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const BRAVO_BEATS = 16;

export class ConductMode {
  constructor({ engine, keyboard, strings, readout, getKey, getHeld, onChange }) {
    Object.assign(this, { engine, keyboard, strings, readout, getKey, getHeld, onChange });
    this.active = false;
    this.state = 'off';
    this.pieceId = 'canon';
    this.orchestra = new Orchestra(engine);
    this.conductor = new Conductor({
      beat: (b) => this.#beat(b),
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
    $('[data-conduct-beat]')?.addEventListener('click', () => this.manualBeat());
    this.ui.reflectionToggle.addEventListener('click', () => {
      const hidden = this.ui.video.classList.toggle('is-hidden');
      this.ui.reflectionToggle.textContent = hidden ? 'Show camera' : 'Hide camera';
    });
    this.#setupGestureGuide();
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
    warmHands((status) => {
      if (this.state === 'intro') this.ui.introError.textContent = '';
    });
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this.state = 'off';
    this.hands?.stop();
    this.hands = null;
    this.orchestra.stop();
    clearInterval(this.ticker);
    this.#bow(null);
    this.baton.clear();
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
    this.beats = 0;
    this.#showKey();
    if (this.state === 'playing' || this.state === 'holding') this.#say('Orchestra', PIECES[id].label, `${cap(PIECES[id].about)}. It starts on your next beat.`);
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
    this.ui.intro.hidden = true;
    this.ui.bar.hidden = false;
    this.ui.sections.hidden = false;
    this.ui.source.textContent = source === 'camera' ? 'Camera' : 'Mouse';
    this.ui.reflectionToggle.hidden = source !== 'camera';
    this.baton.source = source;
    this.baton.resize();

    this.state = 'tuning';
    this.orchestra.tune(this.engine.ctx.currentTime + 0.05);
    // The A strings shimmer while the orchestra tunes to them.
    setTimeout(() => this.state === 'tuning' && this.#bow({ basses: 33, cellos: 45, violas: 57, violins: 69 }, 0.05), 1000);
    this.#say('Orchestra', 'Tuning to A.', source === 'camera'
      ? 'Raise your hand when you\'re ready.'
      : 'Press on the stage when you\'re ready, then beat down.');
    this.#status(source === 'camera' ? 'Starting the camera…' : 'Press and drag down on the stage to beat');

    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.#tick(), 100);

    if (source === 'camera') {
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
        this.orchestra.stop();
        this.ui.bar.hidden = true;
        this.ui.sections.hidden = true;
        this.ui.intro.hidden = false;
        this.ui.introError.textContent = cameraProblem(error);
        this.state = 'intro';
      }
    }
  }

  /* ----------------------------------------------------------- input */

  #setupGestureGuide() {
    const guideCanvas = $('[data-gesture-canvas]');
    if (!guideCanvas) return;
    this.handModel = new HandModel(guideCanvas);
    const guidePanel = $('#gesture-guide');
    guidePanel?.addEventListener('toggle', (e) => {
      if (e.newState === 'open') {
        this.handModel.start();
      } else {
        this.handModel.stop();
      }
    });

    const descs = {
      wave: {
        title: 'Natural Flow & Tempo',
        text: 'Wave your hand in a natural cadence to conduct the flow. Wave faster for Allegro, or slower for a peaceful Andante. Both hands work together!'
      },
      dynamics: {
        title: 'Hand Height = Volume (Dynamics)',
        text: 'Raise your hand high for Forte (loud, powerful strings). Lower your hand down near your desk for Piano (soft whisper). Raising both hands unleashes an epic Tutti swell!'
      },
      pinch: {
        title: 'Pinch = Pluck (Pizzicato)',
        text: 'Touch your thumb and index finger together to make the orchestra pluck with playful Pizzicato. Release into an open hand for lush bowed strings.'
      },
      cutoff: {
        title: 'Clench Fist to Stop',
        text: 'Close either hand into a fist to cut off the orchestra. You can also press Esc or click Cut off anytime.'
      }
    };
    const descEl = $('[data-gesture-desc]');
    document.querySelectorAll('[data-gesture-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('[data-gesture-tab]').forEach((t) => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const mode = tab.dataset.gestureTab;
        this.handModel.setMode(mode);
        if (descEl && descs[mode]) {
          descEl.innerHTML = `<b>${descs[mode].title}</b><p>${descs[mode].text}</p>`;
        }
      });
    });
  }

  #frame(frame) {
    if (!this.active) return;
    const snap = this.conductor.update(frame);
    this.baton.show(frame.hands, frame.t, {
      fistProgress: snap.fistProgress,
      state: this.state,
      beats: this.beats,
      dynamic: snap.dynamic,
      focus: snap.focus,
      pizzicato: snap.pizzicato,
      gesture: snap.gesture,
    });

    const liveText = $('[data-gesture-live-text]');
    if (liveText) {
      if (snap.cut || snap.fistProgress > 0.3) {
        liveText.textContent = '🛑 Cut-Off (Fist Closed)';
      } else if (snap.pizzicato) {
        liveText.textContent = '✨ Pizzicato (Plucking Fingers)';
      } else if (snap.gesture === 'tutti') {
        liveText.textContent = '🙌 Grand Tutti (Both Hands)';
      } else if (snap.gesture === 'hold') {
        liveText.textContent = '✋ Holding (Fermata)';
      } else if (snap.tempo) {
        const handsTxt = snap.twoHands ? 'Both Hands' : '1 Hand';
        liveText.textContent = `♩ ${handsTxt} (${Math.round(snap.tempo)} BPM · ${tempoMark(snap.tempo)})`;
      } else if (snap.present) {
        liveText.textContent = snap.twoHands ? '🙌 Both Hands Ready' : '✋ Ready to Conduct';
      }
    }
  }

  manualBeat(strength = 0.6, pos = null) {
    if (!this.active || this.state === 'intro' || this.state === 'off') return;
    if (this.state === 'tuning' || this.state === 'cut' || this.state === 'bravo') {
      this.#raise();
    }
    const stroke = 0.08 + strength * 0.16;
    const x = pos?.x ?? this.conductor.x ?? 0.5;
    const y = pos?.y ?? this.conductor.y ?? 0.6;
    this.conductor.tapBeat(performance.now(), stroke, { x, y });
    this.baton.setState(this.state, this.beats);
  }

  #bindPointer() {
    const stage = this.ui.stage;
    let down = null;
    const at = (e) => {
      const r = stage.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, open: 1 };
    };
    stage.addEventListener('pointerdown', (e) => {
      if (!this.active || this.state === 'intro') return;
      if (e.target.closest('button, a, [data-readout] .chords')) return;
      if (this.source === 'camera') {
        const r = stage.getBoundingClientRect();
        this.manualBeat(0.65, { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
        return;
      }
      if (this.source !== 'mouse') return;
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      down = e.pointerId;
      this.#frame({ t: performance.now(), hands: [at(e)] });
    });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerId !== down) return;
      // Every sample between frames, so fast strokes aren't missed.
      const samples = e.getCoalescedEvents?.() ?? [];
      for (const ev of samples.length ? samples : [e]) this.#frame({ t: ev.timeStamp || performance.now(), hands: [at(ev)] });
    });
    const up = (e) => {
      if (e.pointerId !== down) return;
      down = null;
      this.#frame({ t: performance.now(), hands: [] });
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
  }

  /* ---------------------------------------------------------- events */

  #raise() {
    if (this.state === 'tuning' || this.state === 'cut' || this.state === 'bravo') {
      this.orchestra.hush(this.engine.ctx.currentTime);
      this.#fadeBow();
      this.state = 'ready';
      this.baton.setState(this.state, this.beats);
      this.#say('Orchestra', 'Ready.', `${PIECES[this.pieceId].label}, in ${this.score.key.name}. Beat down to begin.`);
      this.#status('Beat down to begin');
    }
  }

  #beat(b) {
    if (!this.active || this.state === 'intro' || this.state === 'off') return;
    const now = performance.now();
    if (this.lastBeatAt && now - this.lastBeatAt < Math.max(260, this.beatMs * 0.65)) return;

    const t = this.engine.ctx.currentTime + 0.005;
    if (this.state === 'tuning') this.orchestra.hush(t);
    this.orchestra.start();

    const snap = this.conductor.snapshot();
    const dynamic = snap.dynamic;
    const plan = this.score.next({ intensity: dynamic, held: this.getHeld() });
    if (plan.silent) {
      this.#say('Your chords', 'Hold a chord.', 'Hold some keys on the piano, then beat: the orchestra plays what you hold.');
      return;
    }
    const beatSeconds = snap.tempo ? 60 / snap.tempo : 0.75;
    const strength = clamp((b.stroke ?? 0.16) / 0.3, 0, 1);
    this.orchestra.play(plan, t, {
      dynamic,
      focus: snap.focus,
      strength,
      beatSeconds,
      pizzicato: snap.pizzicato,
    });

    this.state = 'playing';
    this.lastBeatAt = now;
    this.beatMs = beatSeconds * 1000;
    this.beats += 1;
    this.recent = [...this.recent, dynamic].slice(-8);

    this.#bow(plan.notes, dynamic);
    for (const { section, midi, at } of plan.after) {
      setTimeout(() => this.state === 'playing' && this.#bow({ ...plan.notes, [section]: midi }, dynamic), at * beatSeconds * 1000);
    }
    this.baton.beat({ x: b.x, y: b.y }, strength);
    this.#meters(dynamic, snap.focus);
    this.#readout(plan, snap);
    const gesturePrefix = snap.pizzicato ? '✨ Pizzicato · ' :
                          snap.gesture === 'tutti' ? '🙌 Tutti · ' :
                          snap.twoHands ? '🙌 2 Hands · ' : '';
    this.#status(`${gesturePrefix}Bar ${plan.bar} · Beat ${plan.beatInBar}${snap.tempo ? ` · ${Math.round(snap.tempo)} BPM` : ''}`);
  }

  #cutoff() {
    if (this.state !== 'playing' && this.state !== 'holding') return;
    const t = this.engine.ctx.currentTime;
    this.orchestra.cut(t);
    this.#bow(null);
    const bars = Math.ceil(this.beats / 4);
    const avg = this.recent.reduce((a, b) => a + b, 0) / (this.recent.length || 1);
    const tempo = this.conductor.tempo;
    this.score.restart();
    if (this.beats >= BRAVO_BEATS && avg >= 0.42) {
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

  // Between beats: follow the hands, and flow naturally with the tempo
  #tick() {
    if (!this.active) return;
    const snap = this.conductor.snapshot();
    const t = this.engine.ctx.currentTime;
    const now = performance.now();

    if (this.state === 'playing') {
      // Natural cadence: when waving naturally, the music flows in time!
      if (snap.present && !snap.cut && snap.gesture !== 'hold' && snap.gesture !== 'fist') {
        const interval = Math.max(380, this.beatMs || 750);
        if (now - this.lastBeatAt >= interval) {
          this.#beat({ stroke: 0.12, x: snap.x, y: snap.y });
          return;
        }
      }

      // If hand is held still for more than 1.8 seconds, hold the chord in suspension (Fermata)
      if (now - this.lastBeatAt > Math.max(1800, (this.beatMs || 750) * 2.2)) {
        this.state = 'holding';
        this.orchestra.hold(t);
        this.#status('Holding (fermata) — wave to continue');
        this.baton.setState('holding', this.beats);
      } else {
        this.orchestra.express(snap.dynamic, snap.focus, t);
        this.#meters(snap.dynamic, snap.focus);
      }
    }
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
      const full = sectionLevel(id, 1, null);
      const level = sectionLevel(id, dynamic, focus) / full;
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
    const extra = [];
    if (snap.tempo) extra.push(['Tempo', `<i class="mark">${tempoMark(snap.tempo)}</i> ♩ = ${Math.round(snap.tempo)}`]);
    extra.push(['Dynamic', `<b class="dynamic-mark">${dynamicMark(snap.dynamic)}</b>`]);
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

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
