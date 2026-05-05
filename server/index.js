/**
 * Sequence Game Server - FINAL UPDATED VERSION
 * Express + Socket.IO — handles all rooms and real-time events.
 */

const express = require('express');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const ngrok = require('@ngrok/ngrok');

// Public tunnel URL
let publicUrl = null;

/**
 * Network Utilities
 */
function getAllLocalIPs() {
  const interfaces = os.networkInterfaces();
  const results = [];
  const virtualNames = ['vmware', 'virtualbox', 'hyper-v', 'vethernet', 'vbox', 'vmnet', 'docker', 'virtual', 'loopback', 'pseudo'];
  const virtualRanges = [/^192\.168\.56\./, /^192\.168\.99\./, /^172\.1[6-9]\./, /^172\.2\d\./, /^172\.3[01]\./, /^10\.0\.75\./];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const iface of addrs) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const nameIsVirtual = virtualNames.some(k => name.toLowerCase().includes(k));
        const ipIsVirtual = virtualRanges.some(r => r.test(iface.address));
        const isVirtual = nameIsVirtual || ipIsVirtual;
        results.push({ ip: iface.address, name, isVirtual });
      }
    }
  }
  results.sort((a, b) => Number(a.isVirtual) - Number(b.isVirtual));
  return results;
}

function getLocalIP() {
  const all = getAllLocalIPs();
  return all.length > 0 ? all[0].ip : 'localhost';
}

const {
  createRoom, getRoom, joinRoom, handleDisconnect,
  setPlayerTeam, updateSettings, startGame,
  addChat, addGameLog, getPublicRoomState, rooms
} = require('./gameState');

const { validateCardPlay, checkAndUpdateSequences, checkWinCondition, getNextTurnIndex, isDeadCard } = require('./gameLogic');
const { drawCard } = require('./deckManager');
const { isOneEyedJack, isTwoEyedJack } = require('./boardLayout');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  // Keep connections alive longer to survive mobile OS app-switching
  // and browser tab backgrounding.
  pingTimeout: 60000,   // wait 60 s for a pong before considering dead
  pingInterval: 25000,  // send a ping every 25 s
  // Allow a generous upgrade window for slow mobile networks
  connectTimeout: 45000
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

app.post('/api/create-room', (req, res) => {
  const { playerName } = req.body;
  if (!playerName || playerName.trim().length === 0) return res.status(400).json({ error: 'Player name required' });
  const tempId = uuidv4();
  res.json({ roomId: tempId, playerName: playerName.trim() });
});

app.get('/api/room/:id', (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ id: room.id, status: room.status, playerCount: room.players.size, settings: room.settings });
});

app.get('/api/server-info', (req, res) => {
  res.json({ 
    localIP: getLocalIP(), 
    port: PORT, 
    publicUrl,
    isProd: process.env.NODE_ENV === 'production'
  });
});

app.get('/lobby/:id', (req, res) => { res.sendFile(path.join(__dirname, '../public/lobby.html')); });
app.get('/game/:id', (req, res) => { res.sendFile(path.join(__dirname, '../public/game.html')); });

