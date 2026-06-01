// ============================================
// OVERCOOKED ONLINE - Client
// ============================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Connection
let ws = null;
let myPlayerId = -1;
let roomCode = '';
let isHost = false;

// Game state (received from server)
let gameState = {
    players: [],
    worldItems: [],
    orders: [],
    score: 0,
    timeLeft: 120,
    gameRunning: false,
};

// Grid
const COLS = 12;
const ROWS = 8;
let TILE_SIZE = 64;

// Input
const keys = {};
const joystick = { active: false, dx: 0, dy: 0 };
let inputDx = 0, inputDy = 0;
let sendInteract = false;
let sendDrop = false;

// Map (same as server, for rendering)
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

const TILE_COLORS = {
    [TILE.FLOOR]: '#8B7355',
    [TILE.WALL]: '#4a3728',
    [TILE.COUNTER]: '#A0896E',
    [TILE.STOVE]: '#555555',
    [TILE.INGREDIENT_TOMATO]: '#cc4444',
    [TILE.INGREDIENT_LETTUCE]: '#44aa44',
    [TILE.INGREDIENT_MEAT]: '#aa6633',
    [TILE.CUTTING_BOARD]: '#c4a882',
    [TILE.PLATE_STACK]: '#dddddd',
    [TILE.SERVING]: '#ffcc00',
    [TILE.TRASH]: '#333333',
};

const ITEM_EMOJI = {
    'tomato': '🍅', 'lettuce': '🥬', 'meat': '🥩',
    'chopped_tomato': '🍅✓', 'chopped_lettuce': '🥬✓',
    'cooked_meat': '🍖', 'burning_meat': '🔥',
    'plate': '🍽️', 'salad': '🥗', 'burger': '🍔', 'soup': '🍲',
};

const RECIPE_EMOJI = { 'salad': '🥗', 'burger': '🍔', 'soup': '🍲' };

// ============================================
// WEBSOCKET CONNECTION
// ============================================
function connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;
    ws = new WebSocket(url);

    ws.onopen = () => {
        showStatus('Terhubung ✓');
        setTimeout(() => hideStatus(), 2000);
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
    };

    ws.onclose = () => {
        showStatus('Terputus... Reconnecting...');
        setTimeout(connect, 2000);
    };

    ws.onerror = () => {
        showStatus('Koneksi error');
    };
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'roomCreated':
            roomCode = msg.code;
            myPlayerId = msg.playerId;
            isHost = true;
            showLobby();
            break;

        case 'roomJoined':
            roomCode = msg.code;
            myPlayerId = msg.playerId;
            isHost = false;
            showLobby();
            break;

        case 'lobby':
            updateLobbyUI(msg);
            break;

        case 'gameStarted':
            showGame();
            break;

        case 'state':
            gameState = msg;
            break;

        case 'gameOver':
            showGameOver(msg.score);
            break;

        case 'error':
            showError(msg.message);
            break;
    }
}

// ============================================
// UI MANAGEMENT
// ============================================
function showScreen(id) {
    ['menu-screen', 'lobby-screen', 'game-over-screen'].forEach(s => {
        document.getElementById(s).classList.add('hidden');
    });
    if (id) document.getElementById(id).classList.remove('hidden');
}

function showLobby() {
    showScreen('lobby-screen');
    document.getElementById('lobby-code').textContent = roomCode;
    document.getElementById('btn-start-game').classList.toggle('hidden', !isHost);
    document.getElementById('lobby-info').classList.toggle('hidden', isHost);
}

function updateLobbyUI(msg) {
    const list = document.getElementById('player-list');
    list.innerHTML = '';
    for (const p of msg.players) {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `
            <div class="player-dot" style="background:${p.color}"></div>
            <span>${p.name}</span>
            ${p.id === 0 ? '<span class="host-badge">HOST</span>' : ''}
        `;
        list.appendChild(div);
    }
    // Update host status in case of reconnect
    isHost = (myPlayerId === 0);
    document.getElementById('btn-start-game').classList.toggle('hidden', !isHost);
    document.getElementById('lobby-info').classList.toggle('hidden', isHost);
}

