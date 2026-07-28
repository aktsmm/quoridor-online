/** English messages. This object's shape is the contract every locale must meet. */
export const en = {
  appName: 'Quoridor',
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
  homeBack: 'Back',

  // --- setup ---
  setupTitle: 'New game',
  setupPlayers: 'Players',
  setupPlayers2: '2 players',
  setupPlayers3: '3 players',
  setupPlayers4: '4 players',
  setupPlayers3Note: '3-player Quoridor is a house rule, not part of the official game.',
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
  gameResign: 'Leave game',
  gameResignConfirm: 'Leave this game?',
  gameRematch: 'New game',
  gameBackHome: 'Home',
  gameWinner: '{name} wins!',
  gameYouWin: 'You win!',
  gameYouLose: '{name} wins',
  gameCpuTakeover: 'CPU is playing this seat',
  gameDisconnected: 'Disconnected',
  gameSpectating: 'Watching',
  gameUndoUnavailable: 'Undo is not available in online games.',

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
  errGeneric: 'Something went wrong.',
  errInvalidCode: 'Enter a 6-digit code.',
  errNameRequired: 'Enter a name.',
} as const;

/** Every locale must supply exactly these keys - no more, no fewer. */
export type Dictionary = Record<keyof typeof en, string>;
