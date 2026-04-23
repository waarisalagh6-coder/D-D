// ============================================================
// DungeonNet — Client Game Engine
// Canvas-based 2D world + Socket.IO multiplayer
// ============================================================

const socket = io();

// ---- State ----
let myPlayer = null;         // My own player object
let roomCode = '';           // Current room code
let gameState = {            // Full game state
  players: {},
  enemies: []
};
let selectedAvatar = 0;      // Chosen avatar index
let nearbyEnemy = null;      // Enemy in attack range
let lastRoll = 1;            // Last dice result (for attack)
let narrationTimer = null;   // Timeout to hide narration

// ---- Avatar emoji list ----
const AVATARS = ['🧙', '⚔️', '🏹', '🛡️', '🧝', '🔮', '🪄', '🗡️'];

// ---- Player colors (for canvas rendering) ----
const PLAYER_COLORS = ['#c9a84c','#8ab4c9','#9b7cd0','#27ae60','#e74c3c','#e67e22','#1abc9c','#e91e63'];

// ---- Tile/Map constants ----
const TILE = 32;          // Tile size in pixels
const MAP_W = 30;         // Map width in tiles
const MAP_H = 22;         // Map height in tiles
const CANVAS_W = MAP_W * TILE;  // 960
const CANVAS_H = MAP_H * TILE;  // 704

// ---- Canvas ----
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.width  = CANVAS_W;
canvas.height = CANVAS_H;

// ---- Input state ----
const keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; });
document.addEventListener('keyup',   e => { keys[e.code] = false; });

// ---- Player speed ----
const SPEED = 3;

// ---- Floating texts (damage/heal pop-ups) ----
let floaters = []; // { x, y, text, color, life, maxLife }

// ---- Map: 0 = floor, 1 = wall, 2 = door, 3 = decor ----
// Map is 30x22. Walls on borders + interior rooms
function buildMap() {
  const map = [];
  for (let r = 0; r < MAP_H; r++) {
    map[r] = [];
    for (let c = 0; c < MAP_W; c++) {
      // Border walls
      if (r === 0 || r === MAP_H-1 || c === 0 || c === MAP_W-1) {
        map[r][c] = 1;
      } else {
        map[r][c] = 0;
      }
    }
  }

  // Add interior walls / rooms
  const walls = [
    // Room 1 (top-left)
    ...range(1,8).map(c => [4, c]),
    ...range(1,4).map(r => [r, 8]),
    // Room 2 (top-right)
    ...range(21,29).map(c => [4, c]),
    ...range(1,4).map(r => [r, 21]),
    // Room 3 (bottom-left)
    ...range(1,8).map(c => [17, c]),
    ...range(17,21).map(r => [r, 8]),
    // Room 4 (bottom-right)
    ...range(21,29).map(c => [17, c]),
    ...range(17,21).map(r => [r, 21]),
    // Center corridors
    ...range(7,15).map(r => [r, 14]),
    ...range(7,23).map(c => [10, c]),
  ];

  // Apply walls, leave doorways by skipping every 4th
  walls.forEach(([r, c]) => {
    if (r >= 0 && r < MAP_H && c >= 0 && c < MAP_W) {
      map[r][c] = 1;
    }
  });

  // Doorways (punch holes in walls)
  const doors = [
    [4,4],[4,25],[17,4],[17,25],
    [2,8],[7,14],[10,7],[10,22],
    [13,14],[10,17]
  ];
  doors.forEach(([r, c]) => {
    if (r >= 0 && r < MAP_H && c >= 0 && c < MAP_W) {
      map[r][c] = 2; // door tile (passable)
    }
  });

  // Decorative torches/rugs
  const decors = [[2,2],[2,27],[20,2],[20,27],[11,7],[11,22]];
  decors.forEach(([r, c]) => { map[r][c] = 3; });

  return map;
}

function range(a, b) {
  const arr = [];
  for (let i = a; i < b; i++) arr.push(i);
  return arr;
}