function showGame() {
    showScreen(null);
    document.getElementById('ui-overlay').classList.remove('hidden');
    document.getElementById('orders-display').classList.remove('hidden');
    if (window.innerWidth < 769) {
        document.getElementById('mobile-controls').classList.remove('hidden');
    }
    resizeCanvas();
    requestAnimationFrame(renderLoop);
}

function showGameOver(finalScore) {
    document.getElementById('mobile-controls').classList.add('hidden');
    document.getElementById('final-score').textContent = finalScore;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('btn-restart').classList.toggle('hidden', !isHost);
}

function showError(message) {
    document.getElementById('menu-error').textContent = message;
    setTimeout(() => {
        document.getElementById('menu-error').textContent = '';
    }, 3000);
}

function showStatus(text) {
    const el = document.getElementById('connection-status');
    el.classList.remove('hidden');
    document.getElementById('status-text').textContent = text;
}

function hideStatus() {
    document.getElementById('connection-status').classList.add('hidden');
}

// ============================================
// CANVAS RESIZE
// ============================================
function resizeCanvas() {
    const isMobile = window.innerWidth < 769;
    if (isMobile) {
        const controlsHeight = 170;
        const availableHeight = window.innerHeight - controlsHeight;
        const availableWidth = window.innerWidth;

        const scaleX = availableWidth / (COLS * 64);
        const scaleY = availableHeight / (ROWS * 64);
        const scale = Math.min(scaleX, scaleY, 1.5);

        TILE_SIZE = Math.floor(64 * scale);
        canvas.width = COLS * TILE_SIZE;
        canvas.height = ROWS * TILE_SIZE;
        canvas.style.width = canvas.width + 'px';
        canvas.style.height = canvas.height + 'px';
    } else {
        TILE_SIZE = 64;
        canvas.width = COLS * TILE_SIZE;
        canvas.height = ROWS * TILE_SIZE;
        canvas.style.width = '';
        canvas.style.height = '';
    }
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ============================================
// INPUT - Keyboard
// ============================================
document.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'e' || e.key === '/') sendInteract = true;
    if (e.key.toLowerCase() === 'q' || e.key === '.') sendDrop = true;
});

document.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
});

// ============================================
// INPUT - Touch Joystick
// ============================================
const joystickBase = document.getElementById('joystick-base');
const joystickThumb = document.getElementById('joystick-thumb');
const joystickArea = document.getElementById('joystick-area');

let joystickCenter = { x: 0, y: 0 };
const JOYSTICK_RADIUS = 35;

function getJoystickCenter() {
    const rect = joystickBase.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

joystickArea.addEventListener('touchstart', (e) => {
    e.preventDefault();
    joystick.active = true;
    joystickCenter = getJoystickCenter();
    handleJoystickMove(e.touches[0]);
});

joystickArea.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (joystick.active) handleJoystickMove(e.touches[0]);
});

joystickArea.addEventListener('touchend', (e) => {
    e.preventDefault();
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    joystickThumb.style.transform = 'translate(0px, 0px)';
});

function handleJoystickMove(touch) {
    const dx = touch.clientX - joystickCenter.x;
    const dy = touch.clientY - joystickCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = JOYSTICK_RADIUS;

    let clampedX = dx, clampedY = dy;
    if (dist > maxDist) {
        clampedX = (dx / dist) * maxDist;
        clampedY = (dy / dist) * maxDist;
    }

    joystickThumb.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
    joystick.dx = clampedX / maxDist;
    joystick.dy = clampedY / maxDist;
}

document.getElementById('btn-interact').addEventListener('touchstart', (e) => {
    e.preventDefault();
    sendInteract = true;
});

document.getElementById('btn-drop').addEventListener('touchstart', (e) => {
    e.preventDefault();
    sendDrop = true;
});

