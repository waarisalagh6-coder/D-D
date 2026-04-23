// ============================================================
// DnD Multiplayer Server - Node.js + Express + Socket.IO
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// ---- Game State ----
// rooms: { [roomCode]: { players: {}, enemies: [], chatLog: [], map: {} } }
const rooms = {};

// ---- Helper: generate a 6-char room code ----
function generateRoomCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// ---- Helper: get or create room ----
function getRoom(roomCode) {
  if (!rooms[roomCode]) {
    rooms[roomCode] = {
      players: {},
      enemies: [],
      chatLog: [],
      nextEnemyId: 1
    };
  }
  return rooms[roomCode];
}

// ---- Helper: pick a spawn tile (avoiding walls) ----
function randomSpawn() {
  // The map is 30x22 tiles, walls are the border
  return {
    x: 64 + Math.floor(Math.random() * 28) * 32,
    y: 64 + Math.floor(Math.random() * 20) * 32
  };
}

// ---- Socket.IO Events ----
io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // -- CREATE ROOM --
  socket.on('createRoom', ({ playerName, avatar }) => {
    const roomCode = generateRoomCode();
    const room = getRoom(roomCode);
    const spawn = randomSpawn();

    const player = {
      id: socket.id,
      name: playerName || 'Hero',
      avatar: avatar || 0,
      x: spawn.x,
      y: spawn.y,
      hp: 20,
      maxHp: 20,
      isDM: true,   // Creator is the Dungeon Master
      role: 'DM'
    };

    room.players[socket.id] = player;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    socket.emit('roomCreated', { roomCode, player, room: serializeRoom(room) });
    console.log(`[ROOM] Created: ${roomCode} by ${playerName}`);
  });

  // -- JOIN ROOM --
  socket.on('joinRoom', ({ roomCode, playerName, avatar }) => {
    const room = rooms[roomCode];
    if (!room) {
      socket.emit('error', { message: 'Room not found! Check your code.' });
      return;
    }
    if (Object.keys(room.players).length >= 8) {
      socket.emit('error', { message: 'Room is full (max 8 players).' });
      return;
    }

    const spawn = randomSpawn();
    const player = {
      id: socket.id,
      name: playerName || 'Adventurer',
      avatar: avatar || Math.floor(Math.random() * 5),
      x: spawn.x,
      y: spawn.y,
      hp: 20,
      maxHp: 20,
      isDM: false,
      role: 'Player'
    };

    room.players[socket.id] = player;
    socket.join(roomCode);
    socket.roomCode = roomCode;

    // Tell joiner their state
    socket.emit('roomJoined', { roomCode, player, room: serializeRoom(room) });

    // Tell everyone else a new player joined
    socket.to(roomCode).emit('playerJoined', { player });

    // Broadcast chat notice
    io.to(roomCode).emit('chatMessage', {
      sender: 'SYSTEM',
      text: `⚔️ ${player.name} has joined the adventure!`,
      type: 'system'
    });

    console.log(`[ROOM] ${playerName} joined ${roomCode}`);
  });

  // -- PLAYER MOVEMENT --
  socket.on('playerMove', ({ x, y, dir }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    room.players[socket.id].x = x;
    room.players[socket.id].y = y;
    room.players[socket.id].dir = dir;

    // Broadcast to all other players in the room
    socket.to(socket.roomCode).emit('playerMoved', {
      id: socket.id,
      x, y, dir
    });
  });

  // -- CHAT MESSAGE --
  socket.on('chatMessage', ({ text }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    const msg = {
      sender: player.name,
      text: text.substring(0, 200), // Limit message length
      type: player.isDM ? 'dm' : 'player',
      id: socket.id
    };

    room.chatLog.push(msg);
    if (room.chatLog.length > 100) room.chatLog.shift(); // Keep log size

    io.to(socket.roomCode).emit('chatMessage', msg);
  });

  // -- DICE ROLL --
  socket.on('rollDice', ({ sides = 20, reason = '' }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    const result = Math.floor(Math.random() * sides) + 1;
    const isCrit = sides === 20 && result === 20;
    const isFail = sides === 20 && result === 1;

    const rollData = {
      roller: player.name,
      rollerId: socket.id,
      sides,
      result,
      reason,
      isCrit,
      isFail,
      timestamp: Date.now()
    };

    io.to(socket.roomCode).emit('diceResult', rollData);
    console.log(`[DICE] ${player.name} rolled d${sides}: ${result}`);
  });

  // -- DM: SEND STORY TEXT --
  socket.on('dmNarration', ({ text }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    if (!room.players[socket.id].isDM) return; // Only DM

    io.to(socket.roomCode).emit('narration', {
      text: text.substring(0, 500),
      timestamp: Date.now()
    });
  });

  // -- DM: SPAWN ENEMY --
  socket.on('spawnEnemy', ({ type }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    if (!room.players[socket.id].isDM) return;

    const enemyTypes = {
      goblin:   { name: 'Goblin',   hp: 7,  maxHp: 7,  color: '#4caf50', size: 24, atk: 4 },
      skeleton: { name: 'Skeleton', hp: 13, maxHp: 13, color: '#e0e0e0', size: 28, atk: 6 },
      dragon:   { name: 'Dragon',   hp: 30, maxHp: 30, color: '#f44336', size: 40, atk: 12 },
      troll:    { name: 'Troll',    hp: 20, maxHp: 20, color: '#8bc34a', size: 34, atk: 8 }
    };

    const base = enemyTypes[type] || enemyTypes.goblin;
    const spawn = randomSpawn();
    const enemy = {
      id: `enemy_${room.nextEnemyId++}`,
      ...base,
      type,
      x: spawn.x,
      y: spawn.y
    };

    room.enemies.push(enemy);
    io.to(socket.roomCode).emit('enemySpawned', { enemy });
    io.to(socket.roomCode).emit('chatMessage', {
      sender: 'SYSTEM',
      text: `👾 The DM summoned a ${enemy.name}!`,
      type: 'system'
    });
  });

  // -- ATTACK ENEMY --
  socket.on('attackEnemy', ({ enemyId, roll }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    const enemy = room.enemies.find(e => e.id === enemyId);
    if (!enemy) return;

    const player = room.players[socket.id];
    // Damage = roll / 4 (min 1)
    const damage = Math.max(1, Math.floor(roll / 4));
    enemy.hp = Math.max(0, enemy.hp - damage);

    io.to(socket.roomCode).emit('enemyHit', {
      enemyId,
      hp: enemy.hp,
      maxHp: enemy.maxHp,
      damage,
      attackerName: player.name
    });

    if (enemy.hp <= 0) {
      room.enemies = room.enemies.filter(e => e.id !== enemyId);
      io.to(socket.roomCode).emit('enemyDefeated', { enemyId, enemyName: enemy.name, killerName: player.name });
      io.to(socket.roomCode).emit('chatMessage', {
        sender: 'SYSTEM',
        text: `💀 ${player.name} defeated the ${enemy.name}!`,
        type: 'system'
      });
    }
  });

  // -- TAKE DAMAGE (enemy attacks player) - triggered by DM --
  socket.on('dmAttackPlayer', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;
    if (!room.players[socket.id].isDM) return;

    const target = room.players[targetId];
    if (!target) return;

    const damage = Math.floor(Math.random() * 8) + 1;
    target.hp = Math.max(0, target.hp - damage);

    io.to(socket.roomCode).emit('playerDamaged', {
      id: targetId,
      hp: target.hp,
      maxHp: target.maxHp,
      damage
    });

    if (target.hp <= 0) {
      io.to(socket.roomCode).emit('chatMessage', {
        sender: 'SYSTEM',
        text: `💔 ${target.name} has been knocked out!`,
        type: 'system'
      });
    }
  });

  // -- HEAL PLAYER (DM or self) --
  socket.on('healPlayer', ({ targetId }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];
    // DM can heal anyone; players can only heal themselves
    const effectiveTarget = player.isDM ? (targetId || socket.id) : socket.id;
    const target = room.players[effectiveTarget];
    if (!target) return;

    const healAmt = Math.floor(Math.random() * 8) + 2;
    target.hp = Math.min(target.maxHp, target.hp + healAmt);

    io.to(socket.roomCode).emit('playerHealed', {
      id: effectiveTarget,
      hp: target.hp,
      maxHp: target.maxHp,
      healAmt
    });

    io.to(socket.roomCode).emit('chatMessage', {
      sender: 'SYSTEM',
      text: `✨ ${target.name} was healed for ${healAmt} HP!`,
      type: 'system'
    });
  });

  // -- DISCONNECT --
  socket.on('disconnect', () => {
    const room = rooms[socket.roomCode];
    if (room && room.players[socket.id]) {
      const player = room.players[socket.id];
      delete room.players[socket.id];

      io.to(socket.roomCode).emit('playerLeft', { id: socket.id, name: player.name });
      io.to(socket.roomCode).emit('chatMessage', {
        sender: 'SYSTEM',
        text: `🚪 ${player.name} has left the dungeon.`,
        type: 'system'
      });

      // Clean up empty rooms
      if (Object.keys(room.players).length === 0) {
        delete rooms[socket.roomCode];
        console.log(`[ROOM] Deleted empty room: ${socket.roomCode}`);
      }
    }
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

// -- Serialize room for sending to client --
function serializeRoom(room) {
  return {
    players: room.players,
    enemies: room.enemies,
    chatLog: room.chatLog.slice(-50)
  };
}

// -- Start server --
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎲 D&D Multiplayer Server running on http://localhost:${PORT}\n`);
});
