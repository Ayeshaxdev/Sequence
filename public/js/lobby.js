// ════════ BULLETPROOF UI FIX ════════
// Yeh code zabardasti team cards ko phatne se rokay ga
if (!document.getElementById('bulletproof-styles')) {
    const style = document.createElement('style');
    style.id = 'bulletproof-styles';
    style.innerHTML = `
        .team-card { min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }
        .player-slot { min-width: 0 !important; width: 100% !important; overflow: hidden !important; }
        .badge-name-container { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle; }
    `;
    document.head.appendChild(style);
}

const socket = io({
  // Same reconnection settings as game.js so lobby stays alive on tab-switch / mobile.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// ── Reconnect banner helpers ─────────────────────────────────────────────────
function showLobbyReconnectBanner() {
  let banner = document.getElementById('lobby-reconnect-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'lobby-reconnect-banner';
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
function hideLobbyReconnectBanner() {
  const banner = document.getElementById('lobby-reconnect-banner');
  if (banner) banner.style.display = 'none';
}
// ─────────────────────────────────────────────────────────────────────────────

function getPlayerData() {
    try {
        let rawData = sessionStorage.getItem('seq_player') || localStorage.getItem('seq_player');
        if (rawData) return JSON.parse(rawData);
    } catch(e) {}
    return null;
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.style.display = 'none';
    document.querySelectorAll('.elegant-modal').forEach(m => m.style.display = 'none');
}

function openSpecificModal(id) {
    document.querySelectorAll('.elegant-modal').forEach(m => m.style.display = 'none');
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (modal) modal.style.display = 'block';
    if (overlay) overlay.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', () => {
    // MODALS & BUTTONS
    const btnSettings = document.getElementById('btn-settings');
    const btnInfo = document.getElementById('btn-info');
    const btnFeedback = document.getElementById('btn-feedback');
    const btnMute = document.getElementById('btn-mute');

    if (btnSettings) btnSettings.addEventListener('click', () => openSpecificModal('modal-settings'));
    if (btnInfo) btnInfo.addEventListener('click', () => openSpecificModal('modal-info'));
    if (btnFeedback) btnFeedback.addEventListener('click', () => openSpecificModal('modal-feedback'));
    document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', closeModal));

   if (btnMute) {
        // FIX: localStorage ki jagah sessionStorage lagaya hai
        // Ab yeh setting sirf is current game/tab ke liye apply hogi
        let isMuted = sessionStorage.getItem('isMuted') === 'true';
        updateMuteIcon(isMuted, btnMute);
        
        btnMute.addEventListener('click', () => {
            isMuted = !isMuted;
            sessionStorage.setItem('isMuted', isMuted);
            updateMuteIcon(isMuted, btnMute);
        });
    }

    function updateMuteIcon(muted, btn) {
        if (muted) {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff4d4d" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
        } else {
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`;
        }
    }

    // ROOM JOINING
    const roomId = window.location.pathname.split('/').pop();
    let sessionData = getPlayerData();
    let playerName = sessionData ? sessionData.name : null;

    if (!playerName || playerName === 'Guest') {
        window.location.href = `/?join=${roomId}`;
        return; 
    }

    // join-room is now handled exclusively by the 'connect' handler below.
    // This ensures join-room is emitted exactly once per connection
    // (initial load OR reconnect) and prevents the host-to-guest demotion bug.

    // COPY LINK — fetch public ngrok URL or LAN IP from server
    const inviteUrlSpan = document.getElementById('invite-url');
    const copyBtn = document.getElementById('copy-btn');
    let inviteUrl = window.location.href; // safe default (localhost)

    async function initInviteLink() {
        try {
            const res = await fetch('/api/server-info');
            const { localIP, port, publicUrl } = await res.json();
            
            // BULLETPROOF LOGIC:
            // If the browser is ALREADY accessing the site via a real domain (like Back4App)
            // or a real network IP, then the URL in the address bar is the perfect invite link.
            if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
                inviteUrl = window.location.href;
            } else if (publicUrl) {
                // Host is on localhost, but ngrok is running — use ngrok URL
                inviteUrl = `${publicUrl}/lobby/${roomId}`;
            } else if (localIP && localIP !== 'localhost') {
                // Host is on localhost, no ngrok — use the machine's WiFi IP
                inviteUrl = `http://${localIP}:${port}/lobby/${roomId}`;
            }
        } catch (e) {
            console.warn('[InviteLink] Could not fetch server-info, falling back to window.location.href');
            inviteUrl = window.location.href;
        }
        if (inviteUrlSpan) inviteUrlSpan.innerText = inviteUrl;
    }
    initInviteLink();

    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            copyToClipboard(inviteUrl).then(() => {
                const originalText = copyBtn.innerText;
                copyBtn.innerText = 'Copied!';
                copyBtn.style.background = '#28a745';
                setTimeout(() => { copyBtn.innerText = originalText; copyBtn.style.background = ''; }, 2500);
            });
        });
    }

    // SYNC EVENTS
    socket.on('game-state-update', (state) => {
        updatePlayersList(state.players);
        updateTeamsUI(state.players);
        checkStartGameStatus(state.players);

        // Sync settings selects from server state so all players see current config.
        // Only the host can change settings; guests get disabled read-only selects.
        const amHost = state.hostId === socket.id;
        const wc = document.getElementById('win-condition');
        const tt = document.getElementById('turn-timer');
        if (wc && state.settings?.winCondition) {
            wc.value = state.settings.winCondition;
            wc.disabled = !amHost;
        }
        if (tt && state.settings?.turnTimer !== undefined) {
            tt.value = String(state.settings.turnTimer);
            tt.disabled = !amHost;
        }
    });

    socket.on('chat-message', (data) => {
        appendMessage(data.message, data.playerId === socket.id);
    });

    socket.on('error', (data) => {
        alert(data.message);
    });

    socket.on('game-started', () => {
        window.location.href = `/game/${roomId}`;
    });

    // ════════ ADD BOT LOGIC ════════
    const addBotBtns = document.querySelectorAll('.btn-text-soft');
    addBotBtns.forEach(btn => {
        if (btn.innerText.includes('Add Bot')) {
            btn.addEventListener('click', (e) => {
                // Team ka color dhoondein
                const teamCard = e.target.closest('.team-card');
                const joinBtn = teamCard.querySelector('.team-join-btn');
                const teamColor = joinBtn.getAttribute('data-team');
                socket.emit('add-bot', { team: teamColor }); // Server ko bolain bot add kare
            });
        }
    });

    // NORMAL TEAM JOIN
    const joinBtns = document.querySelectorAll('.team-join-btn');
    joinBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            socket.emit('set-team', { team: e.target.getAttribute('data-team') });
        });
    });

    const startGameBtn = document.getElementById('start-game-btn');
    if (startGameBtn) {
        startGameBtn.addEventListener('click', () => {
            if (!startGameBtn.disabled) socket.emit('start-game');
        });
    }

    // ── SETTINGS ────────────────────────────────────────────────────
    const winConditionSelect = document.getElementById('win-condition');
    const turnTimerSelect    = document.getElementById('turn-timer');

    function emitSettings() {
        socket.emit('update-settings', {
            winCondition: winConditionSelect?.value,
            turnTimer: parseInt(turnTimerSelect?.value || '0', 10)
        });
    }

    if (winConditionSelect) winConditionSelect.addEventListener('change', emitSettings);
    if (turnTimerSelect)    turnTimerSelect.addEventListener('change', emitSettings);
    // ──────────────────────────────────────────────────────────────────────────

    const sendBtn = document.getElementById('lobby-send-btn');
    const chatInput = document.getElementById('lobby-chat-input');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            const text = chatInput.value.trim();
            if (text) { socket.emit('send-chat', { message: text }); chatInput.value = ''; }
        });
        chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendBtn.click(); });
    }

    const quickPhrases = document.querySelectorAll('.quick-btn-dark');
    quickPhrases.forEach(btn => {
        btn.addEventListener('click', () => {
            const msgText = btn.getAttribute('data-msg');
            if(msgText) socket.emit('send-chat', { message: msgText });
        });
    });

    // ── Reconnect handlers ────────────────────────────────────────────────
    // 'connect' fires on the INITIAL connection and every subsequent reconnect.
    // This is the single place that emits join-room, preventing double-joins
    // that would overwrite the host's isHost flag with a guest entry.
    socket.on('connect', () => {
        hideLobbyReconnectBanner();
        socket.emit('join-room', { roomId, playerName });
    });
    // If the socket is ALREADY connected when DOMContentLoaded fires
    // (edge-case: script loaded late), emit join-room immediately.
    if (socket.connected) {
        socket.emit('join-room', { roomId, playerName });
    }
    socket.on('disconnect', () => showLobbyReconnectBanner());
    socket.on('reconnect_attempt', () => showLobbyReconnectBanner());
    socket.on('reconnected', () => hideLobbyReconnectBanner());

    // visibilitychange: force-reconnect when the user returns from another app.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !socket.connected) {
            showLobbyReconnectBanner();
            socket.connect();
        }
    });
    // ─────────────────────────────────────────────────────────────────────────────
});

