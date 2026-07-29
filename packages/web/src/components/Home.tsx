import { defaultWallsPerPlayer, type PlayerCount } from '@quoridor/engine';
import { useState } from 'react';
import { useI18n, type MessageKey } from '../i18n/index.js';
import type { AiLevel } from '../net/protocol.js';
import { loadName, saveName } from '../state/storage.js';

export type HomeIntent =
  | { kind: 'cpu'; playerCount: PlayerCount; aiLevel: AiLevel; name: string }
  | { kind: 'host'; playerCount: PlayerCount; aiLevel: AiLevel; fillWithCpu: boolean; name: string }
  | { kind: 'join'; code: string; name: string }
  | { kind: 'watch'; code: string };

interface Props {
  busy: boolean;
  canAct: boolean;
  onSubmit: (intent: HomeIntent) => void;
  onShowRules: () => void;
}

type View = 'menu' | 'cpu' | 'host' | 'join' | 'watch';

const PLAYER_COUNTS: PlayerCount[] = [2, 3, 4];
const LEVELS: { value: AiLevel; key: MessageKey }[] = [
  { value: 'easy', key: 'setupLevelEasy' },
  { value: 'normal', key: 'setupLevelNormal' },
  { value: 'hard', key: 'setupLevelHard' },
];
const COUNT_KEYS: Record<PlayerCount, MessageKey> = {
  2: 'setupPlayers2',
  3: 'setupPlayers3',
  4: 'setupPlayers4',
};

