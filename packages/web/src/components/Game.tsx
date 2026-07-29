import {
  applyMove,
  canResign,
  defaultWallsPerPlayer,
  finalPlacings,
  isActive,
  isGameOver,
  moverAtPly,
  posToNotation,
  seatQuarterTurns,
  wallToNotation,
  winnerOf,
  type GameState,
  type Move,
  type Orientation,
} from '@quoridor/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Board, type BoardMode, type BoardPreview } from '../board/Board.js';
import { useI18n, type Lang, type Translate } from '../i18n/index.js';
import type { RoomView } from '../net/protocol.js';
import { play, resume } from '../sound.js';
import { useControlScheme } from '../state/prefs.js';
import type { FinishNotice } from '../state/store.js';
import { displayName, ordinal, seatColors } from './shared.js';
import { Roster } from './Lobby.js';

interface Props {
  room: RoomView;
  youIndex: number | null;
  /** Watchers see everything and touch nothing. */
  spectating: boolean;
  /** Held back while an optimistic move is still unconfirmed. */
  frozen: boolean;
  /** Someone reached home or gave up; shown as a passing banner. */
  notice: FinishNotice | null;
  onMove: (move: Move, nextRoom: RoomView) => void;
  onLeave: () => void;
  onRematch: () => void;
  onResign: () => void;
  onDismissNotice: () => void;
}

/** How long a "someone finished" banner stays up before it fades itself out. */
const NOTICE_MS = 6_000;

