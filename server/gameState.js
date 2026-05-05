/**
 * Game State Manager
 * In-memory room management for all active Sequence games.
 * All rooms are stored in the `rooms` Map.
 */

const { v4: uuidv4 } = require('uuid');
const { createFreshBoard } = require('./boardLayout');
const { createDeck, dealCards, drawCard, getHandSize } = require('./deckManager');

const rooms = new Map(); // roomId -> room object

const RECONNECT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes to reconnect (handles mobile OS app-switching)

/**
 * Create a new game room.
 */
function createRoom(hostSocketId, hostName) {
  const roomId = uuidv4();
  const room = {
    id: roomId,
    hostId: hostSocketId,
    status: 'lobby', // 'lobby' | 'playing' | 'ended'
    players: new Map(), // socketId -> playerData
    disconnectedPlayers: new Map(), // socketId -> { playerData, timeoutHandle }
    settings: {
      winCondition: 'two-sequences', // 'first-sequence' | 'two-sequences' | 'play-all-cards'
      turnTimer: 0 // 0=no limit, 15, 30, 60, 90, 120 (seconds)
    },
    board: createFreshBoard(),
    deck: [],
    discardPile: [],
    turnOrder: [],
    currentTurnIndex: 0,
    sequences: { red: 0, blue: 0, green: 0 },
    chat: [],
    currentTimerHandle: null,
    turnStartTime: null,
    gameLog: [],
    // Per-turn meta (applies to the CURRENT player only)
    deadDiscardUsedThisTurn: false
  };

  // Add host as first player (no team assigned yet)
  room.players.set(hostSocketId, {
    id: hostSocketId,
    name: hostName,
    team: null,
    hand: [],
    isHost: true,
    isConnected: true
  });

  rooms.set(roomId, room);
  return room;
}

/**
 * Get a room by ID.
 */
function getRoom(roomId) {
  return rooms.get(roomId) || null;
}

/**
 * Add a player to an existing room.
 */
function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status === 'ended') return { error: 'Game has ended' };

  // Idempotency guard: if this exact socket is already a live player in the
  // room (e.g. a double join-room emit on the same connection), just refresh
  // their connected flag and return. NEVER overwrite the existing entry — this
  // protects the host's isHost flag from being clobbered by a second join-room.
  if (room.players.has(socketId)) {
    const existing = room.players.get(socketId);
    existing.isConnected = true;
    room.disconnectedPlayers.delete(socketId); // clear any pending timeout
    return { room, rejoined: true, playerData: existing };
  }

  // Check if a disconnected player with same name is rejoining
  for (const [oldId, { playerData, timeoutHandle }] of room.disconnectedPlayers) {
    if (playerData.name === playerName) {
      clearTimeout(timeoutHandle);
      room.disconnectedPlayers.delete(oldId);
      room.players.delete(oldId); // ← FIX: remove old socket entry to prevent duplicates
      const updatedPlayer = { ...playerData, id: socketId, isConnected: true };
      room.players.set(socketId, updatedPlayer);
      // Update turn order
      const idx = room.turnOrder.indexOf(oldId);
      if (idx !== -1) room.turnOrder[idx] = socketId;
      // Update host if needed
      if (room.hostId === oldId) room.hostId = socketId;
      return { room, rejoined: true, playerData: updatedPlayer };
    }
  }

  // If the game is playing, also check still-connected players by name.
  // This handles the race condition where the lobby socket hasn't disconnected
  // yet by the time game.js opens a new socket and emits join-room.
  if (room.status === 'playing') {
    for (const [oldId, playerData] of room.players) {
      if (playerData.name === playerName && oldId !== socketId) {
        // Handoff this player slot to the new socket
        room.players.delete(oldId);
        const updatedPlayer = { ...playerData, id: socketId, isConnected: true };
        room.players.set(socketId, updatedPlayer);
        const idx = room.turnOrder.indexOf(oldId);
        if (idx !== -1) room.turnOrder[idx] = socketId;
        if (room.hostId === oldId) room.hostId = socketId;
        return { room, rejoined: true, playerData: updatedPlayer };
      }
    }
    return { error: 'Game already in progress' };
  }

  // Check max players (6 total — 2 per team × 3 teams)
  if (room.players.size >= 6) return { error: 'Room is full (max 6 players)' };

  room.players.set(socketId, {
    id: socketId,
    name: playerName,
    team: null,
    hand: [],
    isHost: false,
    isConnected: true
  });

  return { room };
}

/**
 * Remove a player from a room (or mark as disconnected with reconnect timer).
 */
function handleDisconnect(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const player = room.players.get(socketId);
  if (!player) return null;

  // Both lobby AND playing: hold the slot for RECONNECT_TIMEOUT_MS.
  // This prevents a tab-switch or mobile OS app-switch from permanently
  // removing the player before they can reconnect.
  player.isConnected = false;
  room.players.set(socketId, player);

  const timeoutHandle = setTimeout(() => {
    removePlayerFromRoom(room, socketId);

    // If lobby becomes empty, clean it up
    if (room.status !== 'playing' && room.players.size === 0) {
      rooms.delete(roomId);
      return;
    }

    // Transfer host if the host timed out in lobby
    if (room.status !== 'playing' && room.hostId === socketId && room.players.size > 0) {
      const newHost = [...room.players.values()].find(p => p.isConnected);
      if (newHost) { newHost.isHost = true; room.hostId = newHost.id; }
    }
  }, RECONNECT_TIMEOUT_MS);

  room.disconnectedPlayers.set(socketId, { playerData: player, timeoutHandle });
  return { room, disconnected: true };
}

