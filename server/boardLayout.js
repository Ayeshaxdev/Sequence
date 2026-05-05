/**
 * Standard Sequence Board Layout (10×10)
 * null = wild/free corner
 * Each non-Jack card appears exactly twice (96 cards + 4 corners = 100)
 *
 * Card format: "<rank><suit>" e.g. "AS" = Ace of Spades, "10H" = 10 of Hearts
 * Suits: S=Spades, H=Hearts, D=Diamonds, C=Clubs
 * Ranks: 2-10, A, K, Q (NO Jacks — they are special action cards)
 */

const BOARD_LAYOUT = [
  // Row 0
  [null,  '2H',  '3H',  '4H',  '5H',  '6H',  '7H',  '8H',  '9H',  null ],
  // Row 1
  ['3S',  '4S',  '5S',  '6S',  '7S',  '8S',  '9S',  '10S', 'QH',  '10H'],
  // Row 2
  ['2S',  '2D',  '3D',  '4D',  '5D',  '6D',  '7D',  'AD',  'KH',  'QH' ],
  // Row 3
  ['AH',  'AD',  '8D',  '9D',  '10D', 'QD',  'KD',  'KH',  'QS',  'AH' ],
  // Row 4
  ['KS',  'KC',  '7C',  '8C',  '9C',  '10C', 'AC',  'AS',  'KD',  '2H' ],
  // Row 5
  ['QS',  'QC',  '6C',  '5C',  '4C',  '3C',  '2C',  'QD',  '3C',  '3H' ],
  // Row 6
  ['10S', 'AC',  '5D',  '4D',  '3D',  '2D',  '2C',  '10C', '4C',  '4H' ],
  // Row 7
  ['9S',  'KD',  '6D',  '7D',  '8D',  '9D',  '10D', '9C',  '5C',  '5H' ],
  // Row 8
  ['8S',  'QD',  'KS',  'QC',  '7C',  '6C',  '8C',  '8S',  '6H',  '6H' ],
  // Row 9
  [null,  '7S',  '6S',  '5S',  '4S',  '3S',  '2S',  'AS',  'KC',  null ]
];

// Flatten to 100-cell array with position metadata
const BOARD_CELLS = [];
for (let row = 0; row < 10; row++) {
  for (let col = 0; col < 10; col++) {
    const card = BOARD_LAYOUT[row][col];
    BOARD_CELLS.push({
      id: row * 10 + col,
      row,
      col,
      card: card, // null = wild corner
      chip: null, // 'red' | 'blue' | 'green' | null
      isWild: card === null,
      inSequence: false
    });
  }
}

/**
 * Returns fresh board state (deep copy)
 */
function createFreshBoard() {
  return BOARD_CELLS.map(cell => ({ ...cell }));
}

/**
 * Get all board positions for a given card
 */
function getPositionsForCard(cardCode) {
  return BOARD_CELLS
    .filter(cell => cell.card === cardCode)
    .map(cell => ({ row: cell.row, col: cell.col, id: cell.id }));
}

/**
 * One-eyed Jacks (remove chip): JS, JH
 * Two-eyed Jacks (wild place): JD, JC
 */
function isOneEyedJack(cardCode) {
  return cardCode === 'JS' || cardCode === 'JH';
}

function isTwoEyedJack(cardCode) {
  return cardCode === 'JD' || cardCode === 'JC';
}

function isJack(cardCode) {
  return isOneEyedJack(cardCode) || isTwoEyedJack(cardCode);
}

module.exports = {
  BOARD_LAYOUT,
  BOARD_CELLS,
  createFreshBoard,
  getPositionsForCard,
  isOneEyedJack,
  isTwoEyedJack,
  isJack
};
