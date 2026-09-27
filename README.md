# Overtone

**A piano you can see inside.** Play in the browser and watch the strings under the lid. Every note, interval and chord is named as you play it and written on a grand staff.

## What it does

- **Four instruments, no samples.** Grand, Felt, Electric and Celesta are synthesised note by note in a Web Worker. The model includes stiff-string inharmonicity, beating unison strings, a two-stage decay, a felt-and-wood hammer thump, and a room made from a generated impulse response. Nothing is downloaded but the code.
- **The strings show what you hear.** Each key strikes its own strings: one copper-wound string in the bass, two in the tenor, three steel strings above. Hold the pedal and the dampers lift. Strings whose overtones match your note then start to ring on their own (sympathetic resonance), and the number of loops shows which overtone. As on a real piano, the top octave and a half has no dampers.
- **It names what you play.** Notes with their frequency, intervals with their frequency ratio, and chords with inversions and slash bass. Spelling follows interval, so C–E♭ is a minor third, never C–D♯. The notes are engraved on a grand staff, with the key signature, ledger lines and 8va.
- **Play in a key.** Pick a key on the circle of fifths:
  - its scale is marked on the keys;
  - every chord gets its roman numeral (V7, ii, ♭VII, V7/V);
  - keys 1–7 play the key's chords (hold Shift for sevenths).
  - *Stay in key* maps your letter rows to the scale only.
  - *Just intonation* retunes to pure intervals above the key note.
- **Conduct the orchestra with your hands (MediaPipe) or mouse:**
  - Lead a synthesised 5-section string orchestra (basses, cellos, violas, violins II, violins I) with authentic body resonances, bowing noise, and warm concert hall acoustics.
  - **Tuning up:** The oboe sounds a concert A (440 Hz) and strings shimmer as the players tune their pegs.
  - **The baton:** Raise your hand in front of your webcam (or click) to silence the room. Beat down in the air to give the beat (ictus). The pace sets the tempo; the height and velocity of your gesture controls dynamic loudness from *pp* to *ff*.
  - **Stardust & visuals:** Every beat triggers a burst of golden stardust and an expanding shockwave ripple. Your video reflection shimmers in the lacquer lid.
  - **Expression & facing:** Point left toward the cellos/basses or right toward the violins to bring that section forward. Raise your left hand to create expressive swells.
  - **Cut-off & applause:** Close your hand into a fist to cut the orchestra off cleanly. Complete an energetic performance of 16+ beats to earn a roaring *Bravo!* and crowd applause!
  - **Repertoire:** Conduct through Pachelbel's *Canon*, a flamenco *Lament*, a soaring *Anthem*, a jazz *Nocturne*, or choose *Your chords* to orchestrate any progression you hold on the piano keys!
- **Play it however you like.**
  - **Computer keyboard:** by physical key, so it works on any layout.
  - **Mouse or multi-touch:** drag across the keys for a glissando; tap lower on a key to play louder.
  - **MIDI keyboard:** with its own velocity and sustain pedal.
- **Record and share.** A take is compressed into the link itself, so sharing needs no server.

## Play

| Key | Does |
| --- | --- |
| `A S D F G H J K L ; '` | White keys, from C |
| `W E T Y U O P` | Black keys |
| `Space` | Sustain pedal (hold) |
| `Z` / `X` | Octave down / up |
| `C` / `V` | Softer / louder, from *pp* to *ff* |
| `1`–`7` | Chords of the key (`Shift` for sevenths) |
| `?` | How to play |

## Run it locally

No build step and no dependencies. It's plain HTML, CSS and ES modules.

```bash
npm start
```

That runs a tiny static server at http://localhost:5173. Any static server works, as long as it serves `.js` files as JavaScript.

```bash
npm test
```

The tests use Node's built-in test runner (Node 20+). They cover chord naming, spelling, keys, intervals and roman numerals; that every note of every voice renders cleanly; and that shared takes round-trip.

## How it's built

| File | Role |
| --- | --- |
| `src/theory.js` | Spelling, keys, intervals, chord identification, roman numerals |
| `src/audio/synth.js` | Offline note synthesis (runs in `render-worker.js`) |
| `src/audio/engine.js` | Web Audio: playback, dampers, pedal, room, tuning |
| `src/audio/orchestra.js` | Physical string orchestra synthesis: bowed sections, vibrato, oboe A440, applause |
| `src/strings.js` | The canvas under the lid: strings, dampers, sympathetic resonance |
| `src/keyboard.js` | Keys with real piano proportions, pointer input |
| `src/staff.js` | Grand-staff engraving in SVG |
| `src/readout.js` | The note, interval and chord readout |
| `src/conduct/conduct.js` | Concert mode coordinator: tuning, beat dispatch, scoring, cut-off |
| `src/conduct/hands.js` | MediaPipe hand tracking pipeline (runs client-side) |
| `src/conduct/gesture.js` | Gesture recognition: downstrokes, tempo, dynamics, facing, fist cut-off |
| `src/conduct/baton.js` | Canvas HUD: mirrored gold hand bones, baton ribbons, ripples, stardust |
| `src/conduct/score.js` | Section ranges, smooth voice leading, first-violin variations |
| `src/take.js` | Recording, playback and link encoding |
| `src/main.js` | Wires it all together |

## Deploy

It's a static site: serve the repository root. On GitHub Pages, go to **Settings → Pages**, choose **Deploy from a branch**, then pick `main` and `/ (root)`.

Fonts: [Bodoni Moda](https://fonts.google.com/specimen/Bodoni+Moda), [Jost](https://fonts.google.com/specimen/Jost) and [Noto Music](https://fonts.google.com/noto/specimen/Noto+Music), from Google Fonts.
