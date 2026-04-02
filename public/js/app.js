const socket = io();
let board = null;
let game;
try {
    game = new Chess();
} catch(e) {
    console.error('Chess.js não carregado!');
}
let myRoomCode = null;
let playerColor = 'w';
let isGameOver = false;
let isLocalMode = false;
let shouldFlip = true;
let localTimers = { w: 600, b: 600 };
let localInterval = null;
let isNoClockMode = false;
let isTimerPaused = false;

// DOM Elements
const welcomeScreen = document.getElementById('welcome-screen');
const gameScreen = document.getElementById('game-screen');
const roomCodeContainer = document.getElementById('room-code-container');
const myRoomCodeDisplay = document.getElementById('my-room-code');
const joinCodeInput = document.getElementById('join-code-input');
const joinBtn = document.getElementById('join-btn');
const createOnlineBtn = document.getElementById('create-online-btn');
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
const timersContainer = document.querySelector('.timers');
const add5mBtn = document.getElementById('add-5m-btn');
const pauseTimerBtn = document.getElementById('pause-timer-btn');
const mgmtControls = document.getElementById('game-mgmt-controls');
const downloadSummaryBtn = document.getElementById('download-summary-btn');
const saveGameBtn = document.getElementById('save-game-btn');
const restoreSessionBtn = document.getElementById('restore-session-btn');
const restoreSessionInput = document.getElementById('restore-session-input');

// Menu Elements
const menuBtn = document.getElementById('menu-btn');
const sideMenu = document.getElementById('side-menu');
const menuOverlay = document.getElementById('menu-overlay');
const closeMenuBtn = document.getElementById('close-menu');
const menuHome = document.getElementById('menu-home');
const menuLocal = document.getElementById('menu-local');
const menuAbout = document.getElementById('menu-about');

// 0. Session Management
function getSessionId() {
    let sid = localStorage.getItem('chess_session_id');
    if (!sid) {
        sid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('chess_session_id', sid);
    }
    return sid;
}

// 1. Initial Room Check (Online)
function initSocket() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('room');
    if (code) {
        joinCodeInput.value = code;
        socket.emit('join_room', { code, sessionId: getSessionId() });
    }
    // NÃO criamos mais sala automaticamente aqui!
    
    socket.on('room_created', ({ code, color, settings, restored, fen, timers }) => {
        myRoomCode = code;
        if (myRoomCodeDisplay) myRoomCodeDisplay.innerText = code;
        if (roomCodeContainer) roomCodeContainer.style.display = 'flex';
        if (!isLocalMode) playerColor = color;
        
        // Atualiza a URL sem recarregar para facilitar o compartilhamento
        const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + code;
        window.history.pushState({ path: newUrl }, '', newUrl);

        if (restored) {
            isNoClockMode = settings?.noClock || false;
            isTimerPaused = settings?.paused || false;
            
            welcomeScreen.classList.remove('active');
            gameScreen.classList.add('active');
            mgmtControls.style.display = 'grid';
            timersContainer.style.display = isNoClockMode ? 'none' : 'grid';
            
            statusText.innerText = 'Partida Restaurada!';
            initBoard(fen);
            game.load(fen);
            if (!isNoClockMode) updateTimers(timers);
            updatePauseUI(isTimerPaused);
            updatePGN();
            updateCapturedPieces();
        }
    });
}

// 2. Navigation & Mode Selection
createOnlineBtn.addEventListener('click', () => {
    isLocalMode = false;
    socket.emit('create_room', { sessionId: getSessionId() });
});

joinBtn.addEventListener('click', () => {
    const code = joinCodeInput.value.trim().toUpperCase();
    if (code) {
        isLocalMode = false;
        flipToggleContainer.style.display = 'none';
        socket.emit('join_room', { code, sessionId: getSessionId() });
    }
});

localGameBtn.addEventListener('click', () => {
    isNoClockMode = false;
    timersContainer.style.display = 'grid';
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

if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        if (isLocalMode) {
            startLocalGame();
        } else {
            socket.emit('restart_game', myRoomCode);
        }
    });
}

