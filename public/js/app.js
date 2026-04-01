const socket = io();
let board = null;
let game = new Chess();
let myRoomCode = null;
let playerColor = 'w';
let isGameOver = false;
let isLocalMode = false;
let shouldFlip = true;
let localTimers = { w: 600, b: 600 };
let localInterval = null;

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameScreen = document.getElementById('game-screen');
const myRoomCodeDisplay = document.getElementById('my-room-code');
const joinCodeInput = document.getElementById('join-code-input');
const joinBtn = document.getElementById('join-btn');
const localGameBtn = document.getElementById('local-game-btn');
const abandonBtn = document.getElementById('abandon-btn');
const copyCodeBtn = document.getElementById('copy-code-btn');
const statusText = document.getElementById('status-text');
const restartBtn = document.getElementById('restart-btn');
const pgnLog = document.getElementById('pgn-log');
const timerWhiteDiv = document.getElementById('timer-white');
const timerBlackDiv = document.getElementById('timer-black');
const capturedPlayer = document.getElementById('captured-player');
const capturedOpponent = document.getElementById('captured-opponent');
const flipToggleContainer = document.getElementById('flip-toggle-container');
const flipToggle = document.getElementById('flip-toggle');

// Menu Elements
const menuBtn = document.getElementById('menu-btn');
const sideMenu = document.getElementById('side-menu');
const menuOverlay = document.getElementById('menu-overlay');
const closeMenuBtn = document.getElementById('close-menu');
const menuHome = document.getElementById('menu-home');
const menuLocal = document.getElementById('menu-local');
const menuAbout = document.getElementById('menu-about');

// 1. Initial Room Creation (Online)
socket.emit('create_room');

socket.on('room_created', ({ code, color }) => {
    myRoomCode = code;
    myRoomCodeDisplay.innerText = code;
    if (!isLocalMode) playerColor = color;
});

// 2. Navigation & Mode Selection
joinBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code) {
        isLocalMode = false;
        flipToggleContainer.style.display = 'none';
        socket.emit('join_room', code);
    }
});

localGameBtn.addEventListener('click', () => {
    startLocalGame();
});

abandonBtn.addEventListener('click', () => {
    if (isGameOver) {
        resetToMenu();
        return;
    }

    if (confirm('Deseja realmente abandonar a partida?')) {
        if (isLocalMode) {
            resetToMenu();
        } else {
            socket.emit('resign_game', myRoomCode);
            resetToMenu();
        }
    }
});

flipToggle.addEventListener('change', (e) => {
    shouldFlip = e.target.checked;
});

copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myRoomCode);
    const originalContent = copyCodeBtn.innerHTML;
    copyCodeBtn.innerHTML = '<span style="color: #10b981; font-size: 0.8rem">Ok!</span>';
    setTimeout(() => copyCodeBtn.innerHTML = originalContent, 2000);
});

restartBtn.addEventListener('click', () => {
    if (isLocalMode) {
        startLocalGame();
    } else {
        socket.emit('restart_game', myRoomCode);
    }
    restartBtn.style.display = 'none';
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
});

// 3. Menu Logic
function toggleMenu() {
    menuBtn.classList.toggle('open');
    sideMenu.classList.toggle('active');
    menuOverlay.classList.toggle('active');
}

menuBtn.addEventListener('click', toggleMenu);
closeMenuBtn.addEventListener('click', toggleMenu);
menuOverlay.addEventListener('click', toggleMenu);

menuHome.addEventListener('click', (e) => {
    e.preventDefault();
    if (!welcomeScreen.classList.contains('active')) {
        if (confirm('Sair da partida atual e voltar ao menu?')) {
            resetToMenu();
        }
    }
    toggleMenu();
});

menuLocal.addEventListener('click', (e) => {
    e.preventDefault();
    startLocalGame();
    toggleMenu();
});

menuAbout.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Xadrez Premium por Giacomel Art.\nUm projeto focado em design sofisticado e jogabilidade fluida.');
    toggleMenu();
});

// 4. Game State Transitions
function startLocalGame() {
    isLocalMode = true;
    isGameOver = false;
    game = new Chess();
    localTimers = { w: 600, b: 600 };
    shouldFlip = flipToggle.checked;
    
    welcomeScreen.classList.remove('active');
    gameScreen.classList.add('active');
    flipToggleContainer.style.display = 'flex';
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
    
    initBoard();
    updateTimers(localTimers);
    updateTurnIndicator('w');
    updateCapturedPieces();
    updatePGN();
    startLocalTimer();
}

function resetToMenu() {
    isLocalMode = false;
    isGameOver = false;
    stopLocalTimer();
    welcomeScreen.classList.add('active');
    gameScreen.classList.remove('active');
    flipToggleContainer.style.display = 'none';
    restartBtn.style.display = 'none';
    socket.emit('create_room');
}

// 5. Board Implementation
function removeHighlights() {
    $('#board .square-55d63').removeClass('highlight-last-move hint-dot');
}

