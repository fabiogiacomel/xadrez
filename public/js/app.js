const socket = io();
let board = null;
let game = new Chess();
let myRoomCode = null;
let playerColor = 'w';
let isGameOver = false;

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameScreen = document.getElementById('game-screen');
const myRoomCodeDisplay = document.getElementById('my-room-code');
const joinCodeInput = document.getElementById('join-code-input');
const joinBtn = document.getElementById('join-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const statusText = document.getElementById('status-text');
const restartBtn = document.getElementById('restart-btn');
const pgnLog = document.getElementById('pgn-log');
const timerWhiteDisplay = document.querySelector('#timer-white .time');
const timerBlackDisplay = document.querySelector('#timer-black .time');

// 1. Initial Room Creation
socket.emit('create_room');

socket.on('room_created', ({ code, color }) => {
    myRoomCode = code;
    myRoomCodeDisplay.innerText = code;
    playerColor = color;
});

// 2. Joining Logic
joinBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code) {
        socket.emit('join_room', code);
    }
});

copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myRoomCode);
    alert('Código copiado!');
});

restartBtn.addEventListener('click', () => {
    socket.emit('restart_game', myRoomCode);
    restartBtn.style.display = 'none';
});

// 3. Game Start
socket.on('game_start', ({ fen, players, timers }) => {
    welcomeScreen.classList.remove('active');
    gameScreen.classList.add('active');
    
    // Find my color in players array
    const me = players.find(p => p.id === socket.id);
    playerColor = me.color;

    initBoard(fen);
    updateTimers(timers);
    statusText.innerText = playerColor === 'w' ? 'Sua vez (Brancas)' : 'Vez do oponente (Brancas)';
});

// 4. Board Initialization
function onDragStart(source, piece, position, orientation) {
    if (game.game_over() || isGameOver) return false;
    if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
        (playerColor === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
    if (game.turn() !== playerColor) return false;
}

function onDrop(source, target) {
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // Always promote to queen for simplicity
    });

    if (move === null) return 'snapback';

    // Send move to server
    socket.emit('make_move', { code: myRoomCode, move: move });
}

function onSnapEnd() {
    board.position(game.fen());
}

function initBoard(fen) {
    const config = {
        draggable: true,
        position: fen || 'start',
        orientation: playerColor === 'w' ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('board', config);
}

// 5. Move Updates
socket.on('move_made', ({ fen, move, timers, turn, status, winner }) => {
    game.load(fen);
    board.position(fen);
    updateTimers(timers);
    updatePGN();

    if (status === 'finished') {
        isGameOver = true;
        statusText.innerText = `Fim de Jogo! Vencedor: ${winner}`;
        restartBtn.style.display = 'block';
        alert(`Fim de jogo: ${winner}`);
    } else {
        const isMyTurn = turn === playerColor;
        statusText.innerText = isMyTurn ? 'Sua vez' : 'Vez do oponente';
    }
});

socket.on('timer_update', ({ timers }) => {
    updateTimers(timers);
});

socket.on('game_over_time', ({ winner }) => {
    isGameOver = true;
    statusText.innerText = `Fim de Jogo (Tempo)! Vencedor: ${winner}`;
    restartBtn.style.display = 'block';
    alert(`Fim de jogo por tempo: ${winner}`);
});

socket.on('game_restart', ({ fen, players, timers }) => {
    game.reset();
    isGameOver = false;
    
    const me = players.find(p => p.id === socket.id);
    playerColor = me.color;

    initBoard(fen);
    updateTimers(timers);
    updatePGN();
    
    restartBtn.style.display = 'none';
    const isMyTurn = game.turn() === playerColor;
    statusText.innerText = isMyTurn ? 'Sua vez' : 'Vez do oponente';
});

socket.on('error_message', (msg) => {
    alert(msg);
});

// Helpers
function updateTimers(timers) {
    timerWhiteDisplay.innerText = formatTime(timers.w);
    timerBlackDisplay.innerText = formatTime(timers.b);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updatePGN() {
    pgnLog.innerText = game.pgn();
    pgnLog.scrollTop = pgnLog.scrollHeight;
}
