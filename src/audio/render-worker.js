// Renders notes off the main thread so the keyboard never stutters.
import { renderNote } from './synth.js';

self.onmessage = ({ data }) => {
  const { voice, midi, sampleRate } = data;
  const { samples, rate } = renderNote(voice, midi, sampleRate);
  self.postMessage({ voice, midi, rate, samples }, [samples.buffer]);
};
