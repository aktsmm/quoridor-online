import {
  BOARD_SIZE,
  cellIndex,
  isGoalCell,
  legalPawnMoves,
  legalWalls,
  posToNotation,
  samePos,
  type GameState,
  type Move,
  type Orientation,
  type Pos,
  type Wall,
} from '@quoridor/engine';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import './board.css';
import {
  CELL_PCT,
  posId,
  rectStyle,
  squareRect,
  STEP_PCT,
  wallHitRect,
  wallId,
  wallRect,
} from './geometry.js';

export type BoardMode = 'pawn' | 'wall';

export interface BoardProps {
  game: GameState;
  /** CSS colour per player index, matching the roster. */
  colors: readonly string[];
  /** The seat this client controls, or null while watching. */
  youIndex: number | null;
  /** Whether taps should do anything at all. */
  interactive: boolean;
  mode: BoardMode;
  orientation: Orientation;
  onMove: (move: Move) => void;
  labels: { file: string; rank: string }[] | null;
}

const FILES = 'abcdefghi';

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;
const WALL_SPRING = { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as const;

export function Board({
  game,
  colors,
  youIndex,
  interactive,
  mode,
  orientation,
  onMove,
}: BoardProps): React.JSX.Element {
  const [hovered, setHovered] = useState<Wall | null>(null);

  const turnColor = colors[game.turn] ?? 'var(--blue)';
  const mover = game.players[game.turn];

  const targets = useMemo(
    () => (interactive && mode === 'pawn' ? legalPawnMoves(game) : []),
    [game, interactive, mode],
  );

  // Only legal walls get a hit area, so an impossible placement is simply not
  // offered rather than tapped and rejected.
  const wallSlots = useMemo(() => {
    if (!interactive || mode !== 'wall') return [];
    if (!mover || mover.wallsLeft <= 0) return [];
    return legalWalls(game).filter((wall) => wall.o === orientation);
  }, [game, interactive, mode, orientation, mover]);

  const goalCells = useMemo(() => goalHighlights(game, youIndex), [game, youIndex]);

  return (
    <div className="board-frame">
      <div className="board">
        <div className="board__layer board__layer--walls">
          {wallSlots.map((wall) => (
            <button
              key={wallId(wall)}
              type="button"
              className="wall-hit"
              style={{ ...rectStyle(wallHitRect(wall)), ['--seat-color' as string]: turnColor }}
              aria-label={`${FILES[wall.c]}${wall.r + 1}${wall.o}`}
              onPointerEnter={() => setHovered(wall)}
              onPointerLeave={() => setHovered((current) => (current === wall ? null : current))}
              onFocus={() => setHovered(wall)}
              onBlur={() => setHovered((current) => (current === wall ? null : current))}
              onClick={() => {
                setHovered(null);
                onMove({ type: 'wall', wall });
              }}
            />
          ))}
        </div>

        <div className="board__layer board__layer--squares">
          {allSquares().map((pos) => {
            const goal = goalCells.get(posId(pos));
            const target = targets.some((t) => samePos(t, pos));
            const classes = ['square'];
            if (goal) classes.push('square--goal');
            if (target) classes.push('square--target');
            const style: React.CSSProperties = {
              ...rectStyle(squareRect(pos)),
              ...(goal ? { ['--goal-color' as string]: goal } : {}),
              ...(target ? { ['--seat-color' as string]: turnColor } : {}),
            };
            return target ? (
              <button
                key={posId(pos)}
                type="button"
                className={classes.join(' ')}
                style={style}
                aria-label={posToNotation(pos)}
                onClick={() => onMove({ type: 'pawn', to: pos })}
              />
            ) : (
              <div key={posId(pos)} className={classes.join(' ')} style={style} aria-hidden="true" />
            );
          })}
        </div>

        <div className="board__layer board__layer--placed">
          <AnimatePresence initial={false}>
            {game.walls.map((wall) => {
              const rect = wallRect(wall);
              return (
                <motion.div
                  key={wallId(wall)}
                  className="wall"
                  style={{
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    ['--wall-color' as string]: 'var(--wall-face)',
                  }}
                  initial={{ scale: 0.25, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.25, opacity: 0 }}
                  transition={WALL_SPRING}
                />
              );
            })}
          </AnimatePresence>

          {hovered && (
            <div
              className="wall wall--preview"
              style={{ ...rectStyle(wallRect(hovered)), ['--seat-color' as string]: turnColor }}
            />
          )}
        </div>

        <div className="board__layer board__layer--pawns">
          {game.players.map((player, index) => {
            const rect = squareRect(player.pos);
            const classes = ['pawn'];
            if (index === game.turn) classes.push('pawn--active');
            if (index === youIndex) classes.push('pawn--you');
            return (
              <motion.div
                key={index}
                className={classes.join(' ')}
                style={{
                  width: `${CELL_PCT * 0.74}%`,
                  height: `${CELL_PCT * 0.74}%`,
                  ['--seat-color' as string]: colors[index] ?? 'var(--blue)',
                }}
                initial={false}
                animate={{
                  left: `${rect.left + CELL_PCT * 0.13}%`,
                  top: `${rect.top + CELL_PCT * 0.13}%`,
                }}
                transition={SPRING}
              >
                {index + 1}
              </motion.div>
            );
          })}
        </div>
      </div>

      <div className="board-frame__files" aria-hidden="true">
        {Array.from({ length: BOARD_SIZE }, (_, c) => (
          <span
            key={c}
            className="board-frame__tick"
            style={{ left: `${c * STEP_PCT}%`, width: `${CELL_PCT}%`, top: 0, bottom: 0 }}
          >
            {FILES[c]}
          </span>
        ))}
      </div>
      <div className="board-frame__ranks" aria-hidden="true">
        {Array.from({ length: BOARD_SIZE }, (_, r) => (
          <span
            key={r}
            className="board-frame__tick"
            style={{
              top: `${(BOARD_SIZE - 1 - r) * STEP_PCT}%`,
              height: `${CELL_PCT}%`,
              left: 0,
              right: 0,
            }}
          >
            {r + 1}
          </span>
        ))}
      </div>
    </div>
  );
}

function allSquares(): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) out.push({ c, r });
  }
  return out;
}

/**
 * Tints the finish line so a new player can see where they are running to.
 * Only your own goal is marked - four tinted edges would just be noise.
 */
function goalHighlights(game: GameState, youIndex: number | null): Map<string, string> {
  const out = new Map<string, string>();
  const index = youIndex ?? game.turn;
  const player = game.players[index];
  if (!player) return out;
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (isGoalCell(player.goal, cellIndex(c, r))) out.set(posId({ c, r }), `var(--seat-${index})`);
    }
  }
  return out;
}
