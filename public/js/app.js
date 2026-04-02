/**
 * Xadrez Premium - Giacomel Art
 * Frontend Logic
 */

// --- PERSISTÊNCIA DE SESSÃO ---
if (!localStorage.getItem('chess_session_id')) {
    localStorage.setItem('chess_session_id', 'sess_' + Math.random().toString(36).substring(2));
}
const mySessionId = localStorage.getItem('chess_session_id');

const socket = io({
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000
});

// --- STATE ---
let board = null;
let game = new Chess();
let myRoomCode = null;
let playerColor = 'w';
let isGameOver = false;
let isLocalMode = false;
let isNoClockMode = false;
let isTimerPaused = false;
let isWaitingForServer = false;
let localTimers = { w: 600, b: 600 };
let remoteTimers = { w: 600, b: 600 };
let roomInterval = null;

// --- CORE FUNCTIONS ---

/**
 * Atualiza o painel de peças capturadas
 */
function updateCapturedPieces() {
    if (!game) return;
    const history = game.history({ verbose: true });
    const capturedWhite = []; // Peças capturadas PELAS brancas (são pretas)
    const capturedBlack = []; // Peças capturadas PELAS pretas (são brancas)

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

    if (playerColor === 'w') {
        render('captured-player', capturedWhite, 'w');
        render('captured-opponent', capturedBlack, 'b');
    } else {
        render('captured-player', capturedBlack, 'b');
        render('captured-opponent', capturedWhite, 'w');
    }
}

/**
 * Atualiza o status textual do jogo
 */
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

/**
 * Atualiza o display dos relógios
 */
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
    const turn = game.turn();
    const activeId = turn === 'w' ? 'timer-white' : 'timer-black';
    document.getElementById(activeId)?.classList.add('active');
}

/**
 * Finaliza o jogo
 */
function endGame(winner) {
    isGameOver = true;
    if (roomInterval) clearInterval(roomInterval);
    const statusText = document.getElementById('status-text');
    if (statusText) statusText.innerText = `Fim de Jogo! Vencedor: ${winner}`;
    const restartBtn = document.getElementById('restart-btn');
    if (restartBtn) restartBtn.hidden = false;
}

/**
 * Atualiza toda a interface após um movimento
 */
function updateGameUI(fen, move, timers, status, winner) {
    if (fen) {
        game.load(fen);
        board.position(fen);
    }
    
    if (timers) {
        if (isLocalMode) localTimers = timers;
        else remoteTimers = timers;
    }
    
    removeHighlights();
    if (move) {
        $(`#board .square-${move.from}`).addClass('highlight-last-move');
        $(`#board .square-${move.to}`).addClass('highlight-last-move');
    }

    updateStatus();
    updateTimerDisplay();
    updateCapturedPieces();
    
    const pgnLog = document.getElementById('pgn-log');
    if (pgnLog) pgnLog.innerText = game.pgn();
    
    if (status === 'finished' || game.game_over()) {
        let finalWinner = winner;
        if (!finalWinner && game.game_over()) {
            if (game.in_checkmate()) finalWinner = (game.turn() === 'w' ? 'Pretas' : 'Brancas');
            else finalWinner = 'Empate';
        }
        endGame(finalWinner);
    }
}

// --- BOARD EVENTS ---

function removeHighlights() {
    $('#board .square-55d63').removeClass('highlight-last-move hint-dot');
}

function onDragStart(source, piece, position, orientation) {
    if (isGameOver || isWaitingForServer || isTimerPaused) return false;
    if (game.game_over()) return false;

    if (!isLocalMode) {
        if ((playerColor === 'w' && piece.search(/^b/) !== -1) ||
            (playerColor === 'b' && piece.search(/^w/) !== -1)) return false;
        if (game.turn() !== playerColor) return false;
    } else {
        if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (game.turn() === 'b' && piece.search(/^w/) !== -1)) return false;
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
        updateGameUI(null, moveObj, localTimers);
        if (myRoomCode) {
            socket.emit('make_move', { code: myRoomCode, move: moveObj });
        }
    } else {
        isWaitingForServer = true;
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

// --- CLOCK ---

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

// --- SCREENS ---

function showScreen(screenId) {
    document.querySelectorAll('main > section').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) {
        target.classList.add('active');
        target.style.display = 'block';
    }
}

function startLocalGame() {
    isLocalMode = true;
    isTimerPaused = false;
    myRoomCode = null;

    // Solicitar código de sala "local" para persistência no banco
    socket.emit('create_room', { 
        settings: { local: true },
        sessionId: localStorage.getItem('chess_session_id') || 'local_' + Math.random().toString(36).substring(2)
    });

    showScreen('game-screen');
    
    // UI Resets
    const roomCodeContainer = document.getElementById('room-code-container');
    if (roomCodeContainer) roomCodeContainer.hidden = true;
    const gameRoomCodeSection = document.getElementById('game-room-code-section');
    if (gameRoomCodeSection) gameRoomCodeSection.hidden = true;
    
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
    updateTimerDisplay();
}