// --- FEEDBACK API ROUTE ---
app.post('/api/feedback', (req, res) => {
    const { name, email, message } = req.body;
    if (!name || !email || !message) return res.status(400).json({ error: 'Name, Email and Message are required!' });

    const newFeedback = { id: uuidv4(), name, email, message, date: new Date().toISOString() };
    const dataDir = path.join(__dirname, '../data');
    const filePath = path.join(dataDir, 'feedback.json');

    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        let feedbackData = [];
        if (fs.existsSync(filePath)) feedbackData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        feedbackData.push(newFeedback);
        fs.writeFileSync(filePath, JSON.stringify(feedbackData, null, 2));
        res.status(200).json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save feedback' });
    }
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

// Helper: send each player their own individualized state.
// NEVER use io.to(roomId).emit() with a single shared state — that gives
// every player the same myHand (the requesting socket's hand).
function broadcastRoomState(room) {
  for (const [pid] of room.players) {
    const s = io.sockets.sockets.get(pid);
    if (s) s.emit('game-state-update', getPublicRoomState(room, pid));
  }
}

const socketRoomMap = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── Join or Create Room ──
  socket.on('join-room', ({ roomId, playerName }) => {
    if (!playerName || !roomId) return;
    playerName = playerName.trim().slice(0, 24);

    let room = getRoom(roomId);
    let rejoined = false;

    if (!room) {
      // Room does not exist — create it (host flow)
      room = createRoom(socket.id, playerName);
      room.id = roomId;
      rooms.set(roomId, room);
    } else {
      // Room exists — try to join or rejoin
      const result = joinRoom(roomId, socket.id, playerName);
      if (result.error) return socket.emit('error', { message: result.error });
      room = result.room;
      rejoined = result.rejoined || false;
    }

    socket.join(roomId);
    socketRoomMap.set(socket.id, roomId);

    if (rejoined) {
      const stateForReconnect = getPublicRoomState(room, socket.id);
      // Debug: confirm hand is being sent correctly
      console.log(`[Reconnect] ${playerName} rejoined — hand: ${stateForReconnect.myHand?.length ?? 0} cards [${(stateForReconnect.myHand || []).slice(0,3).join(', ')}...]`);
      socket.emit('reconnected', stateForReconnect);
    }

    // Send individualized state to EVERY player in the room.
    // IMPORTANT: we must NOT use io.to(roomId).emit() with a single shared
    // state object — that would give every player the reconnecting player's
    // myHand instead of their own. Each player must get their own state.
    for (const [pid] of room.players) {
      const s = io.sockets.sockets.get(pid);
      if (s) s.emit('game-state-update', getPublicRoomState(room, pid));
    }
  });

  // ════════ BOT MANAGEMENT (Yeh Server ko Bot banana sikhayega) ════════
  socket.on('add-bot', ({ team }) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return; // Sirf Host bot add kar sakta hai

    // Check karein ke team full toh nahi (Max 2 players)
    const teamPlayers = Array.from(room.players.values()).filter(p => p.team === team);
    if (teamPlayers.length >= 2) {
      return socket.emit('error', { message: 'This team is full!' });
    }

    const botCount = Array.from(room.players.values()).filter(p => p.isBot).length;
    const botNames = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta'];
    const botId = 'bot_' + Math.random().toString(36).substr(2, 9); // Naya unique Bot ID

    // Bot ko room mein shamil karein
    room.players.set(botId, {
      id: botId,
      name: botNames[botCount % 4], // Alpha, Beta automatically rotate honge
      team: team,
      hand: [],
      isHost: false,
      isConnected: true,
      isBot: true // Yeh tag zaroori hai
    });

    // Sabko update bhej dein
    broadcastRoomState(room);
  });

  socket.on('remove-bot', ({ botId }) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room || room.hostId !== socket.id) return;

    if (room.players.has(botId) && room.players.get(botId).isBot) {
      room.players.delete(botId);
      broadcastRoomState(room);
    }
  });
  // ════════ END BOT MANAGEMENT ════════

  socket.on('set-team', ({ team }) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room) return;

    // 2-Player Restriction: Opposite teams mandatory
    const playersInRequestedTeam = [...room.players.values()].filter(p => p.team === team);
    if (room.players.size <= 2 && playersInRequestedTeam.length > 0) {
      return socket.emit('error', { message: 'Opposite teams required for 2 players!' });
    }

    const result = setPlayerTeam(roomId, socket.id, team);
    if (!result.error) {
      broadcastRoomState(room);
    }
  });

  socket.on('update-settings', (settings) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room) return;
    const result = updateSettings(roomId, socket.id, settings);
    if (result.error) return socket.emit('error', { message: result.error });
    // Broadcast updated settings to all players so their selects sync
    broadcastRoomState(room);
  });

  socket.on('send-chat', ({ message }) => {
    const roomId = socketRoomMap.get(socket.id);
    if (!roomId || !message.trim()) return;
    const entry = addChat(roomId, socket.id, message.trim());
    if (entry) io.to(roomId).emit('chat-message', entry);
  });

  socket.on('start-game', () => {
    const roomId = socketRoomMap.get(socket.id);
    const result = startGame(roomId, socket.id);
    if (result.error) return socket.emit('error', { message: result.error });

    const room = result.room;
    for (const [pid] of room.players) {
      const s = io.sockets.sockets.get(pid);
      if (s) s.emit('game-started', getPublicRoomState(room, pid));
    }
    startTurnTimer(room);
  });

  // Dead-card discard: discard ONE dead card, draw replacement, still keep your turn.
  socket.on('discard-dead-card', ({ cardIndex }) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room || room.status !== 'playing') return;

    const playerId = socket.id;
    if (room.turnOrder[room.currentTurnIndex] !== playerId) {
      return socket.emit('invalid-move', { reason: 'Not your turn' });
    }

    const player = room.players.get(playerId);
    if (!player) return;
    const safeIndex = parseInt(cardIndex, 10);
    if (isNaN(safeIndex) || safeIndex < 0 || safeIndex >= player.hand.length) {
      return socket.emit('invalid-move', { reason: 'Invalid card index' });
    }

    if (room.deadDiscardUsedThisTurn) {
      return socket.emit('invalid-move', { reason: 'Only 1 dead-card discard per turn' });
    }

    const card = player.hand[safeIndex];
    if (!card) return;
    if (!isDeadCard(room, card)) {
      return socket.emit('invalid-move', { reason: 'That card is not dead' });
    }

    // Discard + draw replacement (if possible), but DO NOT advance turn.
    player.hand.splice(safeIndex, 1);
    room.discardPile.push(card);

    const { card: newCard, remainingDeck } = drawCard(room.deck);
    if (newCard) {
      player.hand.push(newCard);
      room.deck = remainingDeck;
    } else {
      room.deck = remainingDeck;
    }

    room.deadDiscardUsedThisTurn = true;

    // Broadcast individualized states
    broadcastRoomState(room);
  });

  socket.on('play-card', ({ cardIndex, cellId }) => {
    const roomId = socketRoomMap.get(socket.id);
    const room = getRoom(roomId);
    if (!room || room.status !== 'playing') return;

    // Coerce to integers — Socket.IO payloads can occasionally deliver numbers
    // as strings, which would make room.board[cellId] === undefined.
    const safeCardIndex = parseInt(cardIndex, 10);
    const safeCellId    = parseInt(cellId, 10);
    if (isNaN(safeCardIndex) || isNaN(safeCellId)) return;

    const player = room.players.get(socket.id);
    const validation = validateCardPlay(room, socket.id, safeCardIndex, safeCellId);
    if (!validation.valid) return socket.emit('invalid-move', { reason: validation.reason });

    const card = player.hand[safeCardIndex];
    const cell = room.board[safeCellId];

    if (validation.isRemove) {
        cell.chip = null; cell.inSequence = false;
    } else {
        cell.chip = player.team;
    }

    player.hand.splice(safeCardIndex, 1);
    room.discardPile.push(card);

    const { card: newCard, remainingDeck } = drawCard(room.deck);
    if (newCard) { player.hand.push(newCard); room.deck = remainingDeck; }

    // Reset per-turn dead-card allowance after a completed move.
    room.deadDiscardUsedThisTurn = false;

    const { totals, newlyFormed } = validation.isRemove
      ? { totals: room.sequences, newlyFormed: { red: 0, blue: 0, green: 0 } }
      : checkAndUpdateSequences(room, safeCellId, player.team);
    room.sequences = totals;
    clearTurnTimer(room);

    // Broadcast sequence-completed events for every NEW sequence formed this move
    for (const team of ['red', 'blue', 'green']) {
      if (newlyFormed[team] > 0) {
        const totalNow = totals[team];
        // Emit one event per newly-formed sequence with its ordinal
        for (let n = 0; n < newlyFormed[team]; n++) {
          const ordinal = totalNow - newlyFormed[team] + 1 + n;
          io.to(roomId).emit('sequence-completed', { team, count: ordinal });
        }
      }
    }

    const winner = checkWinCondition(room);
    if (winner) {
      room.status = 'ended';
      io.to(roomId).emit('game-over', { winner: winner.winner });
    } else {
      room.currentTurnIndex = getNextTurnIndex(room);
      room.turnStartTime = Date.now();
      startTurnTimer(room);
    }

    for (const [pid] of room.players) {
      const s = io.sockets.sockets.get(pid);
      if (s) s.emit('game-state-update', getPublicRoomState(room, pid));
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} — reason: ${reason}`);
    const roomId = socketRoomMap.get(socket.id);
    socketRoomMap.delete(socket.id);
    if (!roomId) return;
    const result = handleDisconnect(roomId, socket.id);
    // Broadcast so other players see the "disconnected" status immediately
    if (result) broadcastRoomState(result.room);
  });
});

function startTurnTimer(room) {
  if (!room.settings.turnTimer || room.settings.turnTimer === 0) return;
  clearTurnTimer(room);
  room.currentTimerHandle = setTimeout(() => {
    const timedOutPlayerId = room.turnOrder[room.currentTurnIndex] || null;
    io.to(room.id).emit('turn-timeout', { playerId: timedOutPlayerId });

    // Timer expiration handling:
    // If no setting is present, default to "skip" (safe + matches current UI).
    const action = room.settings.timerAction || 'skip'; // 'skip' | 'auto-play'

    // Reset per-turn dead-card allowance on forced progression.
    room.deadDiscardUsedThisTurn = false;

    if (action === 'auto-play' && timedOutPlayerId && room.players.has(timedOutPlayerId)) {
      const p = room.players.get(timedOutPlayerId);
      const team = p?.team;

      // Build all legal (cardIndex, cellId) pairs.
      const moves = [];
      if (p && team) {
        for (let i = 0; i < p.hand.length; i++) {
          const code = p.hand[i];
          if (isTwoEyedJack(code)) {
            for (const cell of room.board) {
              if (!cell.isWild && cell.chip === null) moves.push({ cardIndex: i, cellId: cell.id });
            }
          } else if (isOneEyedJack(code)) {
            for (const cell of room.board) {
              if (!cell.isWild && cell.chip && cell.chip !== team && !cell.inSequence) moves.push({ cardIndex: i, cellId: cell.id, isRemove: true });
            }
          } else {
            for (const cell of room.board) {
              if (!cell.isWild && cell.card === code && cell.chip === null) moves.push({ cardIndex: i, cellId: cell.id });
            }
          }
        }
      }

      if (moves.length > 0) {
        const choice = moves[Math.floor(Math.random() * moves.length)];
        const card = p.hand[choice.cardIndex];
        const cell = room.board[choice.cellId];

        if (choice.isRemove) {
          cell.chip = null;
          cell.inSequence = false;
        } else {
          cell.chip = team;
        }

        p.hand.splice(choice.cardIndex, 1);
        room.discardPile.push(card);

        const { card: newCard, remainingDeck } = drawCard(room.deck);
        if (newCard) { p.hand.push(newCard); room.deck = remainingDeck; }

        if (!choice.isRemove) {
          const { totals } = checkAndUpdateSequences(room, choice.cellId, team);
          room.sequences = totals;
        }

        const winner = checkWinCondition(room);
        if (winner) {
          room.status = 'ended';
          io.to(room.id).emit('game-over', { winner: winner.winner });
          broadcastRoomState(room);
          return;
        }
      }
    }

    // If auto-play couldn't act (no moves), fall back to skipping.
    room.currentTurnIndex = getNextTurnIndex(room);
    room.turnStartTime = Date.now();
    broadcastRoomState(room);
    startTurnTimer(room);
  }, room.settings.turnTimer * 1000);
}

function clearTurnTimer(room) { if (room.currentTimerHandle) clearTimeout(room.currentTimerHandle); }

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🎯 Server running on http://localhost:${PORT}`);
  
  // Only try to start ngrok if we are NOT running in production (like on Render)
  if (process.env.NODE_ENV !== 'production') {
    try {
      const options = { addr: PORT };
      
      // The ngrok Node API doesn't auto-read the CLI config file, so we read it manually.
      let token = process.env.NGROK_AUTHTOKEN;
      if (!token) {
        const ngrokConfigPath = path.join(os.homedir(), 'AppData', 'Local', 'ngrok', 'ngrok.yml');
        if (fs.existsSync(ngrokConfigPath)) {
          const configContent = fs.readFileSync(ngrokConfigPath, 'utf8');
          const match = configContent.match(/authtoken:\s*([^\s]+)/);
          if (match && match[1]) token = match[1];
        }
      }

      if (token) {
        options.authtoken = token;
      }
      
      const listener = await ngrok.forward(options);
      publicUrl = listener.url();
      console.log(`🌍 Public Backup Tunnel Live: ${publicUrl}`);
      console.log(`Share this link to play with friends over the internet right now!\n`);
    } catch (err) { 
      console.log(`⚠️ Ngrok Tunnel Error: ${err.message}`); 
      console.log(`If it asks for an authtoken, run: npx ngrok config add-authtoken <your_token>`);
    }
  } else {
    console.log(`🚀 Running in Production Mode. Public tunnel skipped.`);
  }
});