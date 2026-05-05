/**
 * Game Logic
 * Move validation, Jack rules, sequence detection, win condition checking.
 */

const { isOneEyedJack, isTwoEyedJack, isJack, getPositionsForCard } = require('./boardLayout');

/**
 * Validate a normal card play (not Jack).
 * Player must:
 *   1. Have the card in their hand
 *   2. The board cell must match the card
 *   3. The cell must be empty
 */
function validateCardPlay(room, playerId, cardIndex, cellId) {
  const player = room.players.get(playerId);
  if (!player) return { valid: false, reason: 'Player not found' };
  if (room.turnOrder[room.currentTurnIndex] !== playerId)
    return { valid: false, reason: 'Not your turn' };
  if (cardIndex < 0 || cardIndex >= player.hand.length)
    return { valid: false, reason: 'Invalid card index' };

  const card = player.hand[cardIndex];

  // Two-eyed Jack — handled separately
  if (isTwoEyedJack(card)) {
    const cell = room.board[cellId];
    if (!cell) return { valid: false, reason: 'Invalid cell' };
    if (cell.isWild) return { valid: false, reason: 'Cell is a wild corner (already free)' };
    if (cell.chip !== null) return { valid: false, reason: 'Cell already occupied' };
    return { valid: true, isWild: true };
  }

  // One-eyed Jack — handled separately
  if (isOneEyedJack(card)) {
    const cell = room.board[cellId];
    if (!cell) return { valid: false, reason: 'Invalid cell' };
    if (cell.isWild) return { valid: false, reason: 'Cannot remove wild corner chip' };
    if (cell.chip === null) return { valid: false, reason: 'No chip to remove' };
    if (cell.chip === player.team) return { valid: false, reason: 'Cannot remove your own chip' };
    if (cell.inSequence) return { valid: false, reason: 'Cannot remove chip in a completed sequence' };
    return { valid: true, isRemove: true };
  }

  // Normal play
  const cell = room.board[cellId];
  if (!cell) return { valid: false, reason: 'Invalid cell' };
  if (cell.isWild) return { valid: false, reason: 'Cannot play to wild corner' };
  if (cell.card !== card) return { valid: false, reason: 'Card does not match board position' };
  if (cell.chip !== null) return { valid: false, reason: 'Cell already occupied' };

  return { valid: true };
}

/**
 * A standard (non-jack) card is "dead" when both matching board slots
 * are already occupied.
 */
function isDeadCard(room, cardCode) {
  if (!cardCode || isJack(cardCode)) return false;
  const pos = getPositionsForCard(cardCode);
  if (!pos || pos.length !== 2) return false;
  const a = room.board[pos[0].id];
  const b = room.board[pos[1].id];
  // A slot is considered occupied if it has a chip (any team).
  return !!(a && b && a.chip !== null && b.chip !== null);
}

function getDeadCardReason(room, cardCode) {
  if (!cardCode) return { dead: false, reason: 'No card' };
  if (isJack(cardCode)) return { dead: false, reason: 'Jacks are never dead' };
  const pos = getPositionsForCard(cardCode);
  if (!pos || pos.length !== 2) return { dead: false, reason: 'Card not found on board' };
  const a = room.board[pos[0].id];
  const b = room.board[pos[1].id];
  const dead = !!(a && b && a.chip !== null && b.chip !== null);
  return { dead, reason: dead ? 'Both slots occupied' : 'At least one slot open' };
}

/**
 * Sequence detection (core algorithm)
 *
 * We detect sequences by scanning outward from the MOST RECENTLY PLACED CHIP.
 * This avoids double-counting (e.g., a 6-in-a-row is still 1 sequence).
 *
 * Corners (isWild) count for all teams and can complete a 5.
 * Once a sequence is formed, the involved chips become locked (inSequence=true)
 * and cannot be removed by One-Eyed Jacks.
 */