// ============================================
// INPUT SENDING (throttled)
// ============================================
setInterval(() => {
    if (!gameState.gameRunning) return;

    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;

    if (joystick.active) {
        const deadzone = 0.2;
        if (Math.abs(joystick.dx) > deadzone) dx += joystick.dx;
        if (Math.abs(joystick.dy) > deadzone) dy += joystick.dy;
    }

    const msg = { type: 'input', dx, dy };
    if (sendInteract) { msg.interact = true; sendInteract = false; }
    if (sendDrop) { msg.drop = true; sendDrop = false; }

    send(msg);
}, 1000 / 20); // 20 times per second

// ============================================
// RENDER
// ============================================
function renderLoop() {
    render();
    updateHUD();
    if (gameState.gameRunning) {
        requestAnimationFrame(renderLoop);
    }
}

function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = TILE_SIZE / 64;

    // Draw tiles
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const tile = MAP[y][x];
            ctx.fillStyle = TILE_COLORS[tile] || '#8B7355';
            ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

            const cx = x * TILE_SIZE + TILE_SIZE / 2;
            const cy = y * TILE_SIZE + TILE_SIZE / 2;

            if (tile === TILE.INGREDIENT_TOMATO) drawEmoji('🍅', cx, cy);
            else if (tile === TILE.INGREDIENT_LETTUCE) drawEmoji('🥬', cx, cy);
            else if (tile === TILE.INGREDIENT_MEAT) drawEmoji('🥩', cx, cy);
            else if (tile === TILE.STOVE) drawEmoji('🔥', cx, cy);
            else if (tile === TILE.CUTTING_BOARD) drawEmoji('🔪', cx, cy);
            else if (tile === TILE.PLATE_STACK) drawEmoji('🍽️', cx, cy);
            else if (tile === TILE.SERVING) drawEmoji('🏪', cx, cy);
            else if (tile === TILE.TRASH) drawEmoji('🗑️', cx, cy);
        }
    }

    // Draw world items
    for (const wi of gameState.worldItems) {
        const cx = wi.gridX * TILE_SIZE + TILE_SIZE / 2;
        const cy = wi.gridY * TILE_SIZE + TILE_SIZE / 2;

        if (wi.item.type === 'plate') {
            drawEmoji('🍽️', cx, cy - TILE_SIZE * 0.15);
            const contents = wi.item.contents || [];
            for (let i = 0; i < contents.length; i++) {
                const emoji = ITEM_EMOJI[contents[i]] || '?';
                const smallSize = Math.max(8, TILE_SIZE * 0.2);
                ctx.font = `${smallSize}px Arial`;
                ctx.textAlign = 'center';
                ctx.fillText(emoji, cx + (i - contents.length / 2) * smallSize, cy + TILE_SIZE * 0.2);
            }
        } else {
            const emoji = ITEM_EMOJI[wi.item.type] || '❓';
            drawEmoji(emoji, cx, cy);
        }

        // Progress bars
        if (wi.chopping && wi.chopTimer > 0) {
            drawProgressBar(cx, cy + TILE_SIZE * 0.35, 1 - wi.chopTimer / 2, '#44ff44');
        }
        if (wi.cooking && wi.cookTimer > 0) {
            drawProgressBar(cx, cy + TILE_SIZE * 0.35, 1 - wi.cookTimer / 4, '#ffaa00');
        }
        if (wi.burning && wi.burnTimer > 0) {
            drawProgressBar(cx, cy + TILE_SIZE * 0.35, 1 - wi.burnTimer / 6, '#ff0000');
        }
    }

    // Draw players
    for (const p of gameState.players) {
        const px = p.x * scale;
        const py = p.y * scale;
        const size = TILE_SIZE * 0.6;

        // Player circle
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, size / 2, 0, Math.PI * 2);
        ctx.fill();

        // Border (highlight self)
        ctx.strokeStyle = p.id === myPlayerId ? '#ffd700' : '#fff';
        ctx.lineWidth = p.id === myPlayerId ? 3 : 2;
        ctx.stroke();

        // Facing indicator
        const indicatorDist = size / 2 + 4;
        const ix = px + p.facing.x * indicatorDist;
        const iy = py + p.facing.y * indicatorDist;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ix, iy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Name tag
        ctx.font = `${Math.max(9, TILE_SIZE * 0.18)}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(p.name, px, py + size / 2 + 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, px - 1, py + size / 2 + 11);

        // Held item
        if (p.holding) {
            const hx = px;
            const hy = py - size / 2 - 10;
            if (p.holding.type === 'plate') {
                drawEmoji('🍽️', hx, hy);
                const contents = p.holding.contents || [];
                for (let i = 0; i < contents.length; i++) {
                    const emoji = ITEM_EMOJI[contents[i]] || '?';
                    const smallSize = Math.max(8, TILE_SIZE * 0.17);
                    ctx.font = `${smallSize}px Arial`;
                    ctx.textAlign = 'center';
                    ctx.fillText(emoji, hx + (i - contents.length / 2) * smallSize * 0.8, hy + 11);
                }
            } else {
                const emoji = ITEM_EMOJI[p.holding.type] || '❓';
                drawEmoji(emoji, hx, hy);
            }
        }
    }
}

function drawEmoji(emoji, x, y) {
    const fontSize = Math.max(14, TILE_SIZE * 0.4);
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, x, y);
}

function drawProgressBar(x, y, progress, color) {
    const w = TILE_SIZE * 0.7;
    const h = 5;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - w / 2, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, progress)), h);
}

function updateHUD() {
    document.getElementById('score-display').textContent = `⭐ ${gameState.score}`;
    document.getElementById('timer-display').textContent = `⏱ ${Math.ceil(gameState.timeLeft)}`;

    const ordersEl = document.getElementById('orders-display');
    ordersEl.innerHTML = '';
    for (const order of gameState.orders) {
        const card = document.createElement('div');
        card.className = 'order-card' + (order.timeLeft < 10 ? ' urgent' : '');
        const emoji = RECIPE_EMOJI[order.recipe] || '?';
        card.textContent = `${emoji} ${Math.ceil(order.timeLeft)}s`;
        ordersEl.appendChild(card);
    }
}

// ============================================
// MENU EVENT LISTENERS
// ============================================
document.getElementById('btn-create').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim() || 'Chef';
    send({ type: 'createRoom' });
    setTimeout(() => send({ type: 'setName', name }), 200);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const code = document.getElementById('room-code-input').value.trim().toUpperCase();
    if (code.length !== 4) {
        showError('Kode room harus 4 karakter');
        return;
    }
    const name = document.getElementById('player-name').value.trim() || 'Chef';
    send({ type: 'joinRoom', code });
    setTimeout(() => send({ type: 'setName', name }), 200);
});

document.getElementById('btn-start-game').addEventListener('click', () => {
    send({ type: 'startGame' });
});

document.getElementById('btn-copy-code').addEventListener('click', () => {
    navigator.clipboard.writeText(roomCode).then(() => {
        document.getElementById('btn-copy-code').textContent = '✅';
        setTimeout(() => {
            document.getElementById('btn-copy-code').textContent = '📋';
        }, 1500);
    });
});

document.getElementById('btn-restart').addEventListener('click', () => {
    send({ type: 'restart' });
});

document.getElementById('btn-back-lobby').addEventListener('click', () => {
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('ui-overlay').classList.add('hidden');
    document.getElementById('orders-display').classList.add('hidden');
    showLobby();
});

// Handle URL room code (e.g., ?room=ABCD)
function checkUrlRoom() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (code) {
        document.getElementById('room-code-input').value = code.toUpperCase();
    }
}

// ============================================
// INIT
// ============================================
checkUrlRoom();
connect();
