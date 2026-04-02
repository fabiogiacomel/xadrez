const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000
});

// State
let board = null;
let game;
try {
    game = new Chess();
} catch(e) {
    console.error('Motor de Xadrez falhou ao iniciar!');
}

let myRoomCode = null;
let playerColor = 'w';
let isGameOver = false;
let isLocalMode = false;
let isNoClockMode = false;
let isTimerPaused = false;
let isWaitingForServer = false; // Bloqueia movimentos múltiplos online
let localTimers = { w: 600, b: 600 };
let remoteTimers = { w: 600, b: 600 };
let localInterval = null;
let roomInterval = null;

// Global UI Helper
function showScreen(screenId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
}

// 0. Session Management
function getSessionId() {
    let sid = localStorage.getItem('chess_session_id');
    if (!sid) {
        sid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('chess_session_id', sid);
    }
    return sid;
}

// 1. Board & Move Logic
function removeHighlights() {
    $('#board .square-55d63').removeClass('highlight-last-move hint-dot');
}

function onDragStart(source, piece, position, orientation) {
    if (isGameOver || isWaitingForServer || isTimerPaused) return false;

    if (game.game_over()) return false;

    // Apenas permitir arrastar peças da própria cor
    if (!isLocalMode) {
        if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
            (playerColor === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
        if (game.turn() !== playerColor) return false;
    } else {
        if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
    }

    const moves = game.moves({ square: source, verbose: true });
    if (moves.length === 0) return;
    moves.forEach(m => $(`#board .square-${m.to}`).addClass('hint-dot'));
}

function onDrop(source, target) {
    removeHighlights();
    
    let moveObj = { from: source, to: target };
    const piece = game.get(source);
    if (piece && piece.type === 'p' && (target[1] === '8' || target[1] === '1')) {
        moveObj.promotion = 'q';
    }

    const move = game.move(moveObj);
    if (move === null) return 'snapback';

    $(`#board .square-${source}`).addClass('highlight-last-move');
    $(`#board .square-${target}`).addClass('highlight-last-move');

    if (isLocalMode) {
        handleLocalMove(move);
    } else {
        isWaitingForServer = true; // Bloqueia até o servidor confirmar
        socket.emit('make_move', { code: myRoomCode, move: moveObj });
    }
}

function onSnapEnd() {
    board.position(game.fen());
}

function initBoard(fen) {
    const f = (fen && fen !== 'start') ? fen : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const config = {
        draggable: true,
        position: f,
        orientation: (isLocalMode || playerColor === 'w') ? 'white' : 'black',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: onSnapEnd,
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    };
    board = Chessboard('board', config);
    game.load(f);
}

// 2. Initialization & Listeners
document.addEventListener('DOMContentLoaded', () => {
    // DOM Cache
    const welcomeScreen = document.getElementById('welcome-screen');
    const gameScreen = document.getElementById('game-screen');
    const roomCodeContainer = document.getElementById('room-code-container');
    const myRoomCodeDisplay = document.getElementById('my-room-code');
    const gameRoomCodeSection = document.getElementById('game-room-code-section');
    const gameRoomCodeDisplay = document.getElementById('game-room-code');
    const joinCodeInput = document.getElementById('join-code-input');
    const joinBtn = document.getElementById('join-btn');
    const createOnlineBtn = document.getElementById('create-online-btn');
    const localGameBtn = document.getElementById('local-game-btn');
    const abandonBtn = document.getElementById('abandon-btn');
    const copyBtn = document.getElementById('copy-code-btn');
    const gameCopyBtn = document.getElementById('game-copy-code-btn');
    const statusText = document.getElementById('status-text');
    const mgmtControls = document.getElementById('game-mgmt-controls');
    const timersContainer = document.querySelector('.timers');

    // Botão Criar Partida Online
    if (createOnlineBtn) {
        createOnlineBtn.addEventListener('click', () => {
            console.log('Criando sala online...');
            isLocalMode = false;
            socket.emit('create_room', { sessionId: getSessionId() });
        });
    }

    // Botão Entrar em Partida
    if (joinBtn) {
        joinBtn.addEventListener('click', () => {
            const code = joinCodeInput.value.trim().toUpperCase();
            if (code) {
                isLocalMode = false;
                socket.emit('join_room', { code, sessionId: getSessionId() });
            } else {
                alert('Por favor, insira um código válido.');
            }
        });
    }

    // Botão Jogar Local
    if (localGameBtn) {
        localGameBtn.addEventListener('click', () => {
            isNoClockMode = false;
            startLocalGame();
        });
    }

    // Botões de Copiar
    const handleCopy = (btn) => {
        if (!myRoomCode) return;
        navigator.clipboard.writeText(myRoomCode);
        const original = btn.innerHTML;
        btn.innerHTML = 'Ok!';
        setTimeout(() => btn.innerHTML = original, 2000);
    };
    if (copyBtn) copyBtn.addEventListener('click', () => handleCopy(copyBtn));
    if (gameCopyBtn) gameCopyBtn.addEventListener('click', () => handleCopy(gameCopyBtn));

    // Eventos do Socket
    socket.on('room_created', ({ code, color, settings, restored, fen }) => {
        myRoomCode = code;
        playerColor = color || 'w';
        isLocalMode = false;
        
        if (myRoomCodeDisplay) myRoomCodeDisplay.innerText = code;
        if (gameRoomCodeDisplay) gameRoomCodeDisplay.innerText = code;
        if (gameRoomCodeSection) gameRoomCodeSection.style.display = 'block';
        if (roomCodeContainer) roomCodeContainer.style.display = 'flex';

        if (restored) {
            showScreen('game-screen');
            statusText.innerText = 'Partida Restaurada!';
            initBoard(fen);
        } else {
            // Permanece na tela inicial mostrando o código e uma mensagem
            if (statusText) statusText.innerText = 'Aguardando Oponente...';
            const createBtn = document.getElementById('create-online-btn');
            if (createBtn) {
                createBtn.innerText = 'AGUARDANDO OPONENTE...';
                createBtn.disabled = true;
                createBtn.style.opacity = '0.7';
            }
        }
    });

    socket.on('game_start', ({ code, fen, playerColor: serverColor, settings, timers }) => {
        myRoomCode = code;
        if (serverColor) playerColor = serverColor;
        isLocalMode = false;
        isWaitingForServer = false;
        
        if (timers) remoteTimers = timers;
        if (settings && settings.paused) isTimerPaused = true;

        if (gameRoomCodeSection) gameRoomCodeSection.style.display = 'none';
        showScreen('game-screen');
        updateStatus();
        initBoard(fen);
        startRoomClock();
    });

    socket.on('player_disconnected', ({ message }) => {
        statusText.innerText = message;
        statusText.style.background = 'rgba(239, 68, 68, 0.2)';
        statusText.style.borderColor = '#ef4444';
    });

    socket.on('pause_updated', ({ paused }) => {
        isTimerPaused = paused;
        const pauseBtn = document.getElementById('pause-timer-btn');
        if (pauseBtn) {
            pauseBtn.innerText = paused ? 'Retomar Relógio' : 'Pausar Relógio';
            pauseBtn.classList.toggle('paused', paused);
        }
        updateStatus();
    });

    socket.on('timer_update', ({ timers }) => {
        remoteTimers = timers;
        updateTimerDisplay();
    });

    socket.on('move_made', ({ fen, move, turn, status, winner }) => {
        isWaitingForServer = false;
        game.load(fen);
        board.position(fen);
        removeHighlights();
        if (move) {
            $(`#board .square-${move.from}`).addClass('highlight-last-move');
            $(`#board .square-${move.to}`).addClass('highlight-last-move');
        }
        if (timers) remoteTimers = timers;
        updateTurnIndicator(turn);
        updateTimerDisplay();
        if (status === 'finished') endGame(winner);
        else updateStatus();
    });

    socket.on('error_message', (msg) => {
        isWaitingForServer = false;
        alert(msg);
        if (board && game) board.position(game.fen()); // Reset visual se falhou
    });

    // Check Initial URL
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('room');
    if (code) socket.emit('join_room', { code, sessionId: getSessionId() });

    // Súmula Download
    const downloadBtn = document.getElementById('download-summary-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            const summary = {
                roomCode: myRoomCode,
                date: new Date().toLocaleString(),
                pgn: game.pgn(),
                result: isGameOver ? document.getElementById('status-text').innerText : 'Em andamento',
                timers: isLocalMode ? localTimers : remoteTimers,
                mode: isLocalMode ? 'Local' : 'Online'
            };
            const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sumula_xadrez_${myRoomCode || 'local'}.json`;
            a.click();
        });
    }

    // Timer Pause Button
    const pauseBtn = document.getElementById('pause-timer-btn');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (isLocalMode) {
                isTimerPaused = !isTimerPaused;
                pauseBtn.innerText = isTimerPaused ? 'Retomar Relógio' : 'Pausar Relógio';
                pauseBtn.classList.toggle('paused', isTimerPaused);
                updateStatus();
            } else {
                socket.emit('toggle_pause', myRoomCode);
            }
        });
    }

    // Add 5 min button
    const addTimeBtn = document.getElementById('add-5m-btn');
    if (addTimeBtn) {
        addTimeBtn.addEventListener('click', () => {
            if (isLocalMode) {
                localTimers.w += 300;
                localTimers.b += 300;
                updateTimerDisplay();
            } else {
                socket.emit('add_time', myRoomCode);
            }
        });
    }

    // Abandon/Leave
    if (abandonBtn) {
        abandonBtn.addEventListener('click', () => {
            if (confirm('Deseja realmente abandonar a partida?')) {
                if (!isLocalMode && myRoomCode) {
                    socket.emit('resign_game', myRoomCode);
                }
                location.reload();
            }
        });
    }

    socket.on('disconnect', () => {
        const sText = document.getElementById('status-text');
        if (sText) {
            sText.innerText = 'Conexão perdida. Tentando reconectar...';
            sText.style.background = 'rgba(239, 68, 68, 0.2)';
        }
    });

    socket.on('connect', () => {
        const sText = document.getElementById('status-text');
        if (sText && myRoomCode) {
            sText.style.background = '';
            sText.style.borderColor = '';
            socket.emit('join_room', { code: myRoomCode, sessionId: getSessionId() });
        }
    });

    console.log('Xadrez Giacomel Art Pronto!');
});

function startRoomClock() {
    if (roomInterval) clearInterval(roomInterval);
    roomInterval = setInterval(() => {
        if (isGameOver || isTimerPaused || isNoClockMode) return;
        
        const turn = game.turn();
        if (isLocalMode) {
            localTimers[turn]--;
            if (localTimers[turn] <= 0) endGame(turn === 'w' ? 'Pretas (Tempo)' : 'Brancas (Tempo)');
        } else {
            remoteTimers[turn]--;
        }
        updateTimerDisplay();
    }, 1000);
}

function updateTimerDisplay() {
    const timers = isLocalMode ? localTimers : remoteTimers;
    const format = (s) => {
        if (s < 0) s = 0;
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };
    const tw = document.querySelector('#timer-white .time');
    const tb = document.querySelector('#timer-black .time');
    if (tw) tw.innerText = format(timers.w);
    if (tb) tb.innerText = format(timers.b);

    document.querySelectorAll('.timer').forEach(t => t.classList.remove('active'));
    const activeTimer = document.querySelector(`#timer-${game.turn() === 'w' ? 'white' : 'black'}`);
    if (activeTimer) activeTimer.classList.add('active');
}

function updateStatus() {
    const statusText = document.getElementById('status-text');
    if (!statusText) return;
    
    if (isGameOver) return;
    if (isTimerPaused) {
        statusText.innerText = 'Partida Pausada';
        return;
    }

    const isMyTurn = isLocalMode || (game.turn() === playerColor);
    statusText.innerText = isMyTurn ? 'Sua Vez' : 'Aguardando Oponente...';
    statusText.style.background = '';
    statusText.style.borderColor = '';
}

function startLocalGame() {
    isLocalMode = true;
    showScreen('game-screen');
    localTimers = { w: 600, b: 600 };
    initBoard();
    startRoomClock();
    updateStatus();
    const pauseBtn = document.getElementById('pause-timer-btn');
    if (pauseBtn) {
        pauseBtn.innerText = 'Pausar Relógio';
        pauseBtn.classList.remove('paused');
    }
}

function updateTurnIndicator(turn) {
    updateStatus();
}

function endGame(winner) {
    isGameOver = true;
    if (roomInterval) clearInterval(roomInterval);
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = `Fim de Jogo! Vencedor: ${winner}`;
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.style.display = 'block';
}

function resetToMenu() {
    window.location.search = ''; 
}

