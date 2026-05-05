/**
 * Card Renderer — Uses external card images and SVG special jacks.
 */

const USE_CARD_IMAGES = true;

const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const RED_SUITS = new Set(['H', 'D']);

function parseCard(code) {
  if (!code) return null;
  const suit = code.slice(-1).toUpperCase();
  const rank = code.slice(0, -1).toUpperCase();
  return { rank, suit };
}

function rankDisplay(rank) {
  const map = { A: 'A', K: 'K', Q: 'Q', J: 'J' };
  return map[rank] || rank;
}

function isOneEyedJack(code) { return code === 'JS' || code === 'JH'; }
function isTwoEyedJack(code) { return code === 'JD' || code === 'JC'; }

function getCardImagePath(cardCode) {
  if (isOneEyedJack(cardCode)) return '/assets/jack-clubs-one-eyed.svg';
  if (isTwoEyedJack(cardCode)) return '/assets/jack-hearts-two-eyed.svg';

  const card = parseCard(cardCode);
  if (!card) return null;
  const rankMap = { A: 'ace', K: 'king', Q: 'queen', J: 'jack' };
  const rankStr = rankMap[card.rank] || card.rank;
  const suitName = SUIT_NAMES[card.suit].toLowerCase();

  return `/assets/full deck cards/${rankStr}_of_${suitName}.svg`;
}

function renderHandCard(cardCode, index, selected = false) {
  const card = parseCard(cardCode);
  if (!card) return null;

  const el = document.createElement('div');
  el.className = 'hand-card playing-card' +
    (RED_SUITS.has(card.suit) ? ' card-red' : ' card-black') +
    (selected ? ' card-selected' : '');
  el.dataset.cardCode = cardCode;
  el.dataset.index = index;
  el.title = `${rankDisplay(card.rank)} of ${SUIT_NAMES[card.suit]}${isOneEyedJack(cardCode) ? ' — Remove opponent chip' : isTwoEyedJack(cardCode) ? ' — Wild placement' : ''}`;

  if (USE_CARD_IMAGES) {
    el.style.backgroundImage = `url("${getCardImagePath(cardCode)}")`;
    el.style.backgroundSize = 'contain';
    el.style.backgroundRepeat = 'no-repeat';
    el.style.backgroundPosition = 'center';
    el.style.backgroundColor = 'transparent';
    el.style.border = 'none';
    el.style.boxShadow = 'none';
    el.innerHTML = '';
  } else {
    el.innerHTML = `
      <span class="card-rank-top">${rankDisplay(card.rank)}<br>${SUIT_SYMBOLS[card.suit]}</span>
      <span class="card-center-suit">${SUIT_SYMBOLS[card.suit]}</span>
      <span class="card-rank-bot">${rankDisplay(card.rank)}<br>${SUIT_SYMBOLS[card.suit]}</span>
    `;
    if (isOneEyedJack(cardCode)) {
      const badge = document.createElement('span');
      badge.className = 'jack-badge jack-1eye';
      el.appendChild(badge);
    }
    if (isTwoEyedJack(cardCode)) {
      const badge = document.createElement('span');
      badge.className = 'jack-badge jack-2eye';
      el.appendChild(badge);
    }
  }

  return el;
}

function renderBoardCell(cell) {
  const el = document.createElement('div');
  el.className = 'board-cell';
  el.dataset.cellId = cell.id;

  if (cell.isWild) {
    el.classList.add('cell-wild');
    if (USE_CARD_IMAGES) {
      el.style.backgroundImage = `url("/assets/corner_card.png")`;
      el.style.backgroundSize = '100% 100%';
      el.style.backgroundRepeat = 'no-repeat';
      el.style.backgroundPosition = 'center';
      el.style.backgroundColor = 'transparent';
      el.style.border = 'none';
      el.innerHTML = '';
    } else {
      el.innerHTML = `<div class="wild-star">★</div>`;
    }

    // Kept for structural consistency if needed
    const chipEl = createChipEl('wild');
    chipEl.style.display = 'none';
    el.appendChild(chipEl);
    return el;
  }

  const card = parseCard(cell.card);
  if (!card) return el;

  const isRed = RED_SUITS.has(card.suit);
  el.classList.add(isRed ? 'cell-red' : 'cell-black');

  if (USE_CARD_IMAGES) {
    const img = document.createElement('div');
    img.className = 'cell-card-img';
    img.style.backgroundImage = `url("${getCardImagePath(cell.card)}")`;
    img.style.backgroundSize = '100% 100%';
    img.style.backgroundRepeat = 'no-repeat';
    img.style.backgroundPosition = 'center';
    img.style.width = '100%';
    img.style.height = '100%';
    el.style.backgroundColor = 'transparent';
    el.style.border = 'none';
    el.appendChild(img);
  } else {
    el.innerHTML = `
      <div class="cell-content">
        <span class="cell-rank">${rankDisplay(card.rank)}</span>
        <span class="cell-suit">${SUIT_SYMBOLS[card.suit]}</span>
      </div>
    `;
  }

  if (cell.chip) {
    const chipEl = createChipEl(cell.chip, cell.inSequence);
    el.appendChild(chipEl);
  }

  return el;
}

function createChipEl(team, inSeq = false) {
  const chip = document.createElement('div');
  chip.className = `chip chip-${team}` + (inSeq ? ' chip-sequence' : '');
  return chip;
}

function updateBoardCellChip(cellId, chip, isNew = true, inSequence = false) {
  const el = document.querySelector(`[data-cell-id="${cellId}"]`);
  if (!el) return;

  const existing = el.querySelector('.chip');
  if (existing) existing.remove();

  if (chip) {
    const chipEl = createChipEl(chip, inSequence);
    if (isNew) chipEl.classList.add('chip-new');
    el.appendChild(chipEl);
  }
}

module.exports = { renderHandCard, renderBoardCell, updateBoardCellChip, parseCard, isOneEyedJack, isTwoEyedJack, USE_CARD_IMAGES };
