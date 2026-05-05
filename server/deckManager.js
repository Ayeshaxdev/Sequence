/**
 * Deck Manager
 * Handles creation, shuffling, and dealing of cards.
 * Uses two standard 52-card decks = 104 cards total (including Jacks).
 * Jacks are action cards, NOT on the board.
 */

const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A', 'K', 'Q', 'J'];

/**
 * Creates a shuffled deck of 104 cards (2x standard 52-card decks).
 */
function createDeck() {
  const single = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      single.push(`${rank}${suit}`);
    }
  }
  // Two decks
  const deck = [...single, ...single];
  return shuffle(deck);
}

/**
 * Fisher-Yates shuffle
 */
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Deal `count` cards from the top of the deck.
 * Returns { hand, remainingDeck }
 */
function dealCards(deck, count) {
  const hand = deck.slice(0, count);
  const remainingDeck = deck.slice(count);
  return { hand, remainingDeck };
}

/**
 * Draw 1 card for a player (replenishes after playing a card).
 */
function drawCard(deck) {
  if (deck.length === 0) return { card: null, remainingDeck: [] };
  const card = deck[0];
  const remainingDeck = deck.slice(1);
  return { card, remainingDeck };
}

/**
 * Determine how many cards each player gets based on player count.
 * Standard Sequence rules:
 *   2 players  → 7 cards each
 *   3 players  → 6 cards each
 *   4 players  → 6 cards each
 *   6 players  → 5 cards each (3 teams of 2)
 */
function getHandSize(playerCount) {
  if (playerCount <= 2) return 7;
  if (playerCount <= 4) return 6;
  return 5;
}

/**
 * Returns suit string for display
 */
function getSuitSymbol(suit) {
  const map = { S: '♠', H: '♥', D: '♦', C: '♣' };
  return map[suit] || suit;
}

/**
 * Returns whether a card is red (Hearts or Diamonds)
 */
function isRedCard(cardCode) {
  if (!cardCode) return false;
  const suit = cardCode.slice(-1);
  return suit === 'H' || suit === 'D';
}

module.exports = {
  createDeck,
  shuffle,
  dealCards,
  drawCard,
  getHandSize,
  getSuitSymbol,
  isRedCard,
  SUITS,
  RANKS
};
