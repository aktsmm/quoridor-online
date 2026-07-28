/**
 * Small WebAudio blips. Synthesised rather than shipped as files so the bundle
 * stays tiny and there is nothing to 404 on a cold CDN.
 */
export type SoundName = 'move' | 'wall' | 'win' | 'join';

const STORAGE_KEY = 'quoridor.sound';

interface Blip {
  freq: number;
  to: number;
  duration: number;
  type: OscillatorType;
  gain: number;
}

const BLIPS: Record<SoundName, Blip> = {
  move: { freq: 520, to: 700, duration: 0.09, type: 'sine', gain: 0.1 },
  wall: { freq: 200, to: 120, duration: 0.14, type: 'triangle', gain: 0.14 },
  win: { freq: 660, to: 1320, duration: 0.5, type: 'sine', gain: 0.14 },
  join: { freq: 440, to: 880, duration: 0.16, type: 'sine', gain: 0.1 },
};

let context: AudioContext | null = null;
let enabled = loadPreference();

function loadPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
  } catch {
    // Preference is a nicety; never break playback over it.
  }
  if (next) void resume();
}

/** Browsers only allow audio after a gesture, so this is called from handlers. */
export async function resume(): Promise<void> {
  if (!enabled) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') await context.resume();
}

export function play(name: SoundName): void {
  if (!enabled) return;
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') return;
    const blip = BLIPS[name];
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = blip.type;
    osc.frequency.setValueAtTime(blip.freq, now);
    osc.frequency.exponentialRampToValueAtTime(blip.to, now + blip.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(blip.gain, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + blip.duration);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + blip.duration + 0.02);
  } catch {
    // Audio is decoration - a failure here must never reach the player.
  }
}
