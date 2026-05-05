/**
 * Game screen - Sequence Logic Updated
 */

let state = null;
let previousState = null; // Turn logic track karne ke liye
let myId = null;
let selectedCardIndex = null;
let timerHandle = null;
let lastLogLen = 0;
let justReconnected = false;

const session = loadSession('seq_player');
const roomId = getRoomIdFromURL();
const myName = session?.name || 'Guest';

if (!session || !roomId) {
  showToast('Session expired. Redirecting...', 'error');
  setTimeout(() => (window.location.href = '/'), 900);
}

const socket = io({
  // Reconnect automatically, forever, with exponential back-off capped at 5 s.
  // This covers: tab hidden, mobile app-switch, brief network blip.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// ── Reconnect banner helpers ─────────────────────────────────────────────────
function showReconnectBanner() {
  let banner = document.getElementById('reconnect-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'reconnect-banner';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0',
      background: 'rgba(220,80,30,0.95)', color: '#fff',
      textAlign: 'center', padding: '10px 16px',
      fontWeight: '600', fontSize: '0.95rem',
      zIndex: '99999', letterSpacing: '0.3px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.4)'
    });
    banner.textContent = '🔄 Connection lost — reconnecting…';
    document.body.appendChild(banner);
  }
  banner.style.display = 'block';
}
function hideReconnectBanner() {
  const banner = document.getElementById('reconnect-banner');
  if (banner) banner.style.display = 'none';
}
// ─────────────────────────────────────────────────────────────────────────────

socket.on('connect', () => {
  myId = socket.id;
  hideReconnectBanner();
  socket.emit('join-room', { roomId, playerName: myName, isHost: false });
});

socket.on('error', (e) => showToast(e?.message || 'Server error', 'error'));
socket.on('disconnect', () => showReconnectBanner());
socket.on('reconnect_attempt', () => showReconnectBanner());

// 'reconnected' fires when the server confirms a successful name-matched rejoin.
socket.on('reconnected', (s) => {
  hideReconnectBanner();
  justReconnected = true;
  showToast('Reconnected!', 'info', 2000);
  applyState(s, { clearSelection: true, skipLog: true });
});

socket.on('game-state-update', (s) => {
  // Skip log diff on the first update after reconnect or initial load.
  const skip = justReconnected || !previousState;
  justReconnected = false;
  // clearSelection: true — always reset the selected card after a completed move.
  applyState(s, { clearSelection: true, skipLog: skip });
});

socket.on('room-state', (s) => {
  if (s?.status === 'lobby') {
    window.location.href = '/lobby/' + roomId;
    return;
  }
  applyState(s, { clearSelection: false });
});

socket.on('game-started', (s) => applyState(s, { clearSelection: true, resetFeed: true, skipLog: true }));

socket.on('invalid-move', ({ reason }) => showToast(reason || 'Invalid move', 'error', 1800));

// ════════ SEQUENCE & GAME OVER LOGS ════════
socket.on('sequence-completed', ({ team, count }) => {
  const ordinals = { 1: '1st', 2: '2nd', 3: '3rd' };
  const ordinal = ordinals[count] || `${count}th`;
  const isMe = myTeam() === team;
  const teamLabel = team.toUpperCase();
  const msg = isMe
    ? `🎉 You (${teamLabel}) formed your ${ordinal} sequence!`
    : `⚡ ${teamLabel} TEAM formed their ${ordinal} sequence!`;
  appendFeed(msg, 'system');
  showToast(msg, isMe ? 'info' : 'error', count >= 2 ? 4000 : 2800);
});

socket.on('game-over', ({ winner }) => {
  showGameOver(winner);
  if (winner === 'draw') {
    appendFeed(`🤝 The game ended in a draw!`, 'system');
  } else {
    appendFeed(`🏆 ${winner.toUpperCase()} TEAM WINS THE GAME!`, 'system');
  }
});
// ═══════════════════════════════════════════