function checkAndUpdateSequences(room, placedCellId, team) {
  const teams = ['red', 'blue', 'green'];
  const totals = room.sequences || { red: 0, blue: 0, green: 0 };
  const newlyFormed = { red: 0, blue: 0, green: 0 };

  if (!team || !teams.includes(team)) return { totals, newlyFormed };
  const placedCell = room.board[placedCellId];
  if (!placedCell) return { totals, newlyFormed };

  // Only chip placements can create sequences (not removals).
  // placedCellId may still be passed after a remove, so guard here.
  if (placedCell.isWild) return { totals, newlyFormed };
  if (placedCell.chip !== team) return { totals, newlyFormed };

  const dirs = [
    { dr: 0, dc: 1 },   // horizontal
    { dr: 1, dc: 0 },   // vertical
    { dr: 1, dc: 1 },   // diag \
    { dr: 1, dc: -1 }   // diag /
  ];

  const inBounds = (r, c) => r >= 0 && r < 10 && c >= 0 && c < 10;
  const countsForTeam = (cell) => !!cell && (cell.isWild || cell.chip === team);

  const placedR = placedCell.row;
  const placedC = placedCell.col;

  // Returns ordered cellIds for the full contiguous line containing the placed cell, in one direction.
  function collectLine(dr, dc) {
    // Walk backwards to the start of the contiguous run
    let r = placedR;
    let c = placedC;
    while (true) {
      const rr = r - dr;
      const cc = c - dc;
      if (!inBounds(rr, cc)) break;
      const prev = room.board[rr * 10 + cc];
      if (!countsForTeam(prev)) break;
      r = rr; c = cc;
    }

    // Walk forward collecting the entire run
    const ids = [];
    while (inBounds(r, c)) {
      const cell = room.board[r * 10 + c];
      if (!countsForTeam(cell)) break;
      ids.push(r * 10 + c);
      r += dr; c += dc;
    }
    return ids;
  }

  // Count sequences in a contiguous run:
  // - length 5..9 => 1 sequence
  // - length 10+  => 2 sequences (10-in-line counts as 2)
  // This matches your spec (two sequences can share chips across directions, but
  // a single straight line only yields a second sequence at 10).
  function pickSequenceSegments(runIds) {
    if (!runIds || runIds.length < 5) return [];
    if (runIds.length >= 10) {
      return [runIds.slice(0, 5), runIds.slice(-5)];
    }
    return [runIds.slice(0, 5)];
  }

  // For each direction, lock and count any newly-created sequences.
  for (const { dr, dc } of dirs) {
    const runIds = collectLine(dr, dc);
    const segments = pickSequenceSegments(runIds);
    for (const seg of segments) {
      // If every non-wild cell in this segment is already locked, it is not "new".
      const hasNewLock = seg.some((id) => {
        const cell = room.board[id];
        return cell && !cell.isWild && !cell.inSequence;
      });
      if (!hasNewLock) continue;

      // Lock the segment chips (excluding wild corners, which are always free).
      for (const id of seg) {
        const cell = room.board[id];
        if (cell && !cell.isWild) cell.inSequence = true;
      }

      totals[team] = (totals[team] || 0) + 1;
      newlyFormed[team] += 1;
    }
  }

  room.sequences = totals;
  return { totals, newlyFormed };
}

/**
 * Check win condition based on room settings.
 * Returns { winner: teamName } or null.
 */
function checkWinCondition(room) {
  const { winCondition } = room.settings;
  const seqs = room.sequences;

  if (winCondition === 'first-sequence') {
    for (const team of ['red', 'blue', 'green']) {
      if (seqs[team] >= 1 && hasTeamPlayers(room, team)) return { winner: team };
    }
  }

  if (winCondition === 'two-sequences') {
    for (const team of ['red', 'blue', 'green']) {
      if (seqs[team] >= 2 && hasTeamPlayers(room, team)) return { winner: team };
    }
  }

  if (winCondition === 'play-all-cards') {
    // End only when deck is exhausted AND all players have played all cards.
    // Then highest sequences wins; ties are a draw.
    const activePlayers = [...room.players.values()].filter(p => p.team);
    const allHandsEmpty = activePlayers.length > 0 && activePlayers.every(p => p.hand.length === 0);
    if (room.deck.length === 0 && allHandsEmpty) {
      const maxSeqs = Math.max(seqs.red || 0, seqs.blue || 0, seqs.green || 0);
      const leaders = ['red', 'blue', 'green'].filter(t => (seqs[t] || 0) === maxSeqs && hasTeamPlayers(room, t));
      if (leaders.length === 1) return { winner: leaders[0] };
      return { winner: 'draw' };
    }
  }

  return null;
}

function hasTeamPlayers(room, team) {
  for (const [, player] of room.players) {
    if (player.team === team) return true;
  }
  return false;
}

/**
 * Get the next turn index (skip players who left)
 */
function getNextTurnIndex(room) {
  const total = room.turnOrder.length;
  if (total === 0) return 0;
  let next = (room.currentTurnIndex + 1) % total;
  // Skip disconnected players
  let attempts = 0;
  while (!room.players.has(room.turnOrder[next]) && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  return next;
}

/**
 * Check if a player has any valid move (to avoid deadlock).
 * Dead hand: all cards in hand have 0 valid placements.
 */
function hasValidMove(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return false;

  for (const card of player.hand) {
    if (isOneEyedJack(card)) {
      // Valid if any opponent chip exists that's not in a sequence
      for (const cell of room.board) {
        if (cell.chip && cell.chip !== player.team && !cell.inSequence) return true;
      }
    } else if (isTwoEyedJack(card)) {
      // Valid if any empty non-wild cell exists
      for (const cell of room.board) {
        if (!cell.isWild && cell.chip === null) return true;
      }
    } else {
      // Normal card — check if any matching board cell is empty
      for (const cell of room.board) {
        if (cell.card === card && cell.chip === null) return true;
      }
    }
  }
  return false;
}

module.exports = {
  validateCardPlay,
  checkAndUpdateSequences,
  checkWinCondition,
  getNextTurnIndex,
  hasValidMove,
  hasTeamPlayers,
  isDeadCard,
  getDeadCardReason
};
