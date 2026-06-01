// ============================================
// OVERCOOKED MULTIPLAYER - Game Server
// ============================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// ============================================
// HTTP Server (serves static files)
// ============================================
const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;
    // Remove query string
    filePath = filePath.split('?')[0];
    const fullPath = path.join(__dirname, 'public', filePath);
    const ext = path.extname(fullPath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(fullPath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

// ============================================
// WebSocket Server
// ============================================
const wss = new WebSocketServer({ server });

// Game constants
const COLS = 12;
const ROWS = 8;
const TILE_SIZE = 64;
const TICK_RATE = 20; // 20 updates per second

const TILE = {
    FLOOR: 0, WALL: 1, COUNTER: 2, STOVE: 3,
    INGREDIENT_TOMATO: 4, INGREDIENT_LETTUCE: 5, INGREDIENT_MEAT: 6,
    CUTTING_BOARD: 7, PLATE_STACK: 8, SERVING: 9, TRASH: 10
};

const MAP = [
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    [1, 4, 5, 6, 2, 2, 2, 8, 2, 7, 7, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [1, 3, 3, 3, 2, 10, 2, 2, 9, 9, 9, 1],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
];

const RECIPES = {
    'salad': { ingredients: ['chopped_tomato', 'chopped_lettuce'], points: 20 },
    'burger': { ingredients: ['cooked_meat', 'chopped_lettuce', 'chopped_tomato'], points: 40 },
    'soup': { ingredients: ['chopped_tomato', 'chopped_tomato', 'cooked_meat'], points: 35 },
};

const PLAYER_COLORS = ['#4fc3f7', '#ff7043', '#66bb6a', '#ab47bc'];
const SPAWN_POSITIONS = [
    { x: 3, y: 3 }, { x: 8, y: 4 }, { x: 3, y: 4 }, { x: 8, y: 3 }
];

// Room management
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function createRoom(hostWs) {
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();

    const room = {
        code,
        players: [],
        worldItems: [],
        orders: [],
        score: 0,
        timeLeft: 120,
        gameRunning: false,
        orderTimer: 0,
        nextOrderTime: 5,
        tickInterval: null,
    };
    rooms.set(code, room);
    return room;
}

function addPlayerToRoom(room, ws) {
    const index = room.players.length;
    const spawn = SPAWN_POSITIONS[index % SPAWN_POSITIONS.length];
    const player = {
        id: index,
        ws,
        x: spawn.x * TILE_SIZE + TILE_SIZE / 2,
        y: spawn.y * TILE_SIZE + TILE_SIZE / 2,
        facing: { x: 0, y: 1 },
        holding: null,
        color: PLAYER_COLORS[index % PLAYER_COLORS.length],
        input: { dx: 0, dy: 0, interact: false, drop: false },
        name: `Chef ${index + 1}`,
    };
    room.players.push(player);
    ws.playerIndex = index;
    ws.roomCode = room.code;
    return player;
}

function removePlayerFromRoom(room, ws) {
    const idx = room.players.findIndex(p => p.ws === ws);
    if (idx !== -1) {
        room.players.splice(idx, 1);
        // Reassign indices
        room.players.forEach((p, i) => {
            p.id = i;
            p.ws.playerIndex = i;
        });
    }
    if (room.players.length === 0) {
        stopRoom(room);
        rooms.delete(room.code);
    } else {
        broadcastState(room);
        broadcastLobby(room);
    }
}

function broadcastLobby(room) {
    const msg = JSON.stringify({
        type: 'lobby',
        code: room.code,
        players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color })),
        gameRunning: room.gameRunning,
    });
    for (const p of room.players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
    }
}