export function Home({ busy, canAct, onSubmit, onShowRules }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [view, setView] = useState<View>('menu');
  const [name, setName] = useState(loadName);
  const [playerCount, setPlayerCount] = useState<PlayerCount>(2);
  const [aiLevel, setAiLevel] = useState<AiLevel>('normal');
  const [fillWithCpu, setFillWithCpu] = useState(true);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<MessageKey | null>(null);

  const trimmedName = name.trim();

  const submit = (intent: HomeIntent): void => {
    if (!trimmedName) {
      setProblem('errNameRequired');
      return;
    }
    saveName(trimmedName);
    setProblem(null);
    onSubmit(intent);
  };

  if (view === 'menu') {
    return (
      <div className="home">
        <header className="home__hero">
          <h1 className="home__title">{t('appName')}</h1>
          <p className="home__tagline">{t('tagline')}</p>
        </header>

        <nav className="menu">
          <MenuItem
            icon="🤖"
            accent="var(--blue)"
            label={t('homeVsCpu')}
            hint={t('homeVsCpuHint')}
            disabled={!canAct}
            onClick={() => setView('cpu')}
          />
          <MenuItem
            icon="🎲"
            accent="var(--orange)"
            label={t('homeHost')}
            hint={t('homeHostHint')}
            disabled={!canAct}
            onClick={() => setView('host')}
          />
          <MenuItem
            icon="🔑"
            accent="var(--green)"
            label={t('homeJoin')}
            hint={t('homeJoinHint')}
            disabled={!canAct}
            onClick={() => setView('join')}
          />
          <MenuItem
            icon="👀"
            accent="var(--pink)"
            label={t('homeWatch')}
            hint={t('homeWatchHint')}
            disabled={!canAct}
            onClick={() => setView('watch')}
          />
          <MenuItem
            icon="📖"
            accent="var(--purple)"
            label={t('homeHowTo')}
            hint=""
            disabled={false}
            onClick={onShowRules}
          />
        </nav>
      </div>
    );
  }

  const nameField = (
    <label className="field">
      <span className="field__label">{t('setupYourName')}</span>
      <input
        value={name}
        maxLength={24}
        placeholder={t('setupNamePlaceholder')}
        onChange={(event) => setName(event.target.value)}
        autoComplete="nickname"
      />
    </label>
  );

  const back = (
    <button type="button" className="btn btn--plain" onClick={() => setView('menu')}>
      ‹ {t('homeBack')}
    </button>
  );

  const codeField = (
    <label className="field">
      <span className="field__label">{t('joinCode')}</span>
      <input
        className="code-input"
        value={code}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={6}
        placeholder="000000"
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
      />
    </label>
  );

  if (view === 'join' || view === 'watch') {
    // Watching needs nothing but the code: there is no seat to label.
    const watching = view === 'watch';
    return (
      <div className="home">
        {back}
        <section className="card">
          <h2 className="card__title">{watching ? t('watchTitle') : t('joinTitle')}</h2>
          <form
            className="form"
            style={{ marginTop: 18 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!/^\d{6}$/.test(code)) {
                setProblem('errInvalidCode');
                return;
              }
              if (watching) {
                setProblem(null);
                onSubmit({ kind: 'watch', code });
                return;
              }
              submit({ kind: 'join', code, name: trimmedName });
            }}
          >
            {codeField}
            {!watching && nameField}
            {problem && <p className="form__note">{t(problem)}</p>}
            <button
              type="submit"
              className="btn btn--primary btn--wide"
              disabled={busy || !canAct || code.length !== 6}
            >
              {watching ? t('watchAction') : t('joinAction')}
            </button>
          </form>
        </section>
      </div>
    );
  }

  const isCpu = view === 'cpu';

  return (
    <div className="home">
      {back}
      <section className="card">
        <h2 className="card__title">{isCpu ? t('homeVsCpu') : t('homeHost')}</h2>
        <p className="card__subtitle">{t('setupWalls', { count: defaultWallsPerPlayer(playerCount) })}</p>

        <form
          className="form"
          style={{ marginTop: 18 }}
          onSubmit={(event) => {
            event.preventDefault();
            submit(
              isCpu
                ? { kind: 'cpu', playerCount, aiLevel, name: trimmedName }
                : { kind: 'host', playerCount, aiLevel, fillWithCpu, name: trimmedName },
            );
          }}
        >
          <div className="form__row">
            <span className="field__label">{t('setupPlayers')}</span>
            <div className="segmented">
              {PLAYER_COUNTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="segmented__item"
                  aria-pressed={playerCount === value}
                  onClick={() => setPlayerCount(value)}
                >
                  {t(COUNT_KEYS[value])}
                </button>
              ))}
            </div>
            {playerCount === 3 && <p className="form__note">{t('setupPlayers3Note')}</p>}
          </div>

          <div className="form__row">
            <span className="field__label">{t('setupLevel')}</span>
            <div className="segmented">
              {LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  className="segmented__item"
                  aria-pressed={aiLevel === level.value}
                  onClick={() => setAiLevel(level.value)}
                >
                  {t(level.key)}
                </button>
              ))}
            </div>
          </div>

          {!isCpu && (
            <div className="form__row">
              <div className="toggle-row">
                <span className="field__label">{t('setupFillCpu')}</span>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={fillWithCpu}
                  aria-label={t('setupFillCpu')}
                  onClick={() => setFillWithCpu((v) => !v)}
                >
                  <span className="switch__knob" />
                </button>
              </div>
              <p className="form__note">{t('setupFillCpuHint')}</p>
            </div>
          )}

          {nameField}
          {problem && <p className="form__note">{t(problem)}</p>}

          <button type="submit" className="btn btn--primary btn--wide" disabled={busy || !canAct}>
            {isCpu ? t('setupStartLocal') : t('setupCreate')}
          </button>
        </form>
      </section>
    </div>
  );
}

interface MenuItemProps {
  icon: string;
  accent: string;
  label: string;
  hint: string;
  disabled: boolean;
  onClick: () => void;
}

function MenuItem({ icon, accent, label, hint, disabled, onClick }: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="menu__item"
      style={{ ['--accent' as string]: accent }}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="menu__icon" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="menu__label">{label}</span>
        {hint && <span className="menu__hint" style={{ display: 'block' }}>{hint}</span>}
      </span>
      <span className="menu__chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
