import {
  BOARD_SIZE,
  cellIndex,
  inverseQuarterTurns,
  isActive,
  isGoalCell,
  legalPawnMoves,
  legalWalls,
  normalizeQuarterTurns,
  posToNotation,
  rotatePos,
  rotateWall,
  samePos,
  wallToNotation,
  type GameState,
  type Move,
  type Orientation,
  type Pos,
  type QuarterTurns,
  type Wall,
} from '@quoridor/engine';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { vibrate } from '../state/prefs.js';
import './board.css';
import {
  CELL_PCT,
  pointerTravelPct,
  posId,
  rectStyle,
  resolveBoardTarget,
  resolveTouchRelease,
  sameTarget,
  squareRect,
  STEP_PCT,
  wallHitRect,
  wallId,
  wallRect,
  type BoardTarget,
} from './geometry.js';

export type BoardMode = 'pawn' | 'wall';
export type ControlScheme = 'smart' | 'classic';

export interface BoardPreview {
  /** What would happen on release, in absolute board coordinates. */
  target: BoardTarget | null;
  /** True while a pointer is hovering or pressed on the board. */
  active: boolean;
}

export interface BoardProps {
  game: GameState;
  /** CSS colour per player index, matching the roster. */
  colors: readonly string[];
  /** The seat this client controls, or null while watching. */
  youIndex: number | null;
  /** Whether taps should do anything at all. */
  interactive: boolean;
  /** `smart` resolves pawn vs wall from where you point; `classic` uses modes. */
  control: ControlScheme;
  /** Quarter turns applied for display only, so your own home row is nearest. */
  viewRotation: number;
  mode: BoardMode;
  orientation: Orientation;
  onMove: (move: Move) => void;
  onPreview?: (preview: BoardPreview) => void;
}

interface PointerGesture {
  readonly pointerId: number;
  readonly start: { x: number; y: number };
  readonly startClient: { x: number; y: number };
  readonly boardWidth: number;
  readonly startedAt: number;
  maxDistance: number;
  cancelled: boolean;
}

const FILES = 'abcdefghi';

/** After this long an unfinished gesture is assumed lost, not still in progress. */
const STALE_GESTURE_MS = 10_000;

const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.7 } as const;
const WALL_SPRING = { type: 'spring', stiffness: 420, damping: 26, mass: 0.9 } as const;

