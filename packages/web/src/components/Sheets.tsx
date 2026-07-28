import { useI18n, type Lang } from '../i18n/index.js';
import { isSoundEnabled, resume, setSoundEnabled } from '../sound.js';
import { useState } from 'react';

interface Props {
  onClose: () => void;
}

export function SettingsSheet({ onClose }: Props): React.JSX.Element {
  const { t, lang, setLang } = useI18n();
  const [sound, setSound] = useState(isSoundEnabled);

  const toggleSound = (): void => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) void resume();
  };

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2 className="sheet__title">{t('settings')}</h2>

        <div className="form__row">
          <span className="field__label">{t('settingsLanguage')}</span>
          <div className="segmented">
            {(['ja', 'en'] as Lang[]).map((value) => (
              <button
                key={value}
                type="button"
                className="segmented__item"
                aria-pressed={lang === value}
                onClick={() => setLang(value)}
              >
                {value === 'ja' ? '日本語' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div className="toggle-row">
          <span className="field__label">{t('settingsSound')}</span>
          <button
            type="button"
            className="switch"
            role="switch"
            aria-checked={sound}
            aria-label={t('settingsSound')}
            onClick={toggleSound}
          >
            <span className="switch__knob" />
          </button>
        </div>

        <button type="button" className="btn btn--primary btn--wide" onClick={onClose}>
          {t('settingsClose')}
        </button>
      </div>
    </div>
  );
}

export function RulesSheet({ onClose }: Props): React.JSX.Element {
  const { t } = useI18n();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <h2 className="sheet__title">{t('rulesTitle')}</h2>
        <div className="sheet__body">
          <p>{t('rulesGoal')}</p>
          <p>{t('rulesJump')}</p>
          <p>{t('rulesWalls')}</p>
          <p>{t('rulesWallCount', { two: 10, three: 7, four: 5 })}</p>
        </div>
        <button type="button" className="btn btn--primary btn--wide" onClick={onClose}>
          {t('settingsClose')}
        </button>
      </div>
    </div>
  );
}