const MAP = buildMap();

// Helper: is a pixel position (cx, cy) walkable?
function isWalkable(px, py) {
  // Check all four corners of the player's bounding box (12px radius)
  const R = 10;
  const corners = [
    [px - R, py - R], [px + R, py - R],
    [px - R, py + R], [px + R, py + R]
  ];
  for (const [x, y] of corners) {
    const col = Math.floor(x / TILE);
    const row = Math.floor(y / TILE);
    if (col < 0 || col >= MAP_W || row < 0 || row >= MAP_H) return false;
    if (MAP[row][col] === 1) return false;
  }
  return true;
}

// ============================================================
//  DRAW MAP
// ============================================================
function drawMap() {
  for (let r = 0; r < MAP_H; r++) {
    for (let c = 0; c < MAP_W; c++) {
      const x = c * TILE, y = r * TILE;
      const t = MAP[r][c];

      if (t === 1) {
        // Wall
        ctx.fillStyle = '#1a1424';
        ctx.fillRect(x, y, TILE, TILE);
        // Subtle bevel
        ctx.fillStyle = '#251f35';
        ctx.fillRect(x, y, TILE, 3);
        ctx.fillRect(x, y, 3, TILE);
        ctx.fillStyle = '#110d1a';
        ctx.fillRect(x, y + TILE - 3, TILE, 3);
        ctx.fillRect(x + TILE - 3, y, 3, TILE);
      } else if (t === 0 || t === 2) {
        // Floor
        ctx.fillStyle = (r + c) % 2 === 0 ? '#141020' : '#110e1c';
        ctx.fillRect(x, y, TILE, TILE);
        if (t === 2) {
          // Door hint
          ctx.fillStyle = 'rgba(201,168,76,0.15)';
          ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        }
      } else if (t === 3) {
        // Decor: torch
        ctx.fillStyle = '#141020';
        ctx.fillRect(x, y, TILE, TILE);
        ctx.font = '20px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🔥', x + TILE/2, y + TILE/2);
      }
    }
  }
}

