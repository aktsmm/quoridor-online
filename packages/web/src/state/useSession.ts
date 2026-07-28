import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { prewarm } from '../net/endpoint.js';
import { SessionStore, type SessionSnapshot } from './store.js';

const SessionContext = createContext<SessionStore | null>(null);
export const SessionProvider = SessionContext.Provider;

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) throw new Error('useSessionStore must be used inside <SessionProvider>');
  return store;
}

export function useSession(): SessionSnapshot {
  const store = useSessionStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useCreateSessionStore(): SessionStore {
  const store = useMemo(() => new SessionStore(), []);

  useEffect(() => {
    // Kick the container awake before opening the socket: a cold Container Apps
    // replica takes ~24 s, and an HTTP request starts that clock immediately.
    const controller = new AbortController();
    void prewarm(controller.signal);
    store.start();

    const wake = (): void => {
      if (document.visibilityState === 'visible') store.retryNow();
    };
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);

    return () => {
      controller.abort();
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake);
      store.stop();
    };
  }, [store]);

  return store;
}
