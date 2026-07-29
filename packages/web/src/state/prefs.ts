/**
 * Small user preferences that live outside React so they can be read from
 * anywhere and survive a reload. Same shape as `sound.ts`: a module-level value
 * mirrored into localStorage, with every storage access guarded because private
 * browsing modes throw.
 */
import { useSyncExternalStore } from 'react';

export type ControlScheme = 'smart' | 'classic';

const CONTROLS_KEY = 'quoridor.controls';
const HAPTICS_KEY = 'quoridor.haptics';

const listeners = new Set<() => void>();

let controls: ControlScheme = loadControls();
let haptics: boolean = loadHaptics();

function loadControls(): ControlScheme {
  try {
    return localStorage.getItem(CONTROLS_KEY) === 'classic' ? 'classic' : 'smart';
  } catch {
    return 'smart';
  }
}

function loadHaptics(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getControlScheme(): ControlScheme {
  return controls;
}

export function setControlScheme(next: ControlScheme): void {
  if (controls === next) return;
  controls = next;
  try {
    localStorage.setItem(CONTROLS_KEY, next);
  } catch {
    // Preference only; never break the board over it.
  }
  emit();
}

export function isHapticsEnabled(): boolean {
  return haptics;
}

export function setHapticsEnabled(next: boolean): void {
  if (haptics === next) return;
  haptics = next;
  try {
    localStorage.setItem(HAPTICS_KEY, next ? 'on' : 'off');
  } catch {
    // Ignore.
  }
  emit();
}

/**
 * A short buzz while dragging, and a firmer one on commit. iOS Safari does not
 * implement `vibrate`, so this is an Android-only bonus on top of the visual
 * read-out - never the only feedback.
 */
export function vibrate(ms: number): void {
  if (!haptics) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Ignore.
  }
}

export function useControlScheme(): ControlScheme {
  return useSyncExternalStore(subscribe, getControlScheme, () => 'smart' as const);
}

export function useHaptics(): boolean {
  return useSyncExternalStore(subscribe, isHapticsEnabled, () => true);
}
