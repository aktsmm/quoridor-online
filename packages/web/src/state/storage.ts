export interface Credentials {
  roomId: string;
  code: string;
  playerToken: string;
}

const KEY = 'quoridor.session';
const NAME_KEY = 'quoridor.name';

/**
 * The seat token is what lets a refresh - or a Container Apps revision swap -
 * drop the player back into their own seat instead of a fresh one.
 */
export function loadCredentials(): Credentials | null {
  try {
    const raw = sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Credentials).code === 'string' &&
      typeof (parsed as Credentials).playerToken === 'string' &&
      typeof (parsed as Credentials).roomId === 'string'
    ) {
      return parsed as Credentials;
    }
  } catch {
    // Corrupt or blocked storage just means "no session to resume".
  }
  return null;
}

export function saveCredentials(credentials: Credentials): void {
  try {
    // sessionStorage keeps two tabs from fighting over one seat, which is what
    // you want when testing two players on one machine.
    sessionStorage.setItem(KEY, JSON.stringify(credentials));
  } catch {
    // Ignore: resuming is a convenience, not a requirement.
  }
}

export function clearCredentials(): void {
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    // Ignore.
  }
}

export function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Ignore.
  }
}
