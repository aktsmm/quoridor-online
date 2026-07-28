import { useState } from 'react';
import { ConnectionBadge } from './components/ConnectionBadge.js';
import { Game } from './components/Game.js';
import { Home, type HomeIntent } from './components/Home.js';
import { Lobby } from './components/Lobby.js';
import { errorKey } from './components/shared.js';
import { RulesSheet, SettingsSheet } from './components/Sheets.js';
import { I18nProvider, useI18n, useProvideI18n } from './i18n/index.js';
import { SessionProvider, useCreateSessionStore, useSession, useSessionStore } from './state/useSession.js';
import './styles/app.css';
import './styles/global.css';

export function App(): React.JSX.Element {
  const i18n = useProvideI18n();
  const store = useCreateSessionStore();
  return (
    <I18nProvider value={i18n}>
      <SessionProvider value={store}>
        <Shell />
      </SessionProvider>
    </I18nProvider>
  );
}

function Shell(): React.JSX.Element {
  const { t } = useI18n();
  const store = useSessionStore();
  const session = useSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const connected = session.status === 'open';
  const room = session.room;
  const screen = room === null ? 'home' : room.status === 'lobby' ? 'lobby' : 'game';

  const submit = (intent: HomeIntent): void => {
    if (intent.kind === 'join') {
      store.joinRoom(intent.code, intent.name);
      return;
    }
    store.createRoom({
      playerCount: intent.playerCount,
      aiLevel: intent.aiLevel,
      fillWithCpu: intent.kind === 'cpu' ? true : intent.fillWithCpu,
      name: intent.name,
      autoStart: intent.kind === 'cpu',
    });
  };

  return (
    <div className="app">
      <header className="app__bar">
        <span className="app__brand">
          <span className="app__brand-mark" aria-hidden="true" />
          {t('appName')}
        </span>
        <ConnectionBadge
          status={session.status}
          retryAt={session.retryAt}
          onRetry={() => store.retryNow()}
        />
        <button
          type="button"
          className="btn btn--plain"
          aria-label={t('settings')}
          onClick={() => setSettingsOpen(true)}
        >
          ⚙︎
        </button>
      </header>

      <main className="app__main">
        {screen === 'home' && (
          <>
            <Home
              busy={session.busy}
              canAct={connected}
              onSubmit={submit}
              onShowRules={() => setRulesOpen(true)}
            />
            {!connected && <ColdStartHint />}
          </>
        )}

        {screen === 'lobby' && room && (
          <Lobby
            room={room}
            youIndex={session.seatIndex}
            busy={session.busy}
            onStart={() => store.startGame()}
            onLeave={() => store.leaveRoom()}
          />
        )}

        {screen === 'game' && room && (
          <Game
            room={room}
            youIndex={session.seatIndex}
            frozen={session.optimistic}
            onMove={(move, next) => store.makeMove(move, next)}
            onLeave={() => store.leaveRoom()}
            onHome={() => store.goHome()}
          />
        )}
      </main>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {rulesOpen && <RulesSheet onClose={() => setRulesOpen(false)} />}

      {session.error && (
        <div className="toast" role="alert">
          <span className="toast__text">{t(errorKey(session.error.code))}</span>
          <button type="button" className="btn btn--plain" onClick={() => store.dismissError()}>
            OK
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Container Apps scales to zero, so the very first visit can wait ~25 seconds.
 * Saying so up front is far better than an unexplained disabled button.
 */
function ColdStartHint(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <p className="form__note" style={{ textAlign: 'center', marginTop: 18 }}>
      {t('connWaking')} · {t('connWakingHint')}
    </p>
  );
}
