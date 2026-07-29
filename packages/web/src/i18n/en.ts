/** English messages. This object's shape is the contract every locale must meet. */
export const en = {
  appName: 'Korikori',
  tagline: 'Race to the far side. Wall off everyone else.',

  // --- connection ---
  connOffline: 'Not connected',
  connWaking: 'Waking the server',
  connWakingHint: 'The server sleeps when idle. This can take up to 40 seconds.',
  connConnecting: 'Connecting',
  connOnline: 'Connected',
  connReconnecting: 'Reconnecting',
  connRetryIn: 'Retrying in {seconds}s',
  connRetryNow: 'Retry now',

  // --- home ---
  homeVsCpu: 'Play against the CPU',
  homeVsCpuHint: 'Start straight away, no code needed',
  homeHost: 'Create a room',
  homeHostHint: 'Get a 6-digit code to share',
  homeJoin: 'Join a room',
  homeJoinHint: 'Enter a friend’s 6-digit code',
  homeHowTo: 'How to play',
  homeWatch: 'Watch a game',
  homeWatchHint: 'Enter a 6-digit code, no name needed',
  homeBack: 'Back',

  // --- setup ---
  setupTitle: 'New game',
  setupPlayers: 'Players',
  setupPlayers2: '2 players',
  setupPlayers3: '3 players',
  setupPlayers4: '4 players',
  setupPlayers3Note: '3-player mode is a house rule, not part of the classic game.',
  setupLevel: 'CPU level',
  setupLevelEasy: 'Easy',
  setupLevelNormal: 'Normal',
  setupLevelHard: 'Hard',
  setupFillCpu: 'Fill empty seats with CPU',
  setupFillCpuHint: 'Otherwise the game waits for every seat to be taken.',
  setupYourName: 'Your name',
  setupNamePlaceholder: 'Player',
  setupCreate: 'Create room',
  setupStartLocal: 'Start',
  setupWalls: '{count} walls each',
  setupHumans: 'Human players',
  setupHumansHint: 'The rest of the seats are played by the CPU.',

  // --- join ---
  joinTitle: 'Join a room',
  joinCode: 'Room code',
  joinCodeHint: '6 digits',
  joinAction: 'Join',

  // --- watch ---
  watchTitle: 'Watch a game',
  watchAction: 'Watch',
  watchWaiting: 'Waiting for the game to start…',

  // --- lobby ---
  lobbyTitle: 'Waiting room',
  lobbyCode: 'Room code',
  lobbyShareHint: 'Share this code so friends can join.',
  lobbyCopy: 'Copy',
  lobbyCopied: 'Copied',
  lobbyShare: 'Share',
  lobbyStart: 'Start game',
  lobbyWaitingHost: 'Waiting for the host to start…',
  lobbyNeedPlayers: 'Waiting for {count} more player(s)…',
  lobbyLeave: 'Leave room',
  lobbySeatEmpty: 'Open seat',
  lobbyYou: 'You',
  lobbyHost: 'Host',

  // --- game ---
  gameYourTurn: 'Your turn',
  gameTurnOf: '{name}’s turn',
  gameThinking: '{name} is thinking…',
  gameModeMove: 'Move',
  gameModeWall: 'Wall',
  gameRotate: 'Rotate',
  gameRotateHint: 'Press R to rotate',
  gameWallsLeft: '{count} left',
  gameNoWalls: 'No walls left',
  gameMoveLog: 'Moves',
  gameMoveLogEmpty: 'No moves yet.',
  gameResign: 'Resign',
  gameResignConfirm: 'Resign this game?',
  gameResignBody: 'Resigning takes you out of this game. It cannot be undone.',
  gameResignHintTurn: 'You can only resign on your own turn.',
  gameResignHintWalls: 'You can resign once your walls are gone ({count} left).',
  gameLeave: 'Leave game',
  gameLeaveConfirm: 'Leave this game?',
  gameRematch: 'New game',
  gameBackHome: 'Home',
  gameWinner: '{name} wins!',
  gameYouWin: 'You win!',
  gameYouLose: '{name} wins',
  gameCpuTakeover: 'CPU is playing this seat',
  gameDisconnected: 'Disconnected',
  gameSpectating: 'Watching',
  gameUndoUnavailable: 'Undo is not available in online games.',
  gameSmartHint: 'Tap a square to move. Press and slide along a groove for a wall.',
  gameSmartHintTouch: 'Slide off the board to cancel.',
  gameConfirmPawn: 'Move to {square}',
  gameConfirmWallH: 'Flat wall at {wall} ({left} left)',
  gameConfirmWallV: 'Upright wall at {wall} ({left} left)',
  gameConfirmCancel: 'Release to cancel',
  gameFlipView: 'Rotate view',
  gameSpectatorCount: '{count} watching',
  gameStopWatching: 'Stop watching',
  gamePlayAgain: 'Play again',
  gameRematchWait: 'Waiting for the host to start the next game…',
  gameCloseResult: 'Show the board',
  gameLeaveRoom: 'Leave room',
  gameYouFinished: 'You made it! Sit back while the rest is decided.',
  gameYouResigned: 'You resigned. You can watch the rest play out.',
  gameFinishedGoal: '{name} finished {place}!',
  gameFinishedResign: '{name} resigned',
  gameWatchingRest: 'Watching until the last place is settled',

  rosterWallsLeft: 'Walls left',
  rosterFinished: 'Home',
  rosterResigned: 'Resigned',

  resultPlacings: 'Final standings',
  resultYouPlaced: 'You finished {place}',

  // --- seats ---
  seatSouth: 'South',
  seatWest: 'West',
  seatNorth: 'North',
  seatEast: 'East',
  seatCpu: 'CPU',

  // --- settings ---
  settings: 'Settings',
  settingsLanguage: 'Language',
  settingsSound: 'Sound',
  settingsSoundOn: 'On',
  settingsSoundOff: 'Off',
  settingsHaptics: 'Vibration',
  settingsControls: 'Board controls',
  settingsControlsSmart: 'Smart',
  settingsControlsClassic: 'Classic',
  settingsControlsHint:
    'Smart works out a move or a wall from where you point. Classic keeps the move/wall and orientation toggles.',
  settingsClose: 'Done',

  // --- rules ---
  rulesTitle: 'How to play',
  rulesGoal:
    'On your turn, either move your pawn one square or place a wall. You win by reaching any square on the far side.',
  rulesJump:
    'If an opponent stands next to you, you may jump over them. If a wall or another pawn blocks the square behind, you may step diagonally instead.',
  rulesWalls:
    'A wall spans two squares and may never be placed so that a player has no route left to their goal.',
  rulesWallCount:
    'Each player starts with {two} walls in a 2-player game, {three} in a 3-player game and {four} in a 4-player game.',

  // --- errors ---
  errRoomUnavailable: 'That room is not available. Check the code and try again.',
  errNotYourTurn: 'It is not your turn.',
  errIllegalMove: 'That move is not legal.',
  errVersionConflict: 'The board moved on. Showing the latest position.',
  errNotHost: 'Only the host can do that.',
  errAlreadyStarted: 'That game has already started.',
  errRateLimited: 'Too many requests. Please slow down.',
  errCapacity: 'The server is at capacity. Try again shortly.',
  errProtocolMismatch: 'The game was updated. Reload this page to continue.',
  errGeneric: 'Something went wrong.',
  errInvalidCode: 'Enter a 6-digit code.',
  errNameRequired: 'Enter a name.',
} as const;

/** Every locale must supply exactly these keys - no more, no fewer. */
export type Dictionary = Record<keyof typeof en, string>;