socket.on('turn-timeout', ({ playerId }) => {
  if (playerId === myId) showToast("⏰ Time's up!", 'error', 2000);
  stopTimer();
});

// ════════ CHAT MESSAGE & ANIMATIONS ════════
const quickEmojis = ["😂", "🔥", "😱", "😡", "🎉", "😏"];

function spawnFloatingReaction(msg, senderName, isMe) {
  // Desktop: chat panel is always visible — no overlay needed.
  const isMobile = window.innerWidth <= 600;
  if (!isMobile) return;

  // Own messages: user already sees their message in the chat feed instantly.
  // Only animate incoming messages from other players.
  if (isMe) return;

  let container = document.getElementById('reaction-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'reaction-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');

  if (quickEmojis.includes(msg.trim())) {
    el.className = 'floating-emoji';
    el.textContent = msg;
    el.style.left = `${Math.random() * 70 + 15}%`;
  } else {
    el.className = 'floating-text';
    el.textContent = `${senderName}: ${msg}`;
  }

  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

socket.on('chat-message', (entry) => {
  appendChat(entry);
  const isMe = entry?.playerName === myName;
  spawnFloatingReaction(entry.message, entry.playerName, isMe);
});
// ═══════════════════════════════════════════

socket.on('player-disconnected', ({ playerName }) => appendFeed(`⚠️ ${playerName || 'Player'} disconnected`, 'system'));

// ════════ CARD NAMING HELPER ════════
function getReadableCardName(code) {
  if (!code) return 'a card';
  if (code === 'wild' || code.length > 3) return 'a Corner Space';
  const suits = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const ranks = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack' };
  const suit = code.slice(-1).toUpperCase();
  const rank = code.slice(0, -1).toUpperCase();

  if (rank === 'J') {
    if (suit === 'S' || suit === 'H') return `One-Eyed Jack`;
    if (suit === 'D' || suit === 'C') return `Two-Eyed Jack`;
  }
  return `${ranks[rank] || rank} of ${suits[suit]}`;
}

function applyState(next, opts = {}) {
  // Resolve myId: prefer socket.id match, fall back to name match.
  const socketIdMatch = next?.players?.find(p => p.id === socket.id);
  const nameMatch = next?.players?.find(p => p.name === myName);
  myId = socketIdMatch ? socket.id : (nameMatch ? nameMatch.id : socket.id);

  // ════════ AUTO MOVE LOGGING LOGIC ════════
  if (!opts.skipLog && previousState && previousState.board && next && next.board) {
    const lastPlayerId = previousState.currentPlayerId;
    const isMe = lastPlayerId === myId;
    const lastPlayer = previousState.players?.find(p => p.id === lastPlayerId);
    const pName = isMe ? "You" : (lastPlayer ? lastPlayer.name : "A player");
    const lastCard = next.lastPlayedCard || null;  // top of discard pile after the move
    const isTwoEyed = lastCard === 'JD' || lastCard === 'JC';
    const isOneEyed = lastCard === 'JS' || lastCard === 'JH';

    next.board.forEach((cell, i) => {
      const oldCell = previousState.board[i];
      if (cell.chip && !oldCell.chip) {
        // Chip placed — determine which card type was used
        if (isTwoEyed) {
          const posName = cell.isWild ? 'a Corner Space' : getReadableCardName(cell.card);
          appendFeed(`🃏 ${pName}: used a Two-Eyed Jack to place a chip on ${posName}.`, 'system');
        } else {
          const cardName = getReadableCardName(cell.card);
          appendFeed(`▶ ${pName}: placed a chip on ${cardName}.`, 'system');
        }
      } else if (!cell.chip && oldCell.chip) {
        // Chip removed — always a One-Eyed Jack
        const cardName = cell.isWild ? 'a Corner Space' : getReadableCardName(cell.card);
        appendFeed(`✂️ ${pName}: used a One-Eyed Jack to remove a chip from ${cardName}.`, 'system');
      }
    });
  }
  // ═════════════════════════════════════════

  // Update previousState BEFORE rendering so that the game-state-update
  // broadcast that immediately follows a 'reconnected' event produces no
  // board diff (both states are identical at that point).
  previousState = JSON.parse(JSON.stringify(next));
  state = next;

  if (opts.clearSelection) selectedCardIndex = null;

  if (opts.resetFeed) {
    lastLogLen = 0;
    const feed = $('unified-feed');
    if (feed) feed.innerHTML = '';
    const mobFeed = $('mob-unified-feed');
    if (mobFeed) mobFeed.innerHTML = '';
  }

  renderScores();
  renderHand();
  renderBoard();
  renderLog();
  renderTimer();
}

function isMyTurn() { return state?.currentPlayerId && state.currentPlayerId === myId; }
function myTeam() { return state?.players?.find((p) => p.id === myId)?.team || null; }
function isOneEyedJack(code) { return code === 'JS' || code === 'JH'; }
function isTwoEyedJack(code) { return code === 'JD' || code === 'JC'; }

function getCardImagePath(cardCode) {
  if (!cardCode) return null;
  const suit = cardCode.slice(-1).toUpperCase();
  const rankRaw = cardCode.slice(0, -1).toUpperCase();
  const SUITS = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
  const RANKS = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };
  const rank = RANKS[rankRaw] || rankRaw.toLowerCase();
  if (rank === 'jack') {
    if (isOneEyedJack(cardCode)) return '/assets/svg cards/jack-clubs-one-eyed.svg';
    if (isTwoEyedJack(cardCode)) return '/assets/svg cards/jack-hearts-two-eyed.svg';
  }
  const suitName = SUITS[suit];
  if (!suitName) return null;
  return `/assets/svg cards/${rank}-${suitName}.svg`;
}

function renderScores() {
  const list = $('score-list');
  const mobBar = $('mobile-score-bar');
  if (list) list.innerHTML = '';
  if (mobBar) mobBar.innerHTML = '';

  const current = state?.currentPlayerId;
  const seqs = state?.sequences || {};

  (state?.players || []).forEach((p) => {
    if (!p?.team) return;

    function makePlayerEl() {
      const wrap = document.createElement('div');
      wrap.className = 'panel-player';

      const score = document.createElement('div');
      score.className = `panel-score-box bg-${p.team}`;
      score.textContent = String(seqs[p.team] ?? 0);

      const name = document.createElement('div');
      name.className = 'panel-player-name';
      name.textContent = (p.name || 'PLAYER').toUpperCase();

      wrap.appendChild(score);
      wrap.appendChild(name);

      const tags = document.createElement('div');
      tags.className = 'mob-role-tags';

      if (p.id === myId) {
        const t = document.createElement('span');
        t.className = 'mob-role-tag me';
        t.textContent = 'ME';
        tags.appendChild(t);
      }
      if (p.isHost || p.role === 'host') {
        const t = document.createElement('span');
        t.className = 'mob-role-tag host';
        t.textContent = 'HOST';
        tags.appendChild(t);
      }
      if (p.id === current) {
        const t = document.createElement('span');
        t.className = 'mob-role-tag your-trn';
        t.textContent = p.id === myId ? 'YOUR TURN' : 'TURN';
        tags.appendChild(t);
      }
      if (tags.children.length > 0) wrap.appendChild(tags);
      return wrap;
    }
    if (list) list.appendChild(makePlayerEl());
    if (mobBar) mobBar.appendChild(makePlayerEl());
  });
}

function renderHand() {
  const container = $('hand-cards');
  if (!container) return;
  container.innerHTML = '';

  const status = $('hand-status');
  if (status) {
    if (!state) status.textContent = '';
    else if (!isMyTurn()) {
      const cur = state?.players?.find((p) => p.id === state.currentPlayerId);
      status.textContent = cur ? `Waiting for ${cur.name}…` : 'Waiting…';
    } else if (selectedCardIndex === null) {
      status.textContent = 'Your turn! Select a card from your hand.';
    } else {
      // ════════ PROPER RULES INSTRUCTIONS ════════
      const code = state.myHand[selectedCardIndex];
      if (isOneEyedJack(code)) {
        status.textContent = "One-Eyed Jack: Select an opponent's chip to remove it.";
      } else if (isTwoEyedJack(code)) {
        status.textContent = "Two-Eyed Jack: Select any empty space to place your chip.";
      } else {
        status.textContent = `Select a matching empty ${getReadableCardName(code)} on the board.`;
      }
    }
  }

  const hand = state?.myHand || [];
  const clickable = isMyTurn();

  hand.forEach((code, idx) => {
    const el = document.createElement('div');
    el.className = 'hand-card';
    el.dataset.index = String(idx);

    const path = getCardImagePath(code);
    if (path) {
      const img = document.createElement('img');
      img.src = path;
      img.alt = code;
      img.className = 'card-fill-img';
      el.appendChild(img);
    }

    if (idx === selectedCardIndex) el.classList.add('is-selected');
    if (!clickable) el.classList.add('is-disabled');

    el.addEventListener('click', () => {
      if (!clickable) return showToast("It's not your turn", 'error', 1200);
      selectedCardIndex = selectedCardIndex === idx ? null : idx;
      renderHand();
      renderBoard();
    });

    container.appendChild(el);
  });

  // Dead card UI: if selected card is dead (standard card) allow one discard per turn.
  if (status && clickable && selectedCardIndex !== null) {
    const code = state.myHand[selectedCardIndex];
    const isJackCard = isOneEyedJack(code) || isTwoEyedJack(code);
    if (!isJackCard) {
      // Determine dead: both matching positions on board occupied.
      const occupied = (cell) => !!cell && !!cell.chip;
      const matches = (state.board || []).filter(c => c && !c.isWild && c.card === code);
      const isDead = matches.length === 2 && occupied(matches[0]) && occupied(matches[1]);
      if (isDead) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-gold-solid btn-sm';
        btn.style.marginLeft = '10px';
        btn.textContent = 'Discard Dead Card';
        btn.addEventListener('click', () => {
          socket.emit('discard-dead-card', { cardIndex: selectedCardIndex });
          selectedCardIndex = null;
          renderHand();
          renderBoard();
        });
        status.textContent = `Dead card: you may discard this card (once) and draw a replacement, then play.`;
        status.appendChild(btn);
      }
    }
  }
}