function broadcastState(room) {
    const state = {
        type: 'state',
        players: room.players.map(p => ({
            id: p.id, x: p.x, y: p.y,
            facing: p.facing, holding: p.holding,
            color: p.color, name: p.name,
        })),
        worldItems: room.worldItems.map(wi => ({
            gridX: wi.gridX, gridY: wi.gridY, item: wi.item,
            chopping: wi.chopping || false, chopTimer: wi.chopTimer || 0,
            cooking: wi.cooking || false, cookTimer: wi.cookTimer || 0,
            burning: wi.burning || false, burnTimer: wi.burnTimer || 0,
        })),
        orders: room.orders.map(o => ({ recipe: o.recipe, timeLeft: o.timeLeft })),
        score: room.score,
        timeLeft: room.timeLeft,
        gameRunning: room.gameRunning,
    };
    const msg = JSON.stringify(state);
    for (const p of room.players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
    }
}

// ============================================
// GAME LOGIC (server-authoritative)
// ============================================

function getTile(gx, gy) {
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return TILE.WALL;
    return MAP[gy][gx];
}

function isWalkable(gx, gy) {
    return getTile(gx, gy) === TILE.FLOOR;
}

function canMoveTo(x, y, half) {
    const corners = [
        { x: x - half, y: y - half },
        { x: x + half, y: y - half },
        { x: x - half, y: y + half },
        { x: x + half, y: y + half },
    ];
    for (const c of corners) {
        const gx = Math.floor(c.x / TILE_SIZE);
        const gy = Math.floor(c.y / TILE_SIZE);
        if (!isWalkable(gx, gy)) return false;
    }
    return true;
}

function getWorldItem(room, gx, gy) {
    return room.worldItems.find(i => i.gridX === gx && i.gridY === gy);
}

function removeWorldItem(room, gx, gy) {
    room.worldItems = room.worldItems.filter(i => !(i.gridX === gx && i.gridY === gy));
}

function getFacingTile(player) {
    const px = Math.floor(player.x / TILE_SIZE);
    const py = Math.floor(player.y / TILE_SIZE);
    return {
        x: px + Math.round(player.facing.x),
        y: py + Math.round(player.facing.y)
    };
}

function handleInteract(room, player) {
    const target = getFacingTile(player);
    const tile = getTile(target.x, target.y);
    const worldItem = getWorldItem(room, target.x, target.y);

    if (!player.holding) {
        if (tile === TILE.INGREDIENT_TOMATO) { player.holding = { type: 'tomato' }; return; }
        if (tile === TILE.INGREDIENT_LETTUCE) { player.holding = { type: 'lettuce' }; return; }
        if (tile === TILE.INGREDIENT_MEAT) { player.holding = { type: 'meat' }; return; }
        if (tile === TILE.PLATE_STACK) { player.holding = { type: 'plate', contents: [] }; return; }
        if (worldItem) {
            player.holding = worldItem.item;
            removeWorldItem(room, target.x, target.y);
            return;
        }
    } else {
        if (tile === TILE.TRASH) { player.holding = null; return; }

        if (tile === TILE.CUTTING_BOARD && !worldItem) {
            const h = player.holding.type;
            if (h === 'tomato') {
                player.holding = null;
                room.worldItems.push({ gridX: target.x, gridY: target.y, item: { type: 'chopped_tomato' }, chopTimer: 2, chopping: true });
                return;
            }
            if (h === 'lettuce') {
                player.holding = null;
                room.worldItems.push({ gridX: target.x, gridY: target.y, item: { type: 'chopped_lettuce' }, chopTimer: 2, chopping: true });
                return;
            }
        }

        if (tile === TILE.STOVE && !worldItem) {
            if (player.holding.type === 'meat') {
                player.holding = null;
                room.worldItems.push({ gridX: target.x, gridY: target.y, item: { type: 'cooked_meat' }, cookTimer: 4, cooking: true });
                return;
            }
        }

        if (player.holding.type === 'plate' && worldItem) {
            const itemType = worldItem.item.type;
            if ((itemType.startsWith('chopped_') || itemType === 'cooked_meat') && !worldItem.chopping && !worldItem.cooking) {
                player.holding.contents.push(itemType);
                removeWorldItem(room, target.x, target.y);
                return;
            }
        }

        if (worldItem && worldItem.item.type === 'plate') {
            const h = player.holding.type;
            if (h.startsWith('chopped_') || h === 'cooked_meat') {
                worldItem.item.contents.push(h);
                player.holding = null;
                return;
            }
        }

        if (tile === TILE.SERVING && player.holding.type === 'plate') {
            if (tryServe(room, player.holding)) {
                player.holding = null;
                return;
            }
        }

        if ((tile === TILE.COUNTER || tile === TILE.CUTTING_BOARD || tile === TILE.STOVE) && !worldItem) {
            room.worldItems.push({ gridX: target.x, gridY: target.y, item: player.holding });
            player.holding = null;
            return;
        }
    }
}