// ════════════ UI HELPER FUNCTIONS ════════════

function checkStartGameStatus(players) {
    const startGameBtn = document.getElementById('start-game-btn');
    const hostHint = document.getElementById('host-only-hint');
    if (!startGameBtn) return;

    const me = players.find(p => p.id === socket.id);
    if (!me) return;

    // Ab game start karne ke liye insaan aur bots dono count honge
    const playersInTeams = players.filter(p => p.team !== null).length;

    // Check if host should see 'Add Bot' buttons
    document.querySelectorAll('.btn-text-soft').forEach(btn => {
        if (btn.innerText.includes('Add Bot')) {
            btn.style.display = me.isHost ? 'inline-block' : 'none'; // Sirf host ko dikhega
        }
    });

    if (me.isHost) {
        if (hostHint) hostHint.style.display = 'none';
        
        if (playersInTeams >= 2) {
            startGameBtn.disabled = false;
            startGameBtn.style.opacity = '1';
            startGameBtn.style.cursor = 'pointer';
            startGameBtn.innerText = "Start Game";
        } else {
            startGameBtn.disabled = true;
            startGameBtn.style.opacity = '0.5';
            startGameBtn.style.cursor = 'not-allowed';
            startGameBtn.innerText = "Waiting for players to join teams...";
        }
    } else {
        startGameBtn.disabled = true;
        startGameBtn.style.opacity = '0.5';
        startGameBtn.style.cursor = 'not-allowed';
        startGameBtn.innerText = "Waiting for Host to start...";
        if (hostHint) hostHint.style.display = 'block';
    }
}

