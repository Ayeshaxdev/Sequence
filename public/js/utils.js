/**
 * Shared Utilities — available on all pages
 */

// ─── Toast System ──────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ─── Emoji Reaction Float ──────────────────────────────────────────────────────
function floatReaction(emoji, x, y) {
  const el = document.createElement('div');
  el.className = 'reaction-float';
  el.textContent = emoji;
  el.style.left = (x || window.innerWidth / 2) + 'px';
  el.style.top  = (y || window.innerHeight - 100) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

// ─── Team Color Helpers ────────────────────────────────────────────────────────
function teamColor(team) {
  const map = { red: '#e53935', blue: '#1e88e5', green: '#43a047' };
  return map[team] || '#888';
}

function teamEmoji(team) {
  const map = { red: '🔴', blue: '🔵', green: '🟢' };
  return map[team] || '⚫';
}

// ─── Copy to Clipboard ────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
    return true;
  }
}

// ─── Format Time ──────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Session Storage ──────────────────────────────────────────────────────────
function saveSession(key, value) {
  const s = JSON.stringify(value);
  try { localStorage.setItem(key, s); } catch {}
  try { sessionStorage.setItem(key, s); } catch {}
}

function loadSession(key) {
  // localStorage persists across mobile app-switches and tab restores.
  // sessionStorage is wiped when the OS kills the browser tab on mobile.
  // Try localStorage first, fall back to sessionStorage.
  try {
    const ls = localStorage.getItem(key);
    if (ls) return JSON.parse(ls);
  } catch {}
  try {
    const ss = sessionStorage.getItem(key);
    if (ss) return JSON.parse(ss);
  } catch {}
  return null;
}

// ─── URL Params ───────────────────────────────────────────────────────────────
function getRoomIdFromURL() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || null;
}

// ─── DOM Helper ───────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function $q(sel) { return document.querySelector(sel); }
function $qa(sel) { return document.querySelectorAll(sel); }

// ─── Suit Symbols ─────────────────────────────────────────────────────────────
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

function cardDisplayName(code) {
  if (!code) return '';
  const suit = code.slice(-1);
  const rank = code.slice(0, -1);
  return `${rank}${SUIT_SYMBOLS[suit] || suit}`;
}