function tryServe(room, plate) {
    const contents = [...plate.contents].sort();
    for (let i = 0; i < room.orders.length; i++) {
        const order = room.orders[i];
        const recipe = RECIPES[order.recipe];
        const needed = [...recipe.ingredients].sort();
        if (contents.length === needed.length && contents.every((v, idx) => v === needed[idx])) {
            room.score += recipe.points;
            room.orders.splice(i, 1);
            return true;
        }
    }
    return false;
}

function spawnOrder(room) {
    const recipeNames = Object.keys(RECIPES);
    const recipe = recipeNames[Math.floor(Math.random() * recipeNames.length)];
    room.orders.push({ recipe, timeLeft: 45 });
}

function tickRoom(room) {
    if (!room.gameRunning) return;

    const dt = 1 / TICK_RATE;

    // Update players
    for (const player of room.players) {
        const input = player.input;
        let dx = input.dx;
        let dy = input.dy;

        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
            dx /= len;
            dy /= len;
            player.facing.x = dx;
            player.facing.y = dy;
        }

        const speed = 3;
        const newX = player.x + dx * speed;
        const newY = player.y + dy * speed;
        const half = TILE_SIZE * 0.6 / 2.5;

        if (canMoveTo(newX, player.y, half)) player.x = newX;
        if (canMoveTo(player.x, newY, half)) player.y = newY;

        if (input.interact) {
            handleInteract(room, player);
            input.interact = false;
        }
        if (input.drop) {
            player.holding = null;
            input.drop = false;
        }
    }

    // Update cooking/chopping
    for (const wi of room.worldItems) {
        if (wi.chopping && wi.chopTimer > 0) {
            wi.chopTimer -= dt;
            if (wi.chopTimer <= 0) wi.chopping = false;
        }
        if (wi.cooking && wi.cookTimer > 0) {
            wi.cookTimer -= dt;
            if (wi.cookTimer <= 0) {
                wi.cooking = false;
                wi.burnTimer = 6;
                wi.burning = true;
            }
        }
        if (wi.burning && wi.burnTimer > 0) {
            wi.burnTimer -= dt;
            if (wi.burnTimer <= 0) {
                wi.item.type = 'burning_meat';
                wi.burning = false;
            }
        }
    }

    // Update orders
    room.orderTimer += dt;
    if (room.orderTimer >= room.nextOrderTime && room.orders.length < 4) {
        spawnOrder(room);
        room.orderTimer = 0;
        room.nextOrderTime = 8 + Math.random() * 7;
    }
    for (let i = room.orders.length - 1; i >= 0; i--) {
        room.orders[i].timeLeft -= dt;
        if (room.orders[i].timeLeft <= 0) {
            room.orders.splice(i, 1);
            room.score = Math.max(0, room.score - 10);
        }
    }

    // Timer
    room.timeLeft -= dt;
    if (room.timeLeft <= 0) {
        room.timeLeft = 0;
        room.gameRunning = false;
        clearInterval(room.tickInterval);
        room.tickInterval = null;
        broadcastState(room);
        const msg = JSON.stringify({ type: 'gameOver', score: room.score });
        for (const p of room.players) {
            if (p.ws.readyState === 1) p.ws.send(msg);
        }
        return;
    }

    broadcastState(room);
}