function updatePlayersList(players) {
    const list = document.getElementById('all-players-list');
    if (!list) return;
    list.innerHTML = "";
    list.style.display = 'flex'; list.style.flexWrap = 'wrap'; list.style.gap = '10px';

    const me = players.find(p => p.id === socket.id);

    players.forEach(p => {
        let dotColor = '#2ed573';
        if (p.team === 'red') dotColor = '#ff4d4d';
        if (p.team === 'blue') dotColor = '#5c8aef';
        if (p.team === 'green') dotColor = '#28a745';

        let roleBadge = '';
        let removeBtnHTML = '';

        if (p.isBot) {
            // Bot ke tags
            roleBadge = '<span style="background:#8e44ad; color:white; font-size:0.7rem; padding:2px 8px; border-radius:12px; font-weight:bold; margin-left:5px;">bot</span>';
            if (me && me.isHost) {
                // Remove button sirf host ke liye
                removeBtnHTML = ` <span class="remove-bot-btn" data-bot="${p.id}" style="color:#ff4d4d; font-size:0.75rem; margin-left:5px; cursor:pointer; text-decoration:none; font-weight:bold;">Remove</span>`;
            }
        } else if (p.isHost) {
            roleBadge = '<span style="background:#1a5c38; color:white; font-size:0.7rem; padding:2px 8px; border-radius:12px; font-weight:bold; margin-left:5px;">host</span>';
        } else {
            roleBadge = '<span style="background:#6c757d; color:white; font-size:0.7rem; padding:2px 8px; border-radius:12px; font-weight:bold; margin-left:5px;">guest</span>';
        }

        const youTag = p.id === socket.id ? ' <span style="font-size:0.8rem; color:#888;">(You)</span>' : '';

        const badgeHtml = `
            <div style="background:#fdf5d3; border:1px solid #e8d087; border-radius:20px; padding:6px 12px; display:inline-flex; align-items:center; gap:8px;">
                <div style="width:12px; height:12px; border-radius:50%; background:${dotColor};"></div>
                <span class="badge-name-container" style="color:#333; font-weight:500; font-size:0.95rem;">${p.name}${youTag}</span>
                ${roleBadge}
                ${removeBtnHTML}
            </div>
        `;
        const row = document.createElement('div');
        row.innerHTML = badgeHtml;
        list.appendChild(row.firstElementChild);
    });

    // ════════ REMOVE BOT LOGIC ════════
    document.querySelectorAll('.remove-bot-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const botId = e.target.getAttribute('data-bot');
            socket.emit('remove-bot', { botId });
        });
    });
}

