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
    if (target) {
        target.classList.add('active');
        target.style.display = 'block'; // Ensure it's visible if CSS used display:none
    }
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

function handleLocalMove(move) {
    updateTurnIndicator(game.turn());
    updateTimerDisplay();
    updateStatus();
    updateCapturedPieces();
    const pgnLog = document.getElementById('pgn-log');
    if (pgnLog) pgnLog.innerText = game.pgn();
    if (game.game_over()) {
        let winner = 'Empate';
        if (game.in_checkmate()) winner = (game.turn() === 'w' ? 'Pretas' : 'Brancas');
        endGame(winner);
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
    // Menu Control
    const menuBtn = document.getElementById('menu-btn');
    const sideMenu = document.getElementById('side-menu');
    const closeMenu = document.getElementById('close-menu');
    const menuOverlay = document.getElementById('menu-overlay');

    const toggleMenu = (open) => {
        if (sideMenu) sideMenu.classList.toggle('active', open);
        if (menuOverlay) menuOverlay.classList.toggle('active', open);
        if (menuBtn) menuBtn.setAttribute('aria-expanded', open);
        if (sideMenu) sideMenu.setAttribute('aria-hidden', !open);
    };

    if (menuBtn) menuBtn.addEventListener('click', () => toggleMenu(true));
    if (closeMenu) closeMenu.addEventListener('click', () => toggleMenu(false));
    if (menuOverlay) menuOverlay.addEventListener('click', () => toggleMenu(false));

    // Links do Menu
    document.getElementById('menu-home')?.addEventListener('click', () => {
        location.reload();
    });
    document.getElementById('menu-local')?.addEventListener('click', () => {
        toggleMenu(false);
        startLocalGame();
    });
    document.getElementById('menu-about')?.addEventListener('click', () => {
        alert('Xadrez Premium Giacomel Art - Um projeto de xadrez moderno e performático.');
    });

    // DOM Cache for other elements
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

    // Online Room Buttons
    if (createOnlineBtn) {
        createOnlineBtn.addEventListener('click', () => {
            isLocalMode = false;
            socket.emit('create_room', { sessionId: getSessionId() });
            createOnlineBtn.innerText = 'CRIANDO...';
        });
    }

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

    if (localGameBtn) {
        localGameBtn.addEventListener('click', () => {
            startLocalGame();
        });
    }

    // Restore Session
    const restoreSessionBtn = document.getElementById('restore-session-btn');
    const restoreInput = document.getElementById('restore-session-input');
    if (restoreSessionBtn && restoreInput) {
        restoreSessionBtn.addEventListener('click', () => restoreInput.click());
        restoreInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => {
                    try {
                        const data = JSON.parse(re.target.result);
                        if (data.pgn) {
                            startLocalGame();
                            game.load_pgn(data.pgn);
                            board.position(game.fen());
                            if (data.timers) localTimers = data.timers;
                            updateTimerDisplay();
                            updateStatus();
                            updateCapturedPieces();
                        }
                    } catch(err) {
                        alert('Arquivo inválido.');
                    }
                };
                reader.readAsText(file);
            }
        });
    }

    // Copying codes
    const handleCopy = (btn) => {
        const text = btn.parentElement.querySelector('.room-code')?.innerText;
        if (!text || text === '......') return;
        navigator.clipboard.writeText(text);
        const original = btn.innerText;
        btn.innerText = '✓';
        setTimeout(() => btn.innerText = original, 2000);
    };
    if (copyBtn) copyBtn.addEventListener('click', () => handleCopy(copyBtn));
    if (gameCopyBtn) gameCopyBtn.addEventListener('click', () => handleCopy(gameCopyBtn));

    // Socket Events
    socket.on('room_created', ({ code, color, settings, restored, fen }) => {
        myRoomCode = code;
        playerColor = color || 'w';
        isLocalMode = false;
        
        if (myRoomCodeDisplay) myRoomCodeDisplay.innerText = code;
        if (gameRoomCodeDisplay) gameRoomCodeDisplay.innerText = code;
        if (roomCodeContainer) roomCodeContainer.hidden = false;
        if (gameRoomCodeSection) gameRoomCodeSection.hidden = false;

        if (restored) {
            showScreen('game-screen');
            initBoard(fen);
        } else {
            statusText.innerText = 'Aguardando oponente...';
            if (createOnlineBtn) {
                createOnlineBtn.innerText = 'AGUARDANDO...';
                createOnlineBtn.disabled = true;
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

        if (roomCodeContainer) roomCodeContainer.hidden = true;
        showScreen('game-screen');
        updateStatus();
        initBoard(fen);
        updateCapturedPieces();
        startRoomClock();
    });

    socket.on('player_disconnected', ({ message }) => {
        statusText.innerText = message;
    });

    socket.on('pause_updated', ({ paused }) => {
        isTimerPaused = paused;
        const pauseBtn = document.getElementById('pause-timer-btn');
        if (pauseBtn) {
            pauseBtn.innerText = paused ? '▶ Retomar' : '⏸ Pausar';
            pauseBtn.classList.toggle('paused', paused);
        }
        updateStatus();
    });

    socket.on('timer_update', ({ timers }) => {
        remoteTimers = timers;
        updateTimerDisplay();
    });

    socket.on('move_made', ({ fen, move, turn, status, winner, timers }) => {
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
        updateCapturedPieces();
        const pgnLog = document.getElementById('pgn-log');
        if (pgnLog) pgnLog.innerText = game.pgn();
        
        if (status === 'finished') endGame(winner);
        else updateStatus();
    });

    socket.on('error_message', (msg) => {
        isWaitingForServer = false;
        alert(msg);
        if (board && game) board.position(game.fen());
    });

    // Control buttons logic
    document.getElementById('pause-timer-btn')?.addEventListener('click', () => {
        if (isLocalMode) {
            isTimerPaused = !isTimerPaused;
            document.getElementById('pause-timer-btn').innerText = isTimerPaused ? '▶ Retomar' : '⏸ Pausar';
            updateStatus();
        } else {
            socket.emit('toggle_pause', myRoomCode);
        }
    });

    document.getElementById('add-5m-btn')?.addEventListener('click', () => {
        if (isLocalMode) {
            localTimers.w += 300;
            localTimers.b += 300;
            updateTimerDisplay();
        } else {
            socket.emit('add_time', myRoomCode);
        }
    });

    document.getElementById('save-game-btn')?.addEventListener('click', () => {
        const data = {
            pgn: game.pgn(),
            timers: isLocalMode ? localTimers : remoteTimers,
            date: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `xadrez_save_${new Date().getTime()}.json`;
        a.click();
    });

    document.getElementById('download-summary-btn')?.addEventListener('click', () => {
        alert('Resumo exportado para o histórico!');
        // Simple summary download could reuse save-game-btn logic with more details
    });

    abandonBtn?.addEventListener('click', () => {
        if (confirm('Deseja realmente sair?')) {
            if (!isLocalMode && myRoomCode) socket.emit('resign_game', myRoomCode);
            location.reload();
        }
    });

    socket.on('disconnect', () => {
        statusText.innerText = 'Desconectado do servidor...';
    });

    socket.on('connect', () => {
        if (myRoomCode) socket.emit('join_room', { code: myRoomCode, sessionId: getSessionId() });
    });
});

function startRoomClock() {
    if (roomInterval) clearInterval(roomInterval);
    roomInterval = setInterval(() => {
        if (isGameOver || isTimerPaused || isNoClockMode) return;
        
        const turn = game.turn();
        if (isLocalMode) {
            localTimers[turn]--;
            if (localTimers[turn] <= 0) endGame(turn === 'w' ? 'Pretas' : 'Brancas');
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
    const tw = document.getElementById('timer-white');
    const tb = document.getElementById('timer-black');
    if (tw) tw.innerText = format(timers.w);
    if (tb) tb.innerText = format(timers.b);

    document.querySelectorAll('.timer').forEach(t => t.classList.remove('active'));
    const activeId = game.turn() === 'w' ? 'timer-white' : 'timer-black';
    document.getElementById(activeId)?.classList.add('active');
}

function updateStatus() {
    const statusText = document.getElementById('status-text');
    if (!statusText) return;
    if (isGameOver) return;

    if (isTimerPaused) {
        statusText.innerText = 'Pausado';
        return;
    }

    const isMyTurn = isLocalMode || (game.turn() === playerColor);
    statusText.innerText = isMyTurn ? 'Sua Vez' : 'Vez do Oponente';
}

function startLocalGame() {
    isLocalMode = true;
    isTimerPaused = false; // Reset pause state
    myRoomCode = null; // Clear room code

    // UI Updates
    showScreen('game-screen');
    const roomCodeContainer = document.getElementById('room-code-container');
    if (roomCodeContainer) roomCodeContainer.hidden = true;
    const gameRoomCodeSection = document.getElementById('game-room-code-section');
    if (gameRoomCodeSection) gameRoomCodeSection.hidden = true;
    const createBtn = document.getElementById('create-online-btn');
    if (createBtn) {
        createBtn.innerText = 'CRIAR PARTIDA ONLINE';
        createBtn.disabled = false;
        createBtn.style.opacity = '1';
    }
    const pauseBtn = document.getElementById('pause-timer-btn');
    if (pauseBtn) {
        pauseBtn.innerText = '⏸ Pausar';
        pauseBtn.classList.remove('paused');
    }

    localTimers = { w: 600, b: 600 };
    initBoard();
    updateStatus();
    updateCapturedPieces();
    startRoomClock();
}

function updateTurnIndicator(turn) {
    updateStatus();
    updateTimerDisplay();
}

function updateCapturedPieces() {
    const history = game.history({ verbose: true });
    const capturedWhite = []; // Pieces captured BY white (black pieces)
    const capturedBlack = []; // Pieces captured BY black (white pieces)

    history.forEach(move => {
        if (move.captured) {
            if (move.color === 'w') capturedWhite.push(move.captured);
            else capturedBlack.push(move.captured);
        }
    });

    const render = (containerId, pieces, color) => {
        const container = document.querySelector(`#${containerId} .captured-container`);
        if (!container) return;
        container.innerHTML = '';
        pieces.forEach(p => {
            const img = document.createElement('img');
            const pieceCode = (color === 'w' ? 'b' : 'w') + p.toUpperCase();
            img.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${pieceCode}.png`;
            img.className = 'captured-piece';
            container.appendChild(img);
        });
    };

    // Note: Opponent captured container shows pieces captured by opponent
    // My captured container shows pieces captured by me
    if (playerColor === 'w') {
        render('captured-player', capturedWhite, 'w');
        render('captured-opponent', capturedBlack, 'b');
    } else {
        render('captured-player', capturedBlack, 'b');
        render('captured-opponent', capturedWhite, 'w');
    }
}

function endGame(winner) {
    isGameOver = true;
    if (roomInterval) clearInterval(roomInterval);
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = `Fim de Jogo! Vencedor: ${winner}`;
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.hidden = false;
}