export function Game({
  room,
  youIndex,
  spectating,
  frozen,
  notice,
  onMove,
  onLeave,
  onRematch,
  onResign,
  onDismissNotice,
}: Props): React.JSX.Element {
  const { t, lang } = useI18n();
  const control = useControlScheme();
  const [mode, setMode] = useState<BoardMode>('pawn');
  const [orientation, setOrientation] = useState<Orientation>('h');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmResign, setConfirmResign] = useState(false);
  const [preview, setPreview] = useState<BoardPreview>({ target: null, active: false });
  // Extra quarter turns on top of the seat's own, for watchers and for anyone
  // who simply prefers a different angle.
  const [flip, setFlip] = useState(0);
  const [resultOpen, setResultOpen] = useState(room.status === 'finished');
  const previousStatusRef = useRef(room.status);

  const game = room.game;
  const smart = control === 'smart';
  const colors = useMemo(() => seatColors(room.seats.length), [room.seats.length]);
  const finished = room.status === 'finished' || (game !== null && isGameOver(game));
  // Reaching home or giving up takes you out, but the room plays on until only
  // one runner is left, so the board stays live for everybody else.
  const youAreOut = game !== null && youIndex !== null && !isActive(game, youIndex);
  const yourTurn =
    !finished && !frozen && !spectating && youIndex !== null && game?.turn === youIndex;
  const mover = game ? game.players[game.turn] : undefined;
  const wallsLeft = mover?.wallsLeft ?? 0;
  const isHost = youIndex !== null && room.hostSeat === youIndex;
  const canGiveUp = game !== null && youIndex !== null && !spectating && canResign(game, youIndex);

  // Your own home row belongs at the bottom no matter which seat you drew.
  const seat = youIndex === null ? undefined : room.seats[youIndex];
  const viewRotation = (seat ? seatQuarterTurns(seat.seat) : 0) + flip;

  // Dropping back to pawn mode when the turn ends avoids a stale wall overlay
  // sitting over the board while an opponent thinks.
  useEffect(() => {
    if (!yourTurn) setMode('pawn');
  }, [yourTurn]);

  useEffect(() => {
    if (yourTurn && wallsLeft === 0) setMode('pawn');
  }, [yourTurn, wallsLeft]);

  // Open once on the transition to a result. Spectator-count broadcasts also
  // bump gameVersion, but must not reopen a result the player already dismissed.
  useEffect(() => {
    const previous = previousStatusRef.current;
    if (room.status === 'finished' && previous !== 'finished') setResultOpen(true);
    if (room.status !== 'finished' && previous === 'finished') setResultOpen(false);
    previousStatusRef.current = room.status;
  }, [room.status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'r' || event.key === 'R') {
        setOrientation((o) => (o === 'h' ? 'v' : 'h'));
      } else if (!smart && (event.key === 'w' || event.key === 'W')) {
        if (wallsLeft > 0) setMode((m) => (m === 'wall' ? 'pawn' : 'wall'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [smart, wallsLeft]);

  const lastLogged = room.moveLog.length;
  useEffect(() => {
    if (lastLogged === 0) return;
    const last = room.moveLog[lastLogged - 1] ?? '';
    play(last.length > 2 ? 'wall' : 'move');
  }, [lastLogged, room.moveLog]);

  useEffect(() => {
    if (finished) play('win');
  }, [finished]);

  // The banner is informational, so it clears itself rather than asking for a tap.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(onDismissNotice, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismissNotice]);

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

  const handlePreview = useCallback((next: BoardPreview) => setPreview(next), []);

  if (!game) {
    return <p className="form__note">{t('errGeneric')}</p>;
  }

  const turnName = displayName(room, game.turn, youIndex, t);
  const turnSeatIsCpu =
    room.seats[game.turn]?.kind === 'cpu' || room.seats[game.turn]?.connection === 'cpu-controlled';
  const champion = winnerOf(game);

  // Read-out sits above the board so a thumb never covers the one thing that
  // says what is about to happen - walls cannot be taken back.
  const readout = !smart || !preview.active
    ? ''
    : preview.target === null
      ? t('gameConfirmCancel')
      : preview.target.kind === 'pawn'
        ? t('gameConfirmPawn', { square: posToNotation(preview.target.pos) })
        : t('gameConfirmWall', { wall: wallToNotation(preview.target.wall) });

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
              ? champion === youIndex
                ? t('gameYouWin')
                : t('gameWinner', { name: displayName(room, champion ?? 0, youIndex, t) })
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

        {notice && !finished && (
          <p
            className="banner banner--notice"
            style={{ ['--seat-color' as string]: colors[notice.player] ?? 'var(--blue)' }}
            aria-live="polite"
            role="status"
          >
            {noticeText(game, notice, room, youIndex, lang, t)}
          </p>
        )}

        {youAreOut && !finished && (
          <p className="banner" aria-live="polite">
            {youResigned(game, youIndex) ? t('gameYouResigned') : t('gameYouFinished')}
          </p>
        )}

        {smart && !spectating && (
          <p
            className={`readout${readout ? ' readout--active' : ''}`}
            aria-live="polite"
            role="status"
          >
            {readout || (yourTurn ? t('gameSmartHint') : '\u00a0')}
          </p>
        )}

        <Board
          game={game}
          colors={colors}
          youIndex={youIndex}
          interactive={yourTurn}
          control={control}
          viewRotation={viewRotation}
          mode={mode}
          orientation={orientation}
          onMove={handleMove}
          onPreview={handlePreview}
        />

        <div className="controls">
          {spectating ? null : smart ? (
            <p className="form__note" style={{ flex: 1, margin: 0 }}>
              {t('gameSmartHintTouch')}
            </p>
          ) : (
            <>
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
            </>
          )}
          <button
            type="button"
            className="btn"
            title={t('gameFlipView')}
            aria-label={t('gameFlipView')}
            onClick={() => setFlip((k) => (k + 1) % 4)}
          >
            ⟲
          </button>
        </div>
      </div>

      <aside className="game__side">
        {(spectating || room.spectators > 0) && (
          <p className="form__note" style={{ margin: 0 }}>
            {spectating && `${t('gameSpectating')} · `}
            {t('gameSpectatorCount', { count: room.spectators })}
          </p>
        )}
        <Roster room={room} youIndex={youIndex} />
        <MoveLog room={room} colors={colors} />
        {finished && !spectating && isHost && (
          <button type="button" className="btn btn--primary btn--wide" onClick={onRematch}>
            {t('gamePlayAgain')}
          </button>
        )}
        {!spectating && !finished && !youAreOut && (
          <button
            type="button"
            className="btn btn--wide"
            disabled={!canGiveUp}
            title={resignHint(game, youIndex, t)}
            onClick={() => setConfirmResign(true)}
          >
            {t('gameResign')}
          </button>
        )}
        {!spectating && !finished && !youAreOut && !canGiveUp && (
          <p className="form__note" style={{ margin: 0 }}>
            {resignHint(game, youIndex, t)}
          </p>
        )}
        <button
          type="button"
          className="btn btn--danger btn--wide"
          onClick={() => (spectating || finished ? onLeave() : setConfirmLeave(true))}
        >
          {spectating ? t('gameStopWatching') : finished ? t('gameLeaveRoom') : t('gameLeave')}
        </button>
      </aside>

      {finished && resultOpen && (
        <ResultSheet
          room={room}
          youIndex={youIndex}
          spectating={spectating}
          isHost={isHost}
          onRematch={onRematch}
          onClose={() => setResultOpen(false)}
          onLeave={onLeave}
        />
      )}

      {confirmResign && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <h2 className="sheet__title">{t('gameResignConfirm')}</h2>
            <p className="form__note">{t('gameResignBody')}</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn"
                style={{ flex: 1 }}
                onClick={() => setConfirmResign(false)}
              >
                {t('homeBack')}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfirmResign(false);
                  onResign();
                }}
              >
                {t('gameResign')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmLeave && (
        <div className="sheet-backdrop" role="dialog" aria-modal="true">
          <div className="sheet">
            <h2 className="sheet__title">{t('gameLeaveConfirm')}</h2>
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
                {t('gameLeave')}
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

/** Explains why the resign button is greyed out, so it never looks broken. */
function resignHint(game: GameState, youIndex: number | null, t: Translate): string {
  if (youIndex === null) return '';
  if (game.turn !== youIndex) return t('gameResignHintTurn');
  const left = game.players[youIndex]?.wallsLeft ?? 0;
  return left > 0 ? t('gameResignHintWalls', { count: left }) : '';
}

function youResigned(game: GameState, youIndex: number | null): boolean {
  return game.completions.some((c) => c.player === youIndex && c.kind === 'resign');
}

/**
 * A goal announcement carries the place that is already locked in; a resignation
 * does not, because who ends up below the quitter is still being decided.
 */
function noticeText(
  game: GameState,
  notice: FinishNotice,
  room: RoomView,
  youIndex: number | null,
  lang: Lang,
  t: Translate,
): string {
  const name = displayName(room, notice.player, youIndex, t);
  if (notice.reason === 'resign') return t('gameFinishedResign', { name });
  const place = game.completions.filter((c) => c.kind === 'goal').findIndex(
    (c) => c.player === notice.player,
  );
  return t('gameFinishedGoal', { name, place: ordinal(Math.max(place, 0) + 1, lang) });
}

function MoveLog({ room, colors }: { room: RoomView; colors: readonly string[] }): React.JSX.Element {
  const { t } = useI18n();
  const game = room.game;
  return (
    <div className="move-log">
      <h3 className="move-log__title">{t('gameMoveLog')}</h3>
      {room.moveLog.length === 0 || !game ? (
        <p className="move-log__empty">{t('gameMoveLogEmpty')}</p>
      ) : (
        <ol className="move-log__list">
          {room.moveLog.map((entry, index) => (
            <li key={index} className="move-log__item">
              <span className="move-log__ply">{index + 1}</span>
              <span
                className="move-log__move"
                style={{ ['--seat-color' as string]: colors[moverAtPly(game, index)] ?? 'var(--label)' }}
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

/**
 * The table stays together between games, so this sheet offers a rematch first
 * and only leaves the room when that is what the player actually asked for.
 */
function ResultSheet({
  room,
  youIndex,
  spectating,
  isHost,
  onRematch,
  onClose,
  onLeave,
}: {
  room: RoomView;
  youIndex: number | null;
  spectating: boolean;
  isHost: boolean;
  onRematch: () => void;
  onClose: () => void;
  onLeave: () => void;
}): React.JSX.Element {
  const { t, lang } = useI18n();
  const game = room.game;
  const placings = game ? finalPlacings(game) : [];
  const winner = placings[0] ?? 0;
  const youWon = winner === youIndex;
  const yourPlace = youIndex === null ? -1 : placings.indexOf(youIndex);
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet result">
        <div className="result__medal" aria-hidden="true">
          {youWon && !spectating ? '🏆' : '🎌'}
        </div>
        <h2 className="result__title">
          {youWon && !spectating
            ? t('gameYouWin')
            : t('gameWinner', { name: displayName(room, winner, youIndex, t) })}
        </h2>
        {!spectating && yourPlace > 0 && (
          <p className="form__note">
            {t('resultYouPlaced', { place: ordinal(yourPlace + 1, lang) })}
          </p>
        )}
        {placings.length > 2 && (
          <>
            <h3 className="result__subtitle">{t('resultPlacings')}</h3>
            <ol className="placings">
              {placings.map((player, index) => (
                <li
                  key={player}
                  className={`placings__row${player === youIndex ? ' placings__row--you' : ''}`}
                  style={{ ['--seat-color' as string]: `var(--seat-${player})` }}
                >
                  <span className="placings__place">{ordinal(index + 1, lang)}</span>
                  <span className="placings__name">
                    {displayName(room, player, youIndex, t)}
                  </span>
                  {game?.completions.some((c) => c.player === player && c.kind === 'resign') && (
                    <span className="tag tag--warn">{t('rosterResigned')}</span>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
        {!spectating && isHost && (
          <button type="button" className="btn btn--primary btn--wide" onClick={onRematch}>
            {t('gamePlayAgain')}
          </button>
        )}
        {!spectating && !isHost && <p className="form__note">{t('gameRematchWait')}</p>}
        <button type="button" className="btn btn--wide" onClick={onClose}>
          {t('gameCloseResult')}
        </button>
        <button type="button" className="btn btn--danger btn--wide" onClick={onLeave}>
          {spectating ? t('gameStopWatching') : t('gameLeaveRoom')}
        </button>
      </div>
    </div>
  );
}