// --- APP INIT ---

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

    menuBtn?.addEventListener('click', () => toggleMenu(true));
    closeMenu?.addEventListener('click', () => toggleMenu(false));
    menuOverlay?.addEventListener('click', () => toggleMenu(false));

    // Links do Menu
    document.getElementById('menu-home')?.addEventListener('click', () => location.reload());
    document.getElementById('menu-local')?.addEventListener('click', () => {
        toggleMenu(false);
        startLocalGame();
    });
    document.getElementById('menu-about')?.addEventListener('click', () => {
        toggleMenu(false);
        showScreen('about-screen');
    });

    // Main Buttons
    document.getElementById('create-online-btn')?.addEventListener('click', () => {
        isLocalMode = false;
        socket.emit('create_room', { sessionId: mySessionId });
        document.getElementById('create-online-btn').innerText = 'CRIANDO...';
    });

    document.getElementById('join-btn')?.addEventListener('click', () => {
        const codeInput = document.getElementById('join-code-input');
        const code = codeInput?.value.trim().toUpperCase();
        if (code) {
            isLocalMode = false;
            socket.emit('join_room', { code, sessionId: mySessionId });
            const joinBtn = document.getElementById('join-btn');
            if (joinBtn) joinBtn.innerText = 'Buscando...';
        }
    });

    // Permitir pressionar Enter no campo de código
    document.getElementById('join-code-input')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('join-btn')?.click();
        }
    });

    document.getElementById('local-game-btn')?.addEventListener('click', () => startLocalGame());

    // Restore Session Controls
    const restoreBtn = document.getElementById('restore-session-btn');
    const restoreInput = document.getElementById('restore-session-input');
    
    restoreBtn?.addEventListener('click', () => restoreInput?.click());
    
    restoreInput?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (data.fen) {
                    isLocalMode = true;
                    showScreen('game-screen');
                    initBoard(data.fen);
                    if (data.pgn) game.load_pgn(data.pgn);
                    if (data.timers) localTimers = data.timers;
                    updateStatus();
                    updateCapturedPieces();
                    updateTimerDisplay();
                    startRoomClock();
                    alert('Sessão restaurada com sucesso!');
                }
            } catch (err) {
                alert('Erro ao carregar arquivo de sessão.');
            }
        };
        reader.readAsText(file);
    });

    // Copy handlers
    const handleCopy = (btn) => {
        const text = btn.parentElement.querySelector('.room-code')?.innerText;
        if (!text || text === '......') return;
        navigator.clipboard.writeText(text);
        const original = btn.innerText;
        btn.innerText = '✓';
        setTimeout(() => btn.innerText = original, 2000);
    };
    document.getElementById('copy-code-btn')?.addEventListener('click', function() { handleCopy(this); });
    document.getElementById('game-copy-code-btn')?.addEventListener('click', function() { handleCopy(this); });

    // Socket Interactions
    socket.on('room_created', ({ code, color, fen }) => {
        myRoomCode = code;
        playerColor = color || 'w';
        if (document.getElementById('my-room-code')) document.getElementById('my-room-code').innerText = code;
        if (document.getElementById('game-room-code')) document.getElementById('game-room-code').innerText = code;
        if (document.getElementById('room-code-container')) document.getElementById('room-code-container').hidden = false;
        if (document.getElementById('game-room-code-section')) document.getElementById('game-room-code-section').hidden = false;
        document.getElementById('status-text').innerText = 'Aguardando oponente...';
    });

    socket.on('game_start', ({ code, fen, playerColor: serverColor, timers }) => {
        myRoomCode = code;
        if (serverColor) playerColor = serverColor;
        isLocalMode = false;
        if (timers) remoteTimers = timers;
        
        showScreen('game-screen');
        initBoard(fen);
        updateStatus();
        updateCapturedPieces();
        startRoomClock();
    });

    socket.on('error_message', (msg) => { 
        alert("Erro: " + msg); 
        const createBtn = document.getElementById('create-online-btn');
        if (createBtn) createBtn.innerText = 'CRIAR PARTIDA ONLINE';
        const joinBtn = document.getElementById('join-btn');
        if (joinBtn) joinBtn.innerText = 'ENTRAR';
    });

    socket.on('game_over_time', ({ winner }) => endGame(winner));
    socket.on('game_over', ({ winner }) => endGame(winner));
    socket.on('player_disconnected', ({ message }) => {
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.innerText = message;
    });

    socket.on('pause_updated', ({ paused }) => {
        isTimerPaused = paused;
        const pauseBtn = document.getElementById('pause-timer-btn');
        if (pauseBtn) {
            pauseBtn.innerText = isTimerPaused ? '▶ Retomar' : '⏸ Pausar';
            pauseBtn.classList.toggle('paused', isTimerPaused);
        }
        updateStatus();
    });

    socket.on('timer_update', ({ timers }) => {
        remoteTimers = timers;
        updateTimerDisplay();
    });

    socket.on('move_made', ({ fen, move, timers, status, winner }) => {
        isWaitingForServer = false;
        updateGameUI(fen, move, timers, status, winner);
    });

    // Timer Controls
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

    document.getElementById('abandon-btn')?.addEventListener('click', () => {
        if (confirm('Abandonar partida?')) {
            if (!isLocalMode && myRoomCode) socket.emit('resign_game', myRoomCode);
            location.reload();
        }
    });

    document.getElementById('restart-btn')?.addEventListener('click', () => {
        location.reload();
    });

    document.getElementById('save-game-btn')?.addEventListener('click', () => {
        const data = {
            fen: game.fen(),
            pgn: game.pgn(),
            timers: isLocalMode ? localTimers : remoteTimers,
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `xadrez_premium_${myRoomCode || 'local'}.json`;
        a.click();
    });

    document.getElementById('download-summary-btn')?.addEventListener('click', async () => {
        if (!isLocalMode && myRoomCode) {
            window.open(`/api/games/${myRoomCode}/history`, '_blank');
        } else {
            const summary = `Xadrez Premium Giacomel\nData: ${new Date().toLocaleString()}\nPGN:\n${game.pgn()}`;
            const blob = new Blob([summary], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `sumula_xadrez.txt`;
            a.click();
        }
    });

    console.log('Xadrez Giacomel Art Pronto!');
});
