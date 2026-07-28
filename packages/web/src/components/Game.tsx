import { applyMove, defaultWallsPerPlayer, type Move, type Orientation } from '@quoridor/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Board, type BoardMode } from '../board/Board.js';
import { useI18n } from '../i18n/index.js';
import type { RoomView } from '../net/protocol.js';
import { play, resume } from '../sound.js';
import { displayName, seatColors } from './shared.js';
import { Roster } from './Lobby.js';

interface Props {
  room: RoomView;
  youIndex: number | null;
  /** Held back while an optimistic move is still unconfirmed. */
  frozen: boolean;
  onMove: (move: Move, nextRoom: RoomView) => void;
  onLeave: () => void;
  onHome: () => void;
}

export function Game({ room, youIndex, frozen, onMove, onLeave, onHome }: Props): React.JSX.Element {
  const { t } = useI18n();
  const [mode, setMode] = useState<BoardMode>('pawn');
  const [orientation, setOrientation] = useState<Orientation>('h');
  const [confirmLeave, setConfirmLeave] = useState(false);

  const game = room.game;
  const colors = useMemo(() => seatColors(room.seats.length), [room.seats.length]);
  const finished = room.status === 'finished' || game?.winner !== null;
  const yourTurn = !finished && !frozen && youIndex !== null && game?.turn === youIndex;
  const mover = game ? game.players[game.turn] : undefined;
  const wallsLeft = mover?.wallsLeft ?? 0;

  // Dropping back to pawn mode when the turn ends avoids a stale wall overlay
  // sitting over the board while an opponent thinks.
  useEffect(() => {
    if (!yourTurn) setMode('pawn');
  }, [yourTurn]);

  useEffect(() => {
    if (yourTurn && wallsLeft === 0) setMode('pawn');
  }, [yourTurn, wallsLeft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'r' || event.key === 'R') {
        setOrientation((o) => (o === 'h' ? 'v' : 'h'));
      } else if (event.key === 'w' || event.key === 'W') {
        if (wallsLeft > 0) setMode((m) => (m === 'wall' ? 'pawn' : 'wall'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [wallsLeft]);

  const lastLogged = room.moveLog.length;
  useEffect(() => {
    if (lastLogged === 0) return;
    const last = room.moveLog[lastLogged - 1] ?? '';
    play(last.length > 2 ? 'wall' : 'move');
  }, [lastLogged, room.moveLog]);

  useEffect(() => {
    if (finished) play('win');
  }, [finished]);

  const handleMove = useCallback(
    (move: Move) => {
      if (!game || !yourTurn) return;
      void resume();
      // Advance the local board immediately; the store rolls this back if the
      // server disagrees. Waiting for a round trip makes the board feel dead.
      const next = applyMove(game, move);
      onMove(move, { ...room, game: next, gameVersion: room.gameVersion + 1 });
      setMode('pawn');
    },
    [game, onMove, room, yourTurn],
  );

  if (!game) {
    return <p className="form__note">{t('errGeneric')}</p>;
  }

  const turnName = displayName(room, game.turn, youIndex, t);
  const turnSeatIsCpu =
    room.seats[game.turn]?.kind === 'cpu' || room.seats[game.turn]?.connection === 'cpu-controlled';

  return (
    <div className="game">
      <div className="game__board-area">
        <div className="turn-bar">
          <span
            className="turn-bar__dot"
            style={{ ['--seat-color' as string]: colors[game.turn] ?? 'var(--blue)' }}
          />
          <span className="turn-bar__text">
            {finished
              ? game.winner === youIndex
                ? t('gameYouWin')
                : t('gameWinner', { name: displayName(room, game.winner ?? 0, youIndex, t) })
              : yourTurn
                ? t('gameYourTurn')
                : turnSeatIsCpu
                  ? t('gameThinking', { name: turnName })
                  : t('gameTurnOf', { name: turnName })}
          </span>
          <span className="turn-bar__walls">
            <WallPips
              left={wallsLeft}
              total={defaultWallsPerPlayer(room.playerCount)}
              color={colors[game.turn] ?? 'var(--blue)'}
            />
          </span>
        </div>

        <Board
          game={game}
          colors={colors}
          youIndex={youIndex}
          interactive={yourTurn}
          mode={mode}
          orientation={orientation}
          onMove={handleMove}
          labels={null}
        />

        <div className="controls">
          <div className="segmented">
            <button
              type="button"
              className="segmented__item"
              aria-pressed={mode === 'pawn'}
              disabled={!yourTurn}
              onClick={() => setMode('pawn')}
            >
              {t('gameModeMove')}
            </button>
            <button
              type="button"
              className="segmented__item"
              aria-pressed={mode === 'wall'}
              disabled={!yourTurn || wallsLeft === 0}
              onClick={() => setMode('wall')}
            >
              {wallsLeft === 0 ? t('gameNoWalls') : `${t('gameModeWall')} · ${wallsLeft}`}
            </button>
          </div>
          <button
            type="button"
            className="btn"
            disabled={mode !== 'wall'}
            title={t('gameRotateHint')}
            onClick={() => setOrientation((o) => (o === 'h' ? 'v' : 'h'))}
          >
            {orientation === 'h' ? '⇔' : '⇕'}
          </button>
        </div>
      </div>

      <aside className="game__side">
        <Roster room={room} youIndex={youIndex} />
        <MoveLog room={room} colors={colors} />
        {finished ? (
          <button type="button" className="btn btn--primary btn--wide" onClick={onHome}>
            {t('gameRematch')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger btn--wide"
            onClick={() => setConfirmLeave(true)}
          >
            {t('gameResign')}
          </button>
        )}
      </aside>

      {finished && <ResultSheet room={room} youIndex={youIndex} onClose={onHome} />}

      {confirmLeave && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <h2 className="sheet__title">{t('gameResignConfirm')}</h2>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                style={{ flex: 1 }}
                onClick={() => setConfirmLeave(false)}
              >
                {t('homeBack')}
              </button>
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfirmLeave(false);
                  onLeave();
                }}
              >
                {t('gameResign')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WallPips({
  left,
  total,
  color,
}: {
  left: number;
  total: number;
  color: string;
}): React.JSX.Element {
  return (
    <span className="wall-pips" aria-label={String(left)}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`wall-pip${i < left ? '' : ' wall-pip--spent'}`}
          style={{ ['--seat-color' as string]: color }}
        />
      ))}
    </span>
  );
}

function MoveLog({ room, colors }: { room: RoomView; colors: readonly string[] }): React.JSX.Element {
  const { t } = useI18n();
  const seats = room.seats.length || 2;
  return (
    <div className="move-log">
      <h3 className="move-log__title">{t('gameMoveLog')}</h3>
      {room.moveLog.length === 0 ? (
        <p className="move-log__empty">{t('gameMoveLogEmpty')}</p>
      ) : (
        <ol className="move-log__list">
          {room.moveLog.map((entry, index) => (
            <li key={index} className="move-log__item">
              <span className="move-log__ply">{index + 1}</span>
              <span
                className="move-log__move"
                style={{ ['--seat-color' as string]: colors[index % seats] ?? 'var(--label)' }}
              >
                {entry}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ResultSheet({
  room,
  youIndex,
  onClose,
}: {
  room: RoomView;
  youIndex: number | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const winner = room.game?.winner ?? 0;
  const youWon = winner === youIndex;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet result">
        <div className="result__medal" aria-hidden="true">
          {youWon ? '🏆' : '🎌'}
        </div>
        <h2 className="result__title">
          {youWon ? t('gameYouWin') : t('gameWinner', { name: displayName(room, winner, youIndex, t) })}
        </h2>
        <button type="button" className="btn btn--primary btn--wide" onClick={onClose}>
          {t('gameRematch')}
        </button>
      </div>
    </div>
  );
}