// ============================================================
//  DRAW ENEMIES
// ============================================================
function drawEnemies() {
  gameState.enemies.forEach(enemy => {
    const ex = enemy.x, ey = enemy.y;
    const hpPct = enemy.hp / enemy.maxHp;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(ex, ey + enemy.size/2 - 4, enemy.size/2 - 2, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body circle
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(ex, ey, enemy.size/2, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Enemy icon
    const icons = { goblin:'👺', skeleton:'💀', troll:'👾', dragon:'🐉' };
    ctx.font = `${enemy.size * 0.7}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icons[enemy.type] || '👾', ex, ey);

    // HP bar
    const barW = 36, barH = 5;
    ctx.fillStyle = '#1a0a0a';
    ctx.fillRect(ex - barW/2, ey - enemy.size/2 - 10, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#27ae60' : hpPct > 0.25 ? '#e6a817' : '#c0392b';
    ctx.fillRect(ex - barW/2, ey - enemy.size/2 - 10, barW * hpPct, barH);

    // Name
    ctx.fillStyle = '#e8e0f0';
    ctx.font = '9px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(enemy.name, ex, ey - enemy.size/2 - 12);
  });
}

// ============================================================
//  DRAW PLAYERS
// ============================================================
function drawPlayers() {
  Object.values(gameState.players).forEach((p, i) => {
    const px = p.x, py = p.y;
    const isMe = p.id === (myPlayer && myPlayer.id);
    const color = PLAYER_COLORS[i % PLAYER_COLORS.length];

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(px, py + 14, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body circle
    ctx.fillStyle = isMe ? color : color + '99';
    ctx.beginPath();
    ctx.arc(px, py, 16, 0, Math.PI * 2);
    ctx.fill();

    // Glow if it's me
    if (isMe) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Avatar emoji
    ctx.font = '18px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(AVATARS[p.avatar || 0], px, py);

    // DM crown indicator
    if (p.isDM) {
      ctx.font = '12px serif';
      ctx.fillText('👑', px, py - 22);
    }

    // Name tag
    ctx.fillStyle = isMe ? color : '#e8e0f0';
    ctx.font = `bold 9px Cinzel, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(p.name, px, py - 20);

    // HP bar
    const hpPct = p.hp / p.maxHp;
    const barW = 32, barH = 4;
    ctx.fillStyle = '#1a0a0a';
    ctx.fillRect(px - barW/2, py + 20, barW, barH);
    ctx.fillStyle = hpPct > 0.5 ? '#27ae60' : hpPct > 0.25 ? '#e6a817' : '#c0392b';
    ctx.fillRect(px - barW/2, py + 20, barW * hpPct, barH);
  });
}

// ============================================================
//  DRAW FLOATERS
// ============================================================
function drawFloaters() {
  floaters = floaters.filter(f => f.life > 0);
  floaters.forEach(f => {
    const alpha = f.life / f.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.color;
    ctx.font = 'bold 14px Cinzel, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(f.text, f.x, f.y);
    f.y -= 1;
    f.life -= 1;
  });
  ctx.globalAlpha = 1;
}

// ============================================================
//  GAME LOOP
// ============================================================
let lastMoveEmit = 0;

function gameLoop() {
  requestAnimationFrame(gameLoop);
  if (!myPlayer) return;

  // -- Handle Movement --
  let dx = 0, dy = 0;
  if (keys['ArrowLeft']  || keys['KeyA']) dx = -SPEED;
  if (keys['ArrowRight'] || keys['KeyD']) dx =  SPEED;
  if (keys['ArrowUp']    || keys['KeyW']) dy = -SPEED;
  if (keys['ArrowDown']  || keys['KeyS']) dy =  SPEED;

  // Diagonal normalization
  if (dx !== 0 && dy !== 0) {
    dx = dx * 0.707;
    dy = dy * 0.707;
  }

  if (dx !== 0 || dy !== 0) {
    const newX = myPlayer.x + dx;
    const newY = myPlayer.y + dy;

    if (isWalkable(newX, myPlayer.y)) myPlayer.x = newX;
    if (isWalkable(myPlayer.x, newY)) myPlayer.y = newY;

    // Sync to server (throttle to ~30/s)
    const now = Date.now();
    if (now - lastMoveEmit > 33) {
      socket.emit('playerMove', { x: myPlayer.x, y: myPlayer.y, dir: dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down' });
      lastMoveEmit = now;
      // Update local state
      if (gameState.players[myPlayer.id]) {
        gameState.players[myPlayer.id].x = myPlayer.x;
        gameState.players[myPlayer.id].y = myPlayer.y;
      }
    }
  }

  // -- Check nearby enemy --
  nearbyEnemy = null;
  const attackRange = 60;
  for (const enemy of gameState.enemies) {
    const dist = Math.hypot(enemy.x - myPlayer.x, enemy.y - myPlayer.y);
    if (dist < attackRange) { nearbyEnemy = enemy; break; }
  }
  updateNearbyEnemyUI();

  // -- Draw --
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawMap();
  drawEnemies();
  drawPlayers();
  drawFloaters();
}

// ============================================================
//  UI HELPERS
// ============================================================
function updateNearbyEnemyUI() {
  const wrap = document.getElementById('nearby-enemy-wrap');
  if (nearbyEnemy) {
    wrap.classList.remove('hidden');
    document.getElementById('nearby-enemy-name').textContent =
      `${nearbyEnemy.name} (${nearbyEnemy.hp}/${nearbyEnemy.maxHp} HP)`;
  } else {
    wrap.classList.add('hidden');
  }
}

function updateHpBar(hp, maxHp) {
  const pct = hp / maxHp;
  const bar = document.getElementById('my-hp-bar');
  const txt = document.getElementById('my-hp-text');
  bar.style.width = (pct * 100) + '%';
  bar.className = 'stat-bar-fill' + (pct < 0.25 ? ' low' : pct < 0.5 ? ' medium' : '');
  txt.textContent = `${hp}/${maxHp}`;
}

function updatePlayerListBar() {
  const bar = document.getElementById('player-list-bar');
  bar.innerHTML = '';
  Object.values(gameState.players).forEach((p, i) => {
    const badge = document.createElement('div');
    badge.className = 'player-badge' + (p.isDM ? ' is-dm' : '');
    const hpPct = p.hp / p.maxHp;
    badge.innerHTML = `
      <span>${AVATARS[p.avatar || 0]}</span>
      <span>${p.isDM ? '👑 ' : ''}${p.name}</span>
      <span class="badge-hp ${hpPct < 0.4 ? 'low' : ''}">${p.hp}❤️</span>
    `;
    bar.appendChild(badge);
  });
}

function updateDMPlayerTargets() {
  const container = document.getElementById('dm-player-targets');
  container.innerHTML = '';
  Object.values(gameState.players).forEach(p => {
    if (p.isDM) return;
    const btn = document.createElement('button');
    btn.className = 'dm-attack-btn';
    btn.innerHTML = `<span>${AVATARS[p.avatar||0]} ${p.name} (${p.hp}❤️)</span><span>⚔️</span>`;
    btn.onclick = () => socket.emit('dmAttackPlayer', { targetId: p.id });
    container.appendChild(btn);
  });
}

function addChatMessage(msg) {
  const log = document.getElementById('chat-log');
  const div = document.createElement('div');
  div.className = `chat-msg ${msg.type || 'player'}`;

  if (msg.type === 'system') {
    div.innerHTML = `<span class="msg-text">${escHtml(msg.text)}</span>`;
  } else {
    div.innerHTML = `<span class="msg-sender">${escHtml(msg.sender)}:</span><span class="msg-text">${escHtml(msg.text)}</span>`;
  }

  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showDiceResult(data) {
  const overlay = document.getElementById('dice-overlay');
  const numEl   = document.getElementById('dice-number');
  const labelEl = document.getElementById('dice-label');
  const rollerEl= document.getElementById('dice-roller');

  numEl.textContent = data.result;

  if (data.isCrit) {
    numEl.style.color = '#f1c40f';
    labelEl.textContent = '⚡ CRITICAL HIT!';
    labelEl.style.color = '#f1c40f';
  } else if (data.isFail) {
    numEl.style.color = '#e74c3c';
    labelEl.textContent = '💀 Critical Fail!';
    labelEl.style.color = '#e74c3c';
  } else {
    numEl.style.color = 'var(--gold)';
    labelEl.textContent = `D${data.sides} Roll`;
    labelEl.style.color = 'var(--text)';
  }

  rollerEl.textContent = `by ${data.roller}${data.reason ? ' — ' + data.reason : ''}`;
  overlay.classList.remove('hidden');
  playDiceSound();

  // Auto-hide after 3s
  setTimeout(() => overlay.classList.add('hidden'), 3000);
  overlay.onclick = () => overlay.classList.add('hidden');
}

function addFloater(x, y, text, color) {
  floaters.push({ x, y: y - 20, text, color, life: 60, maxLife: 60 });
}

function playDiceSound() {
  // Web Audio API dice roll sound
  try {
    const ctx2 = new (window.AudioContext || window.webkitAudioContext)();
    const clicks = [0, 0.04, 0.08, 0.12, 0.16];
    clicks.forEach(time => {
      const buf = ctx2.createBuffer(1, 512, ctx2.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < 512; i++) data[i] = (Math.random() * 2 - 1) * (1 - i/512);
      const src = ctx2.createBufferSource();
      src.buffer = buf;
      const gain = ctx2.createGain();
      gain.gain.value = 0.18;
      src.connect(gain); gain.connect(ctx2.destination);
      src.start(ctx2.currentTime + time);
    });
  } catch(e) {}
}

// ============================================================
//  LOBBY SETUP
// ============================================================
function setupLobby() {
  // Render avatars
  const row = document.getElementById('avatar-row');
  AVATARS.forEach((emoji, i) => {
    const el = document.createElement('div');
    el.className = 'avatar-opt' + (i === 0 ? ' active' : '');
    el.textContent = emoji;
    el.onclick = () => {
      selectedAvatar = i;
      row.querySelectorAll('.avatar-opt').forEach(a => a.classList.remove('active'));
      el.classList.add('active');
    };
    row.appendChild(el);
  });

  // Room code input — uppercase
  const codeInput = document.getElementById('room-code-input');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase();
  });

  // Create room
  document.getElementById('btn-create').onclick = () => {
    const name = document.getElementById('player-name').value.trim() || 'Dungeon Master';
    socket.emit('createRoom', { playerName: name, avatar: selectedAvatar });
  };

  // Join room
  document.getElementById('btn-join').onclick = () => {
    const name = document.getElementById('player-name').value.trim() || 'Adventurer';
    const code = codeInput.value.trim().toUpperCase();
    if (!code) { showLobbyError('Enter a room code!'); return; }
    socket.emit('joinRoom', { roomCode: code, playerName: name, avatar: selectedAvatar });
  };

  // Enter key
  document.getElementById('player-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create').click();
  });
  codeInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join').click();
  });
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ============================================================
//  GAME SETUP (called after joining a room)
// ============================================================
function startGame(player, room, code) {
  myPlayer = player;
  roomCode = code;
  gameState.players = room.players;
  gameState.enemies = room.enemies;

  // Show game screen
  document.getElementById('lobby-screen').classList.remove('active');
  document.getElementById('lobby-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');
  document.getElementById('game-screen').classList.add('active');

  // Room code
  document.getElementById('room-code-display').textContent = roomCode;

  // Role badge
  const roleBadge = document.getElementById('my-role-badge');
  roleBadge.textContent = player.isDM ? '👑 Dungeon Master' : '⚔️ Adventurer';

  // Show DM panel if DM
  if (player.isDM) {
    document.getElementById('dm-panel').classList.remove('hidden');
  }

  // HP bar
  updateHpBar(player.hp, player.maxHp);
  updatePlayerListBar();

  // Load existing chat
  room.chatLog.forEach(msg => addChatMessage(msg));

  // Copy room code button
  document.getElementById('btn-copy-code').onclick = () => {
    navigator.clipboard.writeText(roomCode).catch(() => {});
    document.getElementById('btn-copy-code').textContent = '✅';
    setTimeout(() => document.getElementById('btn-copy-code').textContent = '📋', 1500);
  };

  // Start game loop
  gameLoop();
}