if (add5mBtn) {
    add5mBtn.addEventListener('click', () => {
        if (isLocalMode) {
            localTimers.w += 300;
            localTimers.b += 300;
            updateTimers(localTimers);
        } else {
            socket.emit('add_time', myRoomCode);
        }
    });
}

if (pauseTimerBtn) {
    pauseTimerBtn.addEventListener('click', () => {
        if (isLocalMode) {
            toggleLocalPause();
        } else {
            socket.emit('toggle_pause', myRoomCode);
        }
    });
}

if (downloadSummaryBtn) {
    downloadSummaryBtn.addEventListener('click', () => {
        const summary = {
            date: new Date().toISOString(),
            pgn: game.pgn(),
            fen: game.fen(),
            winner: isGameOver ? statusText.innerText : 'Em Andamento',
            finalTimers: isLocalMode ? localTimers : 'Online'
        };
        downloadJSON(summary, `sumula_${myRoomCode || 'local'}.json`);
    });
}

if (saveGameBtn) {
    saveGameBtn.addEventListener('click', () => {
        const gameState = {
            type: 'chess-save',
            fen: game.fen(),
            timers: localTimers,
            settings: {
                noClock: isNoClockMode,
                paused: isTimerPaused
            }
        };
        downloadJSON(gameState, `partida_${myRoomCode || 'local'}.json`);
    });
}

if (restoreSessionBtn) {
    restoreSessionBtn.addEventListener('click', () => {
        if (restoreSessionInput) restoreSessionInput.click();
    });
}

restoreSessionInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            console.log('JSON carregado:', data);
            
            if (data.type !== 'chess-save') {
                alert('Erro: O arquivo não é um backup válido de partida (.json).');
                return;
            }
            
            // Restoring
            statusText.innerText = 'Restaurando partida...';
            socket.emit('restore_game', data);
        } catch (err) {
            console.error('Erro ao ler JSON:', err);
            alert('Erro ao processar o arquivo JSON. Verifique se o formato está correto.');
        }
    };
    reader.readAsText(file);
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
    mgmtControls.style.display = 'grid';
    timersContainer.style.display = isNoClockMode ? 'none' : 'grid';
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
    
    initBoard();
    updateTimers(localTimers);
    updateTurnIndicator('w');
    updateCapturedPieces();
    updatePGN();
    if (!isNoClockMode) startLocalTimer();
}