function startRoom(room) {
    room.gameRunning = true;
    room.score = 0;
    room.timeLeft = 120;
    room.worldItems = [];
    room.orders = [];
    room.orderTimer = 0;
    room.nextOrderTime = 5;

    // Reset player positions
    room.players.forEach((p, i) => {
        const spawn = SPAWN_POSITIONS[i % SPAWN_POSITIONS.length];
        p.x = spawn.x * TILE_SIZE + TILE_SIZE / 2;
        p.y = spawn.y * TILE_SIZE + TILE_SIZE / 2;
        p.holding = null;
        p.facing = { x: 0, y: 1 };
        p.input = { dx: 0, dy: 0, interact: false, drop: false };
    });

    spawnOrder(room);

    room.tickInterval = setInterval(() => tickRoom(room), 1000 / TICK_RATE);

    const msg = JSON.stringify({ type: 'gameStarted' });
    for (const p of room.players) {
        if (p.ws.readyState === 1) p.ws.send(msg);
    }
}

function stopRoom(room) {
    if (room.tickInterval) {
        clearInterval(room.tickInterval);
        room.tickInterval = null;
    }
    room.gameRunning = false;
}

// ============================================
// WebSocket Connection Handler
// ============================================
wss.on('connection', (ws) => {
    console.log('New connection');

    ws.on('message', (data) => {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        switch (msg.type) {
            case 'createRoom': {
                const room = createRoom(ws);
                const player = addPlayerToRoom(room, ws);
                ws.send(JSON.stringify({
                    type: 'roomCreated',
                    code: room.code,
                    playerId: player.id,
                }));
                broadcastLobby(room);
                break;
            }

            case 'joinRoom': {
                const code = (msg.code || '').toUpperCase();
                const room = rooms.get(code);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room tidak ditemukan' }));
                    return;
                }
                if (room.players.length >= 4) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room penuh (max 4)' }));
                    return;
                }
                if (room.gameRunning) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Game sudah berjalan' }));
                    return;
                }
                const player = addPlayerToRoom(room, ws);
                ws.send(JSON.stringify({
                    type: 'roomJoined',
                    code: room.code,
                    playerId: player.id,
                }));
                broadcastLobby(room);
                break;
            }

            case 'setName': {
                const room = rooms.get(ws.roomCode);
                if (!room) return;
                const player = room.players[ws.playerIndex];
                if (player) {
                    player.name = (msg.name || 'Chef').substring(0, 12);
                    broadcastLobby(room);
                }
                break;
            }

            case 'startGame': {
                const room = rooms.get(ws.roomCode);
                if (!room || room.gameRunning) return;
                if (ws.playerIndex !== 0) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Hanya host yang bisa mulai' }));
                    return;
                }
                startRoom(room);
                break;
            }

            case 'input': {
                const room = rooms.get(ws.roomCode);
                if (!room || !room.gameRunning) return;
                const player = room.players[ws.playerIndex];
                if (!player) return;
                player.input.dx = msg.dx || 0;
                player.input.dy = msg.dy || 0;
                if (msg.interact) player.input.interact = true;
                if (msg.drop) player.input.drop = true;
                break;
            }

            case 'restart': {
                const room = rooms.get(ws.roomCode);
                if (!room) return;
                if (ws.playerIndex !== 0) return;
                startRoom(room);
                break;
            }
        }
    });

    ws.on('close', () => {
        const room = rooms.get(ws.roomCode);
        if (room) {
            removePlayerFromRoom(room, ws);
            console.log(`Player left room ${ws.roomCode}. ${room.players.length} remaining.`);
        }
    });
});

// ============================================
// Start Server
// ============================================
server.listen(PORT, () => {
    console.log(`🍳 Overcooked Multiplayer Server running on http://localhost:${PORT}`);
    console.log(`   Share your IP + port for LAN play!`);
});