// ════════ MOBILE BOARD SPECIAL SVGs ════════
const _SUIT_NAMES_MAP = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };
const _RANK_DISP = { A: 'A', K: 'K', Q: 'Q', J: 'J' };

function buildMobileCellHTML(cardCode) {
  if (!cardCode) return '';
  const suit = cardCode.slice(-1).toUpperCase();
  const rank = cardCode.slice(0, -1).toUpperCase();
  const isRed = (suit === 'H' || suit === 'D');
  const col = isRed ? 'mob-red' : 'mob-black';
  const dispRank = _RANK_DISP[rank] || rank;
  const suitSvg = _SUIT_NAMES_MAP[suit];

  return `
    <div class="mob-cell-inner ${col}">
      <span class="mob-cell-tl">${dispRank}</span>
      <img class="mob-cell-suit-img" src="/assets/svg cards/${suitSvg}.svg" alt="${suit}">
    </div>`;
}
// ═══════════════════════════════════════════

function renderBoard() {
  const grid = $('board-grid');
  if (!grid) return;
  const board = state?.board || [];

  if (grid.children.length === 0) {
    const mobile = window.innerWidth <= 600;

    if (!mobile) {
      const corner = document.createElement('div');
      corner.className = 'col-label';
      grid.appendChild(corner);
      for (let c = 1; c <= 10; c++) {
        const lbl = document.createElement('div');
        lbl.className = 'col-label';
        lbl.textContent = String(c);
        grid.appendChild(lbl);
      }
    }

    for (let r = 0; r < 10; r++) {
      if (!mobile) {
        const rowLbl = document.createElement('div');
        rowLbl.className = 'row-label';
        rowLbl.textContent = String(r + 1);
        grid.appendChild(rowLbl);
      }

      for (let c = 0; c < 10; c++) {
        const i = r * 10 + c;
        const cell = board[i];
        const el = document.createElement('div');
        el.className = 'board-cell';
        if (cell?.isWild) el.classList.add('is-wild');
        // Store only the numeric cellId in the DOM — never capture the cell
        // object itself in the closure, because state.board is replaced on every
        // game-state-update and the captured reference becomes stale.
        const cellId = cell?.id ?? i;
        el.dataset.cellId = String(cellId);

        if (!cell?.isWild) {
          if (mobile) {
            // Mobile: compact rank + suit icon
            el.innerHTML = buildMobileCellHTML(cell?.card);
          } else {
            // Desktop: full card image asset
            const img = document.createElement('div');
            img.className = 'cell-img';
            const path = getCardImagePath(cell?.card);
            if (path) img.style.backgroundImage = `url("${path}")`;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.display = 'block';
            el.style.backgroundColor = 'transparent';
            el.appendChild(img);
          }
        }

        el.addEventListener('click', () => {
          // Look up the LIVE cell from current state at click-time.
          const liveCell = state?.board?.[cellId];
          onCellClick(liveCell, cellId);
        });
        grid.appendChild(el);
      }
    }
  }

  for (let i = 0; i < board.length; i++) {
    const cell = board[i];
    const el = grid.querySelector(`[data-cell-id="${cell?.id ?? i}"]`);
    if (!el) continue;

    el.classList.remove('is-target');
    const existingChip = el.querySelector('.chip');
    if (existingChip) existingChip.remove();

    if (cell?.chip) {
      const chip = document.createElement('div');
      chip.className = 'chip ' + cell.chip;
      if (cell.inSequence) chip.classList.add('chip-sequence');
      el.appendChild(chip);
    }
  }

  if (selectedCardIndex !== null && isMyTurn()) {
    const hand = state?.myHand || [];
    const card = hand[selectedCardIndex];
    if (card) {
      const isWild = isTwoEyedJack(card);
      const isRemove = isOneEyedJack(card);
      const me = myTeam();

      (state?.board || []).forEach((cell) => {
        if (cell?.isWild) return;
        let valid = false;
        if (isWild) {
          valid = !cell.chip;
        } else if (isRemove) {
          valid = cell.chip && cell.chip !== me && !cell.inSequence;
        } else {
          valid = cell?.card === card && !cell?.chip;
        }
        if (valid) {
          const el = grid.querySelector(`[data-cell-id="${cell.id}"]`);
          if (el) el.classList.add('is-target');
        }
      });
    }
  }
}