function resetToMenu() {
    isLocalMode = false;
    isGameOver = false;
    isTimerPaused = false;
    stopLocalTimer();
    updatePauseUI(false);
    
    welcomeScreen.classList.add('active');
    gameScreen.classList.remove('active');
    if (roomCodeContainer) roomCodeContainer.style.display = 'none';
    if (joinCodeInput) joinCodeInput.value = '';
    
    flipToggleContainer.style.display = 'none';
    mgmtControls.style.display = 'none';
    restartBtn.style.display = 'none';
    isNoClockMode = false;
    timersContainer.style.display = 'grid';
    // NÃO criamos mais sala automaticamente aqui!
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
    
    let moveObj = { from: source, to: target };
    
    // Identifica se é um peão chegando na última fileira para adicionar a promoção
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
        // Modo Online: Desfaz a jogada local imediatamente e aguarda o servidor
        game.undo(); 
        socket.emit('make_move', { code: myRoomCode, move: moveObj });
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
socket.on('game_start', ({ code, fen, players, timers, settings, playerColor: serverColor }) => {
    isLocalMode = false;
    myRoomCode = code; // Salva o código localmente

    // Sincroniza a URL do navegador para que F5 funcione corretamente
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?room=' + code;
    window.history.pushState({ path: newUrl }, '', newUrl);

    isNoClockMode = settings?.noClock || false;
    isTimerPaused = settings?.paused || false;
    
    flipToggleContainer.style.display = 'none';
    mgmtControls.style.display = 'grid';
    timersContainer.style.display = isNoClockMode ? 'none' : 'grid';
    updatePauseUI(isTimerPaused);
    
    welcomeScreen.classList.remove('active');
    gameScreen.classList.add('active');
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
    
    // Se o servidor enviou a cor explicitamente (Reconexão), usa ela. 
    if (serverColor) {
        playerColor = serverColor;
    } else if (players) {
        const me = players.find(p => p.id === socket.id);
        if (me) playerColor = me.color;
    }

    initBoard(fen);
    game.load(fen);
    if (!isNoClockMode) updateTimers(timers);
    updateTurnIndicator(game.turn());
});

socket.on('move_made', ({ fen, move, timers, turn, status, winner }) => {
    if (isLocalMode) return;
    
    if (move) {
        let moveObj = { from: move.from, to: move.to };
        
        // Aplica a promoção apenas se o servidor confirmar que houve uma
        if (move.promotion) {
            moveObj.promotion = move.promotion;
        }
        
        // Aplica a jogada localmente para preservar o histórico (Súmula)
        const localMove = game.move(moveObj);
        
        if (!localMove) {
            // Apenas em caso de erro extremo
            game.load(fen);
        }
    } else {
        game.load(fen);
    }
    
    // Atualiza a interface gráfica
    board.position(game.fen());

    removeHighlights();
    if (move) {
        $(`#board .square-${move.from}`).addClass('highlight-last-move');
        $(`#board .square-${move.to}`).addClass('highlight-last-move');
    }

    if (!isNoClockMode) updateTimers(timers);
    updatePGN();
    updateCapturedPieces();
    updateTurnIndicator(turn);

    if (status === 'finished') {
        endGame(winner);
    }
});

socket.on('timer_update', ({ timers }) => {
    if (!isLocalMode) {
        localTimers = timers;
        updateTimers(timers);
    }
});

socket.on('game_over_time', ({ winner }) => {
    if (!isLocalMode) endGame(winner, true);
});

socket.on('game_restart', ({ fen, players, timers, settings }) => {
    if (isLocalMode) return;
    
    game.reset();
    isGameOver = false;
    isNoClockMode = settings?.noClock || false;
    isTimerPaused = settings?.paused || false;
    
    timersContainer.style.display = isNoClockMode ? 'none' : 'grid';
    mgmtControls.style.display = 'grid';
    updatePauseUI(isTimerPaused);
    
    const me = players.find(p => p.id === socket.id);
    playerColor = me.color;

    initBoard(fen);
    game.load(fen);
    if (!isNoClockMode) updateTimers(timers);
    updatePGN();
    updateCapturedPieces();
    updateTurnIndicator(game.turn());
    
    restartBtn.style.display = 'none';
    abandonBtn.innerText = 'ABANDONAR PARTIDA';
});

socket.on('error_message', (msg) => {
    statusText.innerText = msg;
    statusText.style.color = '#ef4444';
    
    // Força o tabuleiro a voltar para a posição validada pelo servidor se houver erro
    if (!isLocalMode && board && game) {
        board.position(game.fen());
    }
    
    setTimeout(() => {
        statusText.style.color = '#10b981';
        if (game) updateTurnIndicator(game.turn());
    }, 3000);
});

socket.on('pause_updated', ({ paused }) => {
    isTimerPaused = paused;
    updatePauseUI(paused);
});

// 8. Helpers
function updatePauseUI(paused) {
    if (paused) {
        pauseTimerBtn.innerText = 'Retomar Relógio';
        pauseTimerBtn.classList.add('paused');
        statusText.innerText = 'Relógios Pausados';
    } else {
        pauseTimerBtn.innerText = 'Pausar Relógio';
        pauseTimerBtn.classList.remove('paused');
        if (game) updateTurnIndicator(game.turn());
    }
}

function toggleLocalPause() {
    isTimerPaused = !isTimerPaused;
    updatePauseUI(isTimerPaused);
    if (!isTimerPaused) {
        startLocalTimer();
    } else {
        stopLocalTimer();
    }
}

function downloadJSON(obj, filename) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(obj, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

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
// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    console.log('Xadrez pronto para jogar!');
});
