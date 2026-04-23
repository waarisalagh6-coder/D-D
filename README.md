# ⚔️ DungeonNet — 2D Multiplayer D&D Browser Game

A real-time multiplayer Dungeons & Dragons inspired browser game built with Node.js, Express, Socket.IO, and Canvas.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
cd dnd-multiplayer
npm install
```

### 2. Start the server
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

### 3. Open your browser
Navigate to: **http://localhost:3000**

---

## 🎮 How to Play

### Starting a Session
1. **Player 1** (Dungeon Master): Enter your name, choose an avatar, click **"Create Room"**
2. Share the 6-character room code with friends
3. **Other players**: Enter the room code and click **"Join Room"**
4. Up to **8 players** can join a room

### Controls
| Key | Action |
|-----|--------|
| `W` / `↑` | Move Up |
| `A` / `←` | Move Left |
| `S` / `↓` | Move Down |
| `D` / `→` | Move Right |

### Player Actions
- **🎲 Roll D20** — Roll a dice; result is shown to all players
- **💚 Heal Self** — Restore some HP (random 2–9 HP)
- **⚔️ Attack** — Appears when you're near an enemy; rolls dice and deals damage

### Dungeon Master Powers (First Player Only)
- **📜 Narration** — Type a story message and "Send to All"; it appears at the bottom of the game screen for all players
- **👾 Spawn Enemy** — Summon Goblins, Skeletons, Trolls, or Dragons on the map
- **⚔️ Attack Player** — Strike any player for random damage (1–8)

### Chat
- Real-time chat on the right panel
- DM messages are highlighted in gold
- System events are shown in teal

---

## 🗂 Project Structure

```
dnd-multiplayer/
├── server.js          # Node.js server — Express + Socket.IO game logic
├── package.json       # Dependencies
├── README.md          # This file
└── public/
    ├── index.html     # Game UI (Lobby + Game screen)
    ├── style.css      # Dark medieval theme styling
    └── client.js      # Canvas engine + Socket.IO client
```

---

## 🧱 Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Realtime | Socket.IO v4 |
| Frontend | Vanilla HTML/CSS/JS |
| Rendering | HTML5 Canvas 2D |
| Audio | Web Audio API |

---

## 🔧 Configuration

- **Port**: Default `3000`. Override with `PORT=8080 npm start`
- **Max players per room**: 8 (configurable in `server.js`)

---

## 🎯 Features

- ✅ Multiplayer rooms with join codes
- ✅ Real-time player movement (smooth, collision-aware)
- ✅ Dungeon Master role with special controls
- ✅ D20 dice system with critical hit/fail detection
- ✅ Enemy spawn system (Goblin, Skeleton, Troll, Dragon)
- ✅ Attack system with HP bars
- ✅ Real-time chat with role-based highlighting
- ✅ DM Narration overlay
- ✅ Floating damage/heal numbers
- ✅ Procedural tile map with rooms and corridors
- ✅ Web Audio dice roll sound
- ✅ Player HP tracking + visual bars