function onCellClick(cell, cellId) {
  if (!cell || cell.isWild) return;
  if (!isMyTurn()) return showToast("It's not your turn", 'error', 1200);
  if (selectedCardIndex === null) return showToast('Select a card first', 'info', 1200);

  const hand = state?.myHand || [];
  const card = hand[selectedCardIndex];
  const isWild = isTwoEyedJack(card);
  const isRemove = isOneEyedJack(card);
  const me = myTeam();

  let valid = false;
  if (isWild) {
    valid = !cell.chip;
  } else if (isRemove) {
    valid = cell.chip && cell.chip !== me && !cell.inSequence;
  } else {
    valid = cell.card === card && !cell.chip;
  }

  if (!valid) {
    return showToast('Invalid move! Please click exactly on the yellow highlighted cell.', 'error', 1800);
  }

  // cellId is passed explicitly from the click listener — always a valid 0-99 index.
  socket.emit('play-card', { cardIndex: selectedCardIndex, cellId });
}

function appendFeed(text, kind = '') {
  function _append(feedEl) {
    if (!feedEl) return;
    const div = document.createElement('div');
    div.className = 'feed-entry' + (kind ? ` ${kind}` : '');
    div.textContent = text;
    feedEl.appendChild(div);
    feedEl.scrollTop = feedEl.scrollHeight;
  }
  _append($('unified-feed'));
  _append($('mob-unified-feed'));
}