export function Board({
  game,
  colors,
  youIndex,
  interactive,
  control,
  viewRotation,
  mode,
  orientation,
  onMove,
  onPreview,
}: BoardProps): React.JSX.Element {
  const [hovered, setHovered] = useState<Wall | null>(null);
  const [preview, setPreview] = useState<BoardTarget | null>(null);
  const previewRef = useRef<BoardTarget | null>(null);
  const draggingRef = useRef(false);
  const gestureRef = useRef<PointerGesture | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const turn = normalizeQuarterTurns(viewRotation);
  const back = inverseQuarterTurns(turn);
  const toView = useCallback((pos: Pos) => rotatePos(pos, turn), [turn]);
  const wallToView = useCallback((wall: Wall) => rotateWall(wall, turn), [turn]);

  const turnColor = colors[game.turn] ?? 'var(--blue)';
  const mover = game.players[game.turn];
  const smart = control === 'smart';

  // Classic mode filters by the current toggle; smart offers everything legal
  // and works out the intent from the pointer position instead.
  const targets = useMemo(
    () => (interactive && (smart || mode === 'pawn') ? legalPawnMoves(game) : []),
    [game, interactive, smart, mode],
  );

  // Only legal walls get a hit area, so an impossible placement is simply not
  // offered rather than tapped and rejected.
  const walls = useMemo(() => {
    if (!interactive) return [];
    if (!smart && mode !== 'wall') return [];
    if (!mover || mover.wallsLeft <= 0) return [];
    return legalWalls(game);
  }, [game, interactive, smart, mode, mover]);

  const keyboardWalls = useMemo(
    () => walls.filter((wall) => wall.o === orientation),
    [walls, orientation],
  );

  const viewTargets = useMemo(() => targets.map(toView), [targets, toView]);
  const viewWalls = useMemo(() => walls.map(wallToView), [walls, wallToView]);

  const goalCells = useMemo(() => goalHighlights(game, youIndex), [game, youIndex]);

  const publish = useCallback(
    (next: BoardTarget | null, active: boolean) => {
      previewRef.current = next;
      setPreview(next);
      onPreview?.({ target: next ? toBoard(next, back) : null, active });
    },
    [back, onPreview],
  );

  // A finished game or a turn handed over mid-drag must not leave a stale ghost.
  useEffect(() => {
    if (interactive && smart) return;
    draggingRef.current = false;
    gestureRef.current = null;
    if (previewRef.current !== null) publish(null, false);
  }, [interactive, smart, publish]);

  const pointOf = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    };
  };

  const track = (event: React.PointerEvent<HTMLDivElement>): BoardTarget | null => {
    const point = pointOf(event);
    const next = point
      ? resolveBoardTarget(point, {
          targets: viewTargets,
          walls: viewWalls,
          previous: previewRef.current,
        })
      : null;
    if (!sameTarget(next, previewRef.current)) {
      if (next) vibrate(8);
      publish(next, true);
    }
    return next;
  };

  const updateGesture = (event: React.PointerEvent<HTMLDivElement>): PointerGesture | null => {
    const gesture = gestureRef.current;
    if (!gesture) return null;
    gesture.maxDistance = Math.max(
      gesture.maxDistance,
      pointerTravelPct(
        gesture.startClient,
        { x: event.clientX, y: event.clientY },
        gesture.boardWidth,
      ),
    );
    return gesture;
  };

  const commit = (target: BoardTarget | null): void => {
    if (!target) {
      publish(null, false);
      return;
    }
    vibrate(18);
    const board = toBoard(target, back);
    publish(null, false);
    onMove(
      board.kind === 'pawn'
        ? { type: 'pawn', to: board.pos }
        : { type: 'wall', wall: board.wall },
    );
  };

  const smartHandlers = smart && interactive
    ? {
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          const active = gestureRef.current;
          if (active !== null) {
            // A lost pointerup (an OS gesture stealing the touch, say) would
            // otherwise wedge the board for the rest of the turn.
            if (event.timeStamp - active.startedAt > STALE_GESTURE_MS) {
              gestureRef.current = null;
              draggingRef.current = false;
            } else {
              active.cancelled = true;
              publish(null, false);
              return;
            }
          }
          event.preventDefault();
          const point = pointOf(event);
          const rect = surfaceRef.current?.getBoundingClientRect();
          if (!point || !rect || rect.width <= 0) return;
          draggingRef.current = true;
          gestureRef.current = {
            pointerId: event.pointerId,
            start: point,
            startClient: { x: event.clientX, y: event.clientY },
            boardWidth: rect.width,
            startedAt: event.timeStamp,
            maxDistance: 0,
            cancelled: false,
          };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Capture is an optimisation; dragging still works without it.
          }
          track(event);
        },
        onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
          if (!draggingRef.current && event.pointerType !== 'mouse') return;
          if (draggingRef.current && gestureRef.current?.pointerId !== event.pointerId) return;
          if (draggingRef.current) {
            const gesture = updateGesture(event);
            if (gesture?.cancelled) return;
          }
          track(event);
        },
        onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
          if (!draggingRef.current) return;
          if (gestureRef.current?.pointerId !== event.pointerId) return;
          draggingRef.current = false;
          const point = pointOf(event);
          const gesture = point ? updateGesture(event) : null;
          const target = gesture?.cancelled
            ? null
            : event.pointerType === 'mouse'
            ? track(event)
            : point && gesture
              ? resolveTouchRelease(point, {
                  targets: viewTargets,
                  walls: viewWalls,
                  previous: previewRef.current,
                  tapPoint: gesture.start,
                  movementPct: gesture.maxDistance,
                  elapsedMs: Math.max(0, event.timeStamp - gesture.startedAt),
                })
              : null;
          gestureRef.current = null;
          commit(target);
        },
        onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
          if (gestureRef.current?.pointerId !== event.pointerId) return;
          draggingRef.current = false;
          gestureRef.current = null;
          publish(null, false);
        },
        onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'mouse' && !draggingRef.current) publish(null, false);
        },
      }
    : {};

  const previewWall =
    smart && preview?.kind === 'wall'
      ? preview.wall
      : hovered
        ? wallToView(hovered)
        : null;
  const previewPawn = smart && preview?.kind === 'pawn' ? preview.pos : null;
  const ruler = rulerLabels(turn);

  return (
    <div className="board-frame">
      <div className="board">
        <div className="board__layer board__layer--walls">
          {keyboardWalls.map((wall) => {
            const view = wallToView(wall);
            return (
              <button
                key={wallId(wall)}
                type="button"
                className={smart ? 'wall-hit wall-hit--inert' : 'wall-hit'}
                style={{ ...rectStyle(wallHitRect(view)), ['--seat-color' as string]: turnColor }}
                aria-label={wallToNotation(wall)}
                onPointerEnter={smart ? undefined : () => setHovered(wall)}
                onPointerLeave={
                  smart
                    ? undefined
                    : () => setHovered((current) => (current === wall ? null : current))
                }
                onFocus={() => setHovered(wall)}
                onBlur={() => setHovered((current) => (current === wall ? null : current))}
                onClick={() => {
                  setHovered(null);
                  onMove({ type: 'wall', wall });
                }}
              />
            );
          })}
        </div>

        <div className="board__layer board__layer--squares">
          {allSquares().map((pos) => {
            const goal = goalCells.get(posId(pos));
            const target = targets.some((t) => samePos(t, pos));
            const previewed = previewPawn !== null && samePos(previewPawn, toView(pos));
            const classes = ['square'];
            if (goal) classes.push('square--goal');
            if (goal?.mine) classes.push('square--goal-mine');
            if (target) classes.push('square--target');
            if (previewed) classes.push('square--preview');
            const style: React.CSSProperties = {
              ...rectStyle(squareRect(toView(pos))),
              ...(goal
                ? {
                    ['--goal-color' as string]: goal.colors[0] ?? 'var(--label)',
                    ['--goal-color-2' as string]:
                      goal.colors[1] ?? goal.colors[0] ?? 'var(--label)',
                  }
                : {}),
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

        {smart && (
          <div
            ref={surfaceRef}
            className={`board__layer board__layer--resolver${interactive ? ' board__layer--live' : ''}`}
            {...smartHandlers}
          />
        )}

        <div className="board__layer board__layer--placed">
          <AnimatePresence initial={false}>
            {game.walls.map((wall) => {
              const rect = wallRect(wallToView(wall));
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

          {previewWall && (
            <div
              className="wall wall--preview"
              style={{ ...rectStyle(wallRect(previewWall)), ['--seat-color' as string]: turnColor }}
            />
          )}
        </div>

        <div className="board__layer board__layer--pawns">
          <AnimatePresence initial={false}>
            {game.players.map((player, index) => {
              // Finishing or giving up takes your pawn off the board.
              if (!isActive(game, index)) return null;
              const rect = squareRect(toView(player.pos));
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
                    scale: 1,
                    opacity: 1,
                  }}
                  exit={{ scale: 0.2, opacity: 0 }}
                  transition={SPRING}
                >
                  {index + 1}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      <div className="board-frame__files" aria-hidden="true">
        {ruler.bottom.map((label, c) => (
          <span
            key={c}
            className="board-frame__tick"
            style={{ left: `${c * STEP_PCT}%`, width: `${CELL_PCT}%`, top: 0, bottom: 0 }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className="board-frame__ranks" aria-hidden="true">
        {ruler.side.map((label, r) => (
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
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Converts a view-space target back into absolute board coordinates. */
function toBoard(target: BoardTarget, back: QuarterTurns): BoardTarget {
  return target.kind === 'pawn'
    ? { kind: 'pawn', pos: rotatePos(target.pos, back) }
    : { kind: 'wall', wall: rotateWall(target.wall, back) };
}

/**
 * Ruler text stays in absolute notation so it still matches the move log; only
 * which axis carries files and which carries ranks changes with the rotation.
 */
function rulerLabels(turn: QuarterTurns): { bottom: string[]; side: string[] } {
  const n = BOARD_SIZE - 1;
  const axis = (index: number, isBottom: boolean): string => {
    switch (turn) {
      case 1:
        return isBottom ? String(n - index + 1) : (FILES[index] ?? '');
      case 2:
        return isBottom ? (FILES[n - index] ?? '') : String(n - index + 1);
      case 3:
        return isBottom ? String(index + 1) : (FILES[n - index] ?? '');
      default:
        return isBottom ? (FILES[index] ?? '') : String(index + 1);
    }
  };
  return {
    bottom: Array.from({ length: BOARD_SIZE }, (_, i) => axis(i, true)),
    side: Array.from({ length: BOARD_SIZE }, (_, i) => axis(i, false)),
  };
}

function allSquares(): Pos[] {
  const out: Pos[] = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) out.push({ c, r });
  }
  return out;
}

/**
 * Tints each finish line in the colour of whoever is still running to it, with
 * your own picked out more strongly. Corner squares belong to two goals at
 * once, so they carry both colours.
 */
interface GoalTint {
  readonly colors: string[];
  readonly mine: boolean;
}

function goalHighlights(game: GameState, youIndex: number | null): Map<string, GoalTint> {
  const out = new Map<string, GoalTint>();
  game.players.forEach((player, index) => {
    // A finish line nobody is running to any more is just noise.
    if (!isActive(game, index)) return;
    const color = `var(--seat-${index})`;
    const mine = index === youIndex;
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        if (!isGoalCell(player.goal, cellIndex(c, r))) continue;
        const key = posId({ c, r });
        const existing = out.get(key);
        if (!existing) {
          out.set(key, { colors: [color], mine });
          continue;
        }
        // Your own colour leads, so the ring always points at your own line.
        out.set(key, {
          colors: mine ? [color, ...existing.colors] : [...existing.colors, color],
          mine: existing.mine || mine,
        });
      }
    }
  });
  return out;
}
