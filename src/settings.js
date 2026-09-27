// Preferences that should survive a reload. Storage can be missing or blocked
// (private windows, strict settings), so every access is guarded.
const STORAGE_KEY = 'overtone:settings:v1';

export const DEFAULTS = {
  voice: 'grand',
  octave: 4,
  dynamic: 3,
  room: 'room',
  tuning: 'equal',
  labels: 'letters',
  volume: 0.8,
  keyTonic: null,
  keyMode: 'major',
  stayInKey: false,
  piece: 'canon',
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* storage unavailable: settings last for this visit only */ }
}
