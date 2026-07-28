/**
 * Resolves the game server endpoint.
 *
 * In production the front end lives on Static Web Apps and the server on
 * Container Apps, so the origin is baked in at build time. In dev we fall back
 * to the local server.
 */
const configured = import.meta.env['VITE_SERVER_URL'] as string | undefined;

function normalise(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/** `https://host` -> `wss://host`, `http://host` -> `ws://host`. */
export function websocketUrl(): string {
  const base = normalise(configured?.trim() || defaultBase());
  return `${base.replace(/^http/, 'ws')}/ws`;
}

export function healthUrl(): string {
  return `${normalise(configured?.trim() || defaultBase())}/health`;
}

function defaultBase(): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:8080`;
}

/**
 * Container Apps scales to zero, and a cold start costs roughly 20-30 seconds.
 * Firing a plain HTTP request the moment the page loads gets that clock running
 * while the user is still reading the home screen.
 */
export async function prewarm(signal?: AbortSignal): Promise<boolean> {
  try {
    const init: RequestInit = { method: 'GET', mode: 'cors', cache: 'no-store' };
    if (signal) init.signal = signal;
    const response = await fetch(healthUrl(), init);
    return response.ok;
  } catch {
    return false;
  }
}