function renderLog() {
  const logs = state?.gameLog || [];
  const feed = $('unified-feed');
  if (!feed) return;

  if (logs.length < lastLogLen) {
    feed.innerHTML = '';
    lastLogLen = 0;
  }

  logs.slice(lastLogLen).forEach((e) => {
    const msg = e?.message || '';
    appendFeed(msg, msg.includes('🎉') ? 'system' : '');
  });

  lastLogLen = logs.length;

  const deckText = state?.deckCount === undefined ? '— left' : `${state.deckCount} cards left`;
  const deckEl = $('deck-remaining');
  const mobDeckEl = $('mob-deck-remaining');
  if (deckEl) deckEl.textContent = deckText;
  if (mobDeckEl) mobDeckEl.textContent = deckText;
}

function appendChat(entry) {
  const name = entry?.playerName === myName ? "You" : (entry?.playerName || 'Player');
  const msg = entry?.message || '';
  appendFeed(`${name}: ${msg}`, 'chat');
}

function sendChat(msg) {
  const m = (msg || '').trim();
  if (!m) return;
  socket.emit('send-chat', { message: m });
}

$('game-send-btn')?.addEventListener('click', () => {
  const input = $('game-chat-input');
  if (!input) return;
  sendChat(input.value);
  input.value = '';
});