function onDragStart(source, piece, position, orientation) {
    if (game.game_over() || isGameOver) return false;
    
    if (!isLocalMode) {
        if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
            (playerColor === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        if (game.turn() !== playerColor) return false;
    }

    const moves = game.moves({
        square: source,
        verbose: true
    });

    if (moves.length === 0) return;

    moves.forEach(m => {
        $(`#board .square-${m.to}`).addClass('hint-dot');
    });
}

function onDrop(source, target) {
    removeHighlights();
    
    const move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    $(`#board .square-${source}`).addClass('highlight-last-move');
    $(`#board .square-${target}`).addClass('highlight-last-move');

    if (isLocalMode) {
        handleLocalMove(move);
    } else {
        socket.emit('make_move', { code: myRoomCode, move: move });
    }
}

function onSnapEnd() {
    board.position(game.fen());
}

function initBoard(fen) {
    const config = {
        draggable: true,
        position: fen || 'start',
        orientation: isLocalMode ? 'white' : (playerColor === 'w' ? 'white' : 'black'),
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', config);
}

// 6. Local Game Logic
function handleLocalMove(move) {
    updateTurnIndicator(game.turn());
    updatePGN();
    updateCapturedPieces();
    
    if (shouldFlip) {
        setTimeout(() => {
            board.orientation(game.turn() === 'w' ? 'white' : 'black');
        }, 250);
    }

    if (game.game_over()) {
        stopLocalTimer();
        let winner = 'Empate';
        if (game.in_checkmate()) {
            winner = game.turn() === 'w' ? 'Pretas' : 'Brancas';
        }
        endGame(winner);
    }
}

function startLocalTimer() {
    stopLocalTimer();
    localInterval = setInterval(() => {
        if (isGameOver) return;
        const turn = game.turn();
        localTimers[turn]--;
        updateTimers(localTimers);
        
        if (localTimers[turn] <= 0) {
            stopLocalTimer();
            endGame(turn === 'w' ? 'Pretas' : 'Brancas', true);
        }
    }, 1000);
}

function stopLocalTimer() {
    if (localInterval) clearInterval(localInterval);
}

// 7. Socket Events (Online Mode)
socket.on('game_start', ({ fen, players, timers }) => {
    isLocalMode = false;
    flipToggleContainer.style.display = 'none';
    welcomeScreen.classList.remove('active');
    gameScreen.classList.add('active');
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
    
    const me = players.find(p => p.id === socket.id);
    playerColor = me.color;

    initBoard(fen);
    updateTimers(timers);
    updateTurnIndicator('w');
});

socket.on('move_made', ({ fen, move, timers, turn, status, winner }) => {
    if (isLocalMode) return;
    
    game.load(fen);
    board.position(fen);
    
    removeHighlights();
    if (move) {
        $(`#board .square-${move.from}`).addClass('highlight-last-move');
        $(`#board .square-${move.to}`).addClass('highlight-last-move');
    }

    updateTimers(timers);
    updatePGN();
    updateCapturedPieces();
    updateTurnIndicator(turn);

    if (status === 'finished') {
        endGame(winner);
    }
});

socket.on('timer_update', ({ timers }) => {
    if (!isLocalMode) updateTimers(timers);
});

socket.on('game_over_time', ({ winner }) => {
    if (!isLocalMode) endGame(winner, true);
});

socket.on('game_restart', ({ fen, players, timers }) => {
    if (isLocalMode) return;
    
    game.reset();
    isGameOver = false;
    
    const me = players.find(p => p.id === socket.id);
    playerColor = me.color;

    initBoard(fen);
    updateTimers(timers);
    updatePGN();
    updateCapturedPieces();
    updateTurnIndicator('w');
    
    restartBtn.style.display = 'none';
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
});

socket.on('error_message', (msg) => {
    statusText.innerText = msg;
    statusText.style.color = '#ef4444';
    setTimeout(() => {
        statusText.style.color = '#10b981';
        updateTurnIndicator(game.turn());
    }, 3000);
});

// 8. Helpers
function updateTimers(timers) {
    document.querySelector('#timer-white .time').innerText = formatTime(timers.w);
    document.querySelector('#timer-black .time').innerText = formatTime(timers.b);
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function updateTurnIndicator(turn) {
    if (isGameOver) return;
    
    const isMyTurn = isLocalMode || (turn === playerColor);
    statusText.innerText = isLocalMode ? `Vez das ${turn === 'w' ? 'Brancas' : 'Pretas'}` : (isMyTurn ? 'Sua Vez' : 'Vez do Oponente');
    
    if (turn === 'w') {
        timerWhiteDiv.classList.add('active');
        timerBlackDiv.classList.remove('active');
    } else {
        timerBlackDiv.classList.add('active');
        timerWhiteDiv.classList.remove('active');
    }
}

function endGame(winner, time = false) {
    isGameOver = true;
    const reason = time ? ' (Tempo)' : '';
    statusText.innerText = `Fim de Jogo! Vencedor: ${winner}${reason}`;
    restartBtn.style.display = 'block';
    abandonBtn.innerText = 'VOLTAR AO MENU';
    
    timerWhiteDiv.classList.remove('active');
    timerBlackDiv.classList.remove('active');
}

function updatePGN() {
    let pgn = game.pgn();
    pgn = pgn.replace(/\[.*?\]\s*/g, '').trim();
    pgnLog.innerText = pgn;
    pgnLog.scrollTop = pgnLog.scrollHeight;
}

function updateCapturedPieces() {
    const history = game.history({ verbose: true });
    const captured = { w: [], b: [] };

    const pieceSymbols = {
        p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚'
    };

    history.forEach(move => {
        if (move.captured) {
            const pieceColor = move.color === 'w' ? 'b' : 'w';
            captured[pieceColor].push(pieceSymbols[move.captured]);
        }
    });

    if (isLocalMode) {
        document.getElementById('captured-opponent').innerHTML = captured.b.join(' ');
        document.getElementById('captured-player').innerHTML = captured.w.join(' ');
    } else {
        const playerCapturedColor = playerColor === 'w' ? 'b' : 'w';
        const opponentCapturedColor = playerColor === 'w' ? 'w' : 'b';
        document.getElementById('captured-player').innerHTML = captured[playerCapturedColor].join(' ');
        document.getElementById('captured-opponent').innerHTML = captured[opponentCapturedColor].join(' ');
    }
}