function removePlayerFromRoom(room, socketId) {
  room.players.delete(socketId);
  room.disconnectedPlayers.delete(socketId);
  const idx = room.turnOrder.indexOf(socketId);
  if (idx !== -1) room.turnOrder.splice(idx, 1);
}

/**
 * Set a player's team.
 */
function setPlayerTeam(roomId, socketId, team) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'lobby') return { error: 'Cannot change team during game' };

  const validTeams = ['red', 'blue', 'green', null];
  if (!validTeams.includes(team)) return { error: 'Invalid team' };

  // Check team size limit (max 2)
  if (team !== null) {
    let teamCount = 0;
    for (const [pid, p] of room.players) {
      if (pid !== socketId && p.team === team) teamCount++;
    }
    if (teamCount >= 2) return { error: `Team ${team} is full (max 2 players)` };
  }

  const player = room.players.get(socketId);
  if (!player) return { error: 'Player not found' };
  player.team = team;

  return { room };
}

/**
 * Update game settings (host only).
 */
function updateSettings(roomId, socketId, settings) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.hostId !== socketId) return { error: 'Only the host can change settings' };
  if (room.status !== 'lobby') return { error: 'Cannot change settings during game' };

  const validWinConditions = ['first-sequence', 'two-sequences', 'play-all-cards'];
  const validTimers = [0, 15, 30, 60, 90, 120];

  if (settings.winCondition && validWinConditions.includes(settings.winCondition)) {
    room.settings.winCondition = settings.winCondition;
  }
  if (settings.turnTimer !== undefined && validTimers.includes(settings.turnTimer)) {
    room.settings.turnTimer = settings.turnTimer;
  }

  return { room };
}

/**
 * Start the game — deal cards, set turn order.
 */
function startGame(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.hostId !== socketId) return { error: 'Only the host can start the game' };
  if (room.status !== 'lobby') return { error: 'Game already started' };

  // Must have players with teams
  const playersWithTeams = [...room.players.values()].filter(p => p.team !== null);
  if (playersWithTeams.length < 2) return { error: 'Need at least 2 players in teams to start' };

  // Create deck and deal hands
  let deck = createDeck();
  const handSize = getHandSize(playersWithTeams.length);

  for (const player of playersWithTeams) {
    const { hand, remainingDeck } = dealCards(deck, handSize);
    player.hand = hand;
    deck = remainingDeck;
  }

  room.deck = deck;
  room.board = createFreshBoard();
  room.sequences = { red: 0, blue: 0, green: 0 };
  room.discardPile = [];
  room.gameLog = [];

  // Turn order: only players with teams, cycling by team
  // Sort by team (red, blue, green) then by join order
  const teamOrder = ['red', 'blue', 'green'];
  room.turnOrder = playersWithTeams
    .sort((a, b) => teamOrder.indexOf(a.team) - teamOrder.indexOf(b.team))
    .map(p => p.id);

  room.currentTurnIndex = 0;
  room.status = 'playing';
  room.turnStartTime = Date.now();

  return { room };
}

/**
 * Add a chat message.
 */
function addChat(roomId, socketId, message) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const player = room.players.get(socketId);
  if (!player) return null;

  const entry = {
    id: uuidv4(),
    playerId: socketId,
    playerName: player.name,
    team: player.team,
    message: message.slice(0, 200), // max 200 chars
    timestamp: Date.now()
  };
  room.chat.push(entry);
  if (room.chat.length > 100) room.chat.shift(); // keep last 100 messages

  return entry;
}

/**
 * Add a game log entry.
 */
function addGameLog(room, message) {
  const entry = { message, timestamp: Date.now() };
  room.gameLog.push(entry);
  if (room.gameLog.length > 50) room.gameLog.shift();
  return entry;
}

/**
 * Get public room state (safe to send to all clients).
 * Excludes other players' hands.
 */
function getPublicRoomState(room, requestingSocketId) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({
      id,
      name: p.name,
      team: p.team,
      isHost: p.isHost,
      isConnected: p.isConnected,
      handCount: p.hand.length // Don't reveal hand to others
    });
  }

  const requester = room.players.get(requestingSocketId);

  return {
    id: room.id,
    status: room.status,
    hostId: room.hostId,
    players,
    settings: room.settings,
    board: room.board,
    deckCount: room.deck.length,
    sequences: room.sequences,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    currentPlayerId: room.turnOrder[room.currentTurnIndex] || null,
    chat: room.chat.slice(-30),
    gameLog: room.gameLog.slice(-20),
    turnStartTime: room.turnStartTime,
    // Include requester's own hand
    myHand: requester ? requester.hand : [],
    // Last card played (top of discard pile) — used by client for accurate log messages
    lastPlayedCard: room.discardPile.length ? room.discardPile[room.discardPile.length - 1] : null
  };
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  joinRoom,
  handleDisconnect,
  setPlayerTeam,
  updateSettings,
  startGame,
  addChat,
  addGameLog,
  getPublicRoomState,
  removePlayerFromRoom
};