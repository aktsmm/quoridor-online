import { useState } from 'react';
import { useI18n } from '../i18n/index.js';
import type { RoomView } from '../net/protocol.js';
import { displayName, openSeatCount, seatLabelKey } from './shared.js';

interface Props {
  room: RoomView;
  youIndex: number | null;
  busy: boolean;
  onStart: () => void;
  onLeave: () => void;
}

export function Lobby({ room, youIndex, busy, onStart, onLeave }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isHost = youIndex !== null && room.hostSeat === youIndex;
  const waiting = room.fillWithCpu ? 0 : openSeatCount(room);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(room.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some browsers; the code is on screen anyway.
    }
  };

  const share = async (): Promise<void> => {
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: t('appName'), text: `${t('lobbyCode')}: ${room.code}` });
    } catch {
      // The user dismissed the share sheet.
    }
  };

  return (
    <div className="lobby">
      <section className="card">
        <div className="code-display">
          <div className="code-display__label">{t('lobbyCode')}</div>
          <div className="code-display__value">{room.code}</div>
          <p className="code-display__hint">{t('lobbyShareHint')}</p>
          <div className="code-display__actions">
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied ? t('lobbyCopied') : t('lobbyCopy')}
            </button>
            {typeof navigator.share === 'function' && (
              <button type="button" className="btn" onClick={() => void share()}>
                {t('lobbyShare')}
              </button>
            )}
          </div>
        </div>
      </section>

      <Roster room={room} youIndex={youIndex} />

      {isHost ? (
        <button
          type="button"
          className="btn btn--primary btn--wide"
          disabled={busy || waiting > 0}
          onClick={onStart}
        >
          {waiting > 0 ? t('lobbyNeedPlayers', { count: waiting }) : t('lobbyStart')}
        </button>
      ) : (
        <p className="form__note" style={{ textAlign: 'center' }}>
          {t('lobbyWaitingHost')}
        </p>
      )}

      <button type="button" className="btn btn--danger btn--wide" onClick={onLeave}>
        {t('lobbyLeave')}
      </button>
    </div>
  );
}

export function Roster({
  room,
  youIndex,
}: {
  room: RoomView;
  youIndex: number | null;
}): React.JSX.Element {
  const { t } = useI18n();
  return (
    <ul className="roster" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {room.seats.map((seat) => {
        const empty = seat.connection === 'empty';
        return (
          <li key={seat.index} className="roster__row">
            <span
              className={`roster__dot${empty ? ' roster__dot--empty' : ''}`}
              style={{ ['--seat-color' as string]: `var(--seat-${seat.index})` }}
            />
            <span className="roster__name">
              {empty ? t('lobbySeatEmpty') : displayName(room, seat.index, youIndex, t)}
            </span>
            <span className="roster__meta">
              <span className="tag">{t(seatLabelKey(seat.seat))}</span>
              {seat.index === youIndex && <span className="tag tag--you">{t('lobbyYou')}</span>}
              {room.hostSeat === seat.index && <span className="tag tag--host">{t('lobbyHost')}</span>}
              {seat.connection === 'disconnected' && (
                <span className="tag tag--warn">{t('gameDisconnected')}</span>
              )}
              {seat.connection === 'cpu-controlled' && seat.kind === 'human' && (
                <span className="tag tag--warn">{t('seatCpu')}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