// ============================================================
//  GAME UI EVENTS
// ============================================================
function setupGameEvents() {
  // Chat send
  const sendChat = () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('chatMessage', { text });
    input.value = '';
  };
  document.getElementById('btn-chat-send').onclick = sendChat;
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  // Roll D20
  document.getElementById('btn-roll-d20').onclick = () => {
    socket.emit('rollDice', { sides: 20, reason: '' });
  };

  // Heal self
  document.getElementById('btn-heal-self').onclick = () => {
    socket.emit('healPlayer', {});
  };

  // Attack enemy
  document.getElementById('btn-attack').onclick = () => {
    if (!nearbyEnemy) return;
    // Roll first, then attack
    const roll = Math.floor(Math.random() * 20) + 1;
    lastRoll = roll;
    socket.emit('rollDice', { sides: 20, reason: `Attack on ${nearbyEnemy.name}` });
    // Attack after short delay (show dice first)
    setTimeout(() => {
      socket.emit('attackEnemy', { enemyId: nearbyEnemy.id, roll });
    }, 600);
  };

  // DM: Send narration
  document.getElementById('btn-send-narration').onclick = () => {
    const input = document.getElementById('dm-narration-input');
    const text = input.value.trim();
    if (!text) return;
    socket.emit('dmNarration', { text });
    input.value = '';
  };

  // DM: Spawn enemy
  document.querySelectorAll('.btn-enemy').forEach(btn => {
    btn.onclick = () => socket.emit('spawnEnemy', { type: btn.dataset.type });
  });
}