$('game-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = $('game-chat-input');
  if (!input) return;
  sendChat(input.value);
  input.value = '';
});

$('mob-send-btn')?.addEventListener('click', () => {
  const input = $('mob-chat-input');
  if (!input) return;
  sendChat(input.value);
  input.value = '';
});

$('mob-chat-input')?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const input = $('mob-chat-input');
  if (!input) return;
  sendChat(input.value);
  input.value = '';
});

function setupQuickPhrases() {
  const textPhrases = ["Nice move!", "Well played!", "Oops!", "Wow!", "No way!", "Hurry up!", "Good game!", "Lucky!", "Thanks!"];
  const emojis = ["😂", "🔥", "😱", "😡", "🎉", "😏"];

  const desktopContainer = document.querySelector('.log-panel .quick-phrases-wrapper');
  const mobileContainer = document.querySelector('.mob-log-sheet .quick-phrases-wrapper');

  function populate(wrapper) {
    if (!wrapper) return;
    wrapper.innerHTML = '';

    const emojiRow = document.createElement('div');
    emojiRow.className = 'emoji-row';
    emojis.forEach(e => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.dataset.msg = e;
      btn.textContent = e;
      btn.addEventListener('click', () => sendChat(e));
      emojiRow.appendChild(btn);
    });

    const textRow = document.createElement('div');
    textRow.className = 'text-row';
    textPhrases.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'quick-btn';
      btn.dataset.msg = t;
      btn.textContent = t;
      btn.addEventListener('click', () => sendChat(t));
      textRow.appendChild(btn);
    });

    wrapper.appendChild(emojiRow);
    wrapper.appendChild(textRow);
  }

  populate(desktopContainer);
  populate(mobileContainer);
}

setupQuickPhrases();

