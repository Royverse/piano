// Play from a MIDI keyboard with the Web MIDI API (Chrome, Edge, Opera, Firefox).

export const midiSupported = () => typeof navigator.requestMIDIAccess === 'function';

/** True if the browser already allowed MIDI, so we can connect without a prompt. */
export async function midiAllowed() {
  if (!midiSupported() || !navigator.permissions?.query) return false;
  try {
    return (await navigator.permissions.query({ name: 'midi' })).state === 'granted';
  } catch {
    return false;
  }
}

export async function connectMidi({ onNote, onRelease, onPedal, onDevices }) {
  const access = await navigator.requestMIDIAccess();
  const handle = ({ data }) => {
    const [status, a, b] = data;
    const command = status & 0xf0;
    if (command === 0x90 && b > 0) onNote(a, b / 127);
    else if (command === 0x80 || (command === 0x90 && b === 0)) onRelease(a);
    else if (command === 0xb0 && a === 64) onPedal(b >= 64);
  };
  const refresh = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = handle;
      if (input.state === 'connected') names.push(input.name || 'MIDI keyboard');
    }
    onDevices(names);
  };
  access.onstatechange = refresh;
  refresh();
  return access;
}