// ============================================================
//  SOCKET EVENTS
// ============================================================

// Room created (you are DM)
socket.on('roomCreated', ({ roomCode, player, room }) => {
  startGame(player, room, roomCode);
  setupGameEvents();
  addChatMessage({ sender: 'SYSTEM', text: `⚔️ Room created! Share code: ${roomCode}`, type: 'system' });
});

// Room joined
socket.on('roomJoined', ({ roomCode, player, room }) => {
  startGame(player, room, roomCode);
  setupGameEvents();
});

// Another player joined
socket.on('playerJoined', ({ player }) => {
  gameState.players[player.id] = player;
  updatePlayerListBar();
  if (myPlayer && myPlayer.isDM) updateDMPlayerTargets();
});

// Another player moved
socket.on('playerMoved', ({ id, x, y, dir }) => {
  if (gameState.players[id]) {
    gameState.players[id].x = x;
    gameState.players[id].y = y;
    gameState.players[id].dir = dir;
  }
});

// Player left
socket.on('playerLeft', ({ id, name }) => {
  delete gameState.players[id];
  updatePlayerListBar();
  if (myPlayer && myPlayer.isDM) updateDMPlayerTargets();
});

// Chat message
socket.on('chatMessage', (msg) => {
  addChatMessage(msg);
});