(function setupMobileDrawer() {
  const fab = $('mob-log-fab');
  const drawer = $('mob-log-drawer');
  const backdrop = $('mob-log-backdrop');
  if (!fab || !drawer) return;

  fab.innerHTML = `<img src="/assets/svg cards/download.svg" style="width: 26px; height: 26px; pointer-events: none;" alt="Chat">`;

  fab.addEventListener('click', () => {
    drawer.classList.add('open');
    const mf = $('mob-unified-feed');
    if (mf) mf.scrollTop = mf.scrollHeight;
  });

  backdrop?.addEventListener('click', () => drawer.classList.remove('open'));
})();

function renderTimer() {
  stopTimer();
  const wrap = $('timer-wrap');
  const arc = $('timer-arc');
  const label = $('timer-label');
  if (!wrap || !arc || !label) return;

  const total = state?.settings?.turnTimer;
  if (!total || total === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  const elapsed = state?.turnStartTime ? Math.floor((Date.now() - state.turnStartTime) / 1000) : 0;
  let remaining = Math.max(0, total - elapsed);
  const circumference = 94.2;

  const tick = () => {
    label.textContent = String(remaining);
    const pct = total === 0 ? 0 : remaining / total;
    arc.style.strokeDashoffset = String(circumference * (1 - pct));
    remaining -= 1;
    if (remaining < 0) stopTimer();
  };

  tick();
  timerHandle = setInterval(tick, 1000);
}

function stopTimer() {
  if (timerHandle) clearInterval(timerHandle);
  timerHandle = null;
}

function showGameOver(winner) {
  stopTimer();
  const modal = $('gameover-modal');
  const title = $('winner-title');
  const desc = $('winner-desc');
  if (!modal || !title || !desc) return;

  title.textContent = `${(winner || '').toString().toUpperCase()} TEAM WINS!`;

  let winColor = '#e0b953';
  if (winner === 'red') winColor = '#e8384a';
  if (winner === 'blue') winColor = '#4285f4';
  if (winner === 'green') winColor = '#45b550';

  title.style.color = winColor;
  desc.textContent = myTeam() === winner ? 'Congratulations! Your team won.' : 'Better luck next time.';
  modal.style.display = 'flex';
}

$('play-again-btn')?.addEventListener('click', () => (window.location.href = '/lobby/' + roomId));

document.addEventListener('DOMContentLoaded', () => {
  function closeGameModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
    document.querySelectorAll('.elegant-modal').forEach(m => m.style.display = 'none');
  }

  function openGameModal(id) {
    document.querySelectorAll('.elegant-modal').forEach(m => m.style.display = 'none');
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (modal) modal.style.display = 'block';
    if (overlay) overlay.style.display = 'flex';
  }

  const btnSettings = document.getElementById('btn-settings');
  const btnInfo = document.getElementById('btn-info');
  const btnFeedback = document.getElementById('btn-feedback');
  const btnMute = document.getElementById('btn-mute');

  if (btnSettings) btnSettings.addEventListener('click', () => openGameModal('modal-settings'));
  if (btnInfo) btnInfo.addEventListener('click', () => openGameModal('modal-info'));
  if (btnFeedback) btnFeedback.addEventListener('click', () => openGameModal('modal-feedback'));
  document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', closeGameModal));

  if (btnMute) {
    let isMuted = sessionStorage.getItem('isMuted') === 'true';
    updateGameMuteIcon(isMuted, btnMute);
    btnMute.addEventListener('click', () => {
      isMuted = !isMuted;
      sessionStorage.setItem('isMuted', isMuted);
      updateGameMuteIcon(isMuted, btnMute);
    });
  }

  function updateGameMuteIcon(muted, btn) {
    if (muted) {
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff4d4d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
    } else {
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
    }
  }
});

// ── visibilitychange keepalive ────────────────────────────────────────────────
// When the user returns to this tab/app after switching away, check if the
// socket is still alive. If it dropped (mobile OS killed it), force a
// reconnect so the player is back in the game without a page reload.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!socket.connected) {
      showReconnectBanner();
      socket.connect(); // triggers the 'connect' handler which re-emits join-room
    }
  }
});
// ─────────────────────────────────────────────────────────────────────────────