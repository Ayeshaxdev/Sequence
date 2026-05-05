// ─── Detect if this is an Invite Join (e.g. /?join=ROOMID) ───────────────────
const urlParams  = new URLSearchParams(window.location.search);
const joinRoomId = urlParams.get('join'); // set when guest is redirected from lobby

if (joinRoomId) {
  // Switch the UI to "join" mode
  document.addEventListener('DOMContentLoaded', () => applyJoinMode());
  if (document.readyState !== 'loading') applyJoinMode();
}

function applyJoinMode() {
  const tagline = document.querySelector('.logo-tagline');
  if (tagline) tagline.textContent = "You've been invited! Enter your name to join.";

  const divider = document.querySelector('.divider');
  const joinSec = document.querySelector('.join-section');
  if (divider) divider.style.display = 'none';
  if (joinSec) joinSec.style.display = 'none';

  const createBtn = $('create-btn');
  if (createBtn) {
    createBtn.innerHTML = '<span class="btn-icon"></span> Join Game';
  }

  const form = document.querySelector('.landing-form');
  if (form) {
    const badge = document.createElement('div');
    badge.className = 'join-room-badge';
    badge.innerHTML = `<span> Joining Room:</span> <code>${joinRoomId.slice(0, 8)}…</code>`;
    form.insertAdjacentElement('afterbegin', badge);
  }
}

// ─── Animated Background Cards ────────────────────────────────────────────────
const BG_CARDS = [
  '2♠','3♥','4♦','5♣','6♠','7♥','8♦','9♣','10♠',
  'A♥','K♦','Q♣','2♥','3♦','4♣','5♠','6♥','7♦',
  '8♣','9♠','10♥','A♦','K♣','Q♠','2♦','3♣','4♠',
  '5♥','6♦','7♣','8♠','9♥','10♦','A♣','K♠','Q♥'
];

function spawnBgCard() {
  const container = $('bg-cards');
  if (!container) return;

  const card = document.createElement('div');
  card.className = 'bg-card-item';
  card.textContent = BG_CARDS[Math.floor(Math.random() * BG_CARDS.length)];
  card.style.color = Math.random() > 0.5 ? 'rgba(220,80,80,0.08)' : 'rgba(255,255,255,0.06)';

  const size = 44 + Math.random() * 40;
  card.style.width  = size + 'px';
  card.style.height = (size * 1.4) + 'px';
  card.style.left   = Math.random() * 105 + '%';
  card.style.bottom = '-100px';
  card.style.setProperty('--rot', (Math.random() * 60 - 30) + 'deg');

  const duration = 12 + Math.random() * 14;
  card.style.animationDuration = duration + 's';
  card.style.animationDelay = (Math.random() * -duration) + 's';

  container.appendChild(card);
  setTimeout(() => card.remove(), (duration + 5) * 1000);
}

for (let i = 0; i < 20; i++) spawnBgCard();
setInterval(spawnBgCard, 1200);

// ─── Character Counter ────────────────────────────────────────────────────────
const nameInput = $('player-name');
const charCounter = $('char-counter');

if (nameInput && charCounter) {
  nameInput.addEventListener('input', () => {
    const len = nameInput.value.length;
    charCounter.textContent = `${len} / 24`;
    charCounter.style.color = len >= 20 ? 'var(--red-team-light)' : 'var(--text-muted)';
  });
}

// ─── Create Game / Join Form ──────────────────────────────────────────────────
const createForm = $('create-form');
const createBtn  = $('create-btn');

if (createForm) {
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput?.value?.trim();
    if (!name) { showToast('Please enter your name', 'error'); return; }

    createBtn.disabled = true;

    // JOIN MODE
    if (joinRoomId) {
      createBtn.innerHTML = '<div class="spinner"></div> Joining...';
      saveSession('seq_player', { name, isHost: false, roomId: joinRoomId });
      window.location.href = `/lobby/${joinRoomId}`;
      return;
    }

    // HOST MODE
    createBtn.innerHTML = '<div class="spinner"></div> Creating...';
    try {
      const res = await fetch('/api/create-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName: name })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // YAHAN HOST KA NAAM 'seq_player' MEIN SAVE HOTA HAI
      saveSession('seq_player', { name, isHost: true, roomId: data.roomId });
      window.location.href = `/lobby/${data.roomId}`;
    } catch (err) {
      showToast(err.message || 'Failed to create room', 'error');
      createBtn.disabled = false;
      createBtn.innerHTML = '<span class="btn-icon">🎯</span> Create Game';
    }
  });
}

// ─── Join by Link ─────────────────────────────────────────────────────────────
const joinBtn  = $('join-btn');
const joinLink = $('join-link');

if (joinBtn && joinLink) {
  joinBtn.addEventListener('click', () => {
    const link = joinLink.value.trim();
    const name = nameInput?.value?.trim();

    if (!name) { showToast('Enter your name first', 'error'); nameInput?.focus(); return; }
    if (!link) { showToast('Paste an invite link', 'error'); joinLink.focus(); return; }

    let roomId = link;
    try {
      const url = new URL(link.startsWith('http') ? link : 'http://x/' + link);
      const parts = url.pathname.split('/').filter(Boolean);
      roomId = parts[parts.length - 1];
    } catch {}

    if (!roomId || roomId.length < 10) { showToast('Invalid invite link', 'error'); return; }

    saveSession('seq_player', { name, isHost: false, roomId });
    window.location.href = `/lobby/${roomId}`;
  });
  joinLink.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function setupModal(openBtnId, modalId, closeBtnId) {
  const openBtn = $(openBtnId);
  const modal   = $(modalId);
  const closeBtn = $(closeBtnId);
  if (!openBtn || !modal) return;
  openBtn.addEventListener('click', () => { modal.style.display = 'flex'; });
  closeBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.style.display = 'none'; });
}
setupModal('btn-rules',    'rules-modal',    'close-rules');
setupModal('btn-strategy', 'strategy-modal', 'close-strategy');