// Dice result
socket.on('diceResult', (data) => {
  showDiceResult(data);
});

// DM Narration
socket.on('narration', ({ text }) => {
  const bar = document.getElementById('narration-bar');
  document.getElementById('narration-text').textContent = text;
  bar.classList.remove('hidden');
  clearTimeout(narrationTimer);
  narrationTimer = setTimeout(() => bar.classList.add('hidden'), 8000);
});

// Enemy spawned
socket.on('enemySpawned', ({ enemy }) => {
  gameState.enemies.push(enemy);
});

// Enemy hit
socket.on('enemyHit', ({ enemyId, hp, maxHp, damage, attackerName }) => {
  const enemy = gameState.enemies.find(e => e.id === enemyId);
  if (enemy) {
    enemy.hp = hp;
    enemy.maxHp = maxHp;
    addFloater(enemy.x, enemy.y, `-${damage}`, '#e74c3c');
  }
});

// Enemy defeated
socket.on('enemyDefeated', ({ enemyId }) => {
  gameState.enemies = gameState.enemies.filter(e => e.id !== enemyId);
});

// Player damaged
socket.on('playerDamaged', ({ id, hp, maxHp, damage }) => {
  if (gameState.players[id]) {
    gameState.players[id].hp = hp;
    gameState.players[id].maxHp = maxHp;
    addFloater(gameState.players[id].x, gameState.players[id].y, `-${damage}`, '#e74c3c');

    if (id === myPlayer?.id) {
      myPlayer.hp = hp;
      updateHpBar(hp, maxHp);
    }
    updatePlayerListBar();
  }
});

// Player healed
socket.on('playerHealed', ({ id, hp, maxHp, healAmt }) => {
  if (gameState.players[id]) {
    gameState.players[id].hp = hp;
    gameState.players[id].maxHp = maxHp;
    addFloater(gameState.players[id].x, gameState.players[id].y, `+${healAmt}`, '#27ae60');

    if (id === myPlayer?.id) {
      myPlayer.hp = hp;
      updateHpBar(hp, maxHp);
    }
    updatePlayerListBar();
  }
});

// Server error
socket.on('error', ({ message }) => {
  if (document.getElementById('lobby-screen').classList.contains('active')) {
    showLobbyError(message);
  } else {
    addChatMessage({ sender: 'SYSTEM', text: `❌ ${message}`, type: 'system' });
  }
});

// ============================================================
//  INIT
// ============================================================
setupLobby();