function updateTeamsUI(players) {
    document.querySelectorAll('.player-slot').forEach(s => { 
        s.innerHTML = "Empty Slot"; s.className = "player-slot empty"; 
        s.style.background = ''; s.style.color = ''; s.style.border = ''; s.style.display = 'block';
    });
    
    const solidColors = { red: '#ff4d4d', blue: '#5c8aef', green: '#2ed573' };
    
    players.forEach(p => {
        if (p.team) {
            const teamContainer = document.getElementById(`slots-${p.team}`);
            const slot = teamContainer ? teamContainer.querySelector('.empty') : null;
            if (slot) {
                slot.className = "player-slot occupied";
                slot.style.background = solidColors[p.team];
                slot.style.color = 'white';
                slot.style.border = 'none';
                
                // YEH CODE DABBE KO PHATNE SE ROKAY GA
                slot.style.display = 'flex';
                slot.style.alignItems = 'center';
                slot.style.width = '100%'; 
                slot.style.boxSizing = 'border-box';
                slot.style.overflow = 'hidden'; 
                
                const roleLabel = p.isBot ? 'BOT' : (p.id === socket.id ? 'YOU' : (p.isHost ? 'HOST' : 'GUEST'));
                
                // Flex aur min-width 0 jaadu karenge
                slot.innerHTML = `
                    <span style="background:rgba(0,0,0,0.3); padding:2px 6px; border-radius:4px; font-size:0.7rem; margin-right:6px; font-weight:bold; flex-shrink:0;">${roleLabel}</span> 
                    <span style="flex:1; min-width:0; text-align:left; letter-spacing:0.5px; font-size:0.9rem; font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.name}</span>
                `;
            }
        }
    });
}

function appendMessage(text, isMe) {
    const chat = document.getElementById('lobby-chat');
    if (!chat) return;
    const placeholder = chat.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();
    const msgDiv = document.createElement('div');
    msgDiv.style.marginBottom = '8px';
    msgDiv.innerHTML = `<b style="color:${isMe ? '#e8d087' : '#6fa8ff'}">${isMe ? 'You' : 'Player'}:</b> <span style="color:#ddd;">${text}</span>`;
    chat.appendChild(msgDiv);
    chat.scrollTop = chat.scrollHeight;
}