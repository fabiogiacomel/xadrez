/**
 * Xadrez Premium - Giacomel Art
 * Frontend Logic (Blindagem Total de Inicialização)
 */

window.App = {
    state: {
        game: null,
        board: null,
        myRoomCode: null,
        playerColor: 'w',
        isGameOver: false,
        isLocalMode: true,
        isTimerPaused: false,
        isWaitingForServer: false,
        timers: { w: 600, b: 600 },
        pgn: '',
        statusText: 'Iniciando...',
        showAbout: false,
        sessionId: localStorage.getItem('chess_session_id') || ('sess_' + Math.random().toString(36).substring(2))
    },

    init() {
        console.log('🚦 [DEBUG] Iniciando App.init()...');
        try {
            localStorage.setItem('chess_session_id', this.state.sessionId);

            // 1. Verificar Motores
            console.log('🔍 [DEBUG] [1] Verificando Chess...');
            if (typeof Chess === 'undefined') throw new Error('Biblioteca Chess.js não carregada!');
            this.state.game = new Chess();
            console.log('✅ [1] Motor Chess OK');

            // 2. Iniciar Socket
            console.log('🔍 [DEBUG] [2] Iniciando Sockets...');
            if (typeof io === 'undefined') {
                console.warn('⚠️ Socket.io não encontrado! Operando em modo offline.');
            } else {
                this.initSocket();
                console.log('✅ [2] Sockets OK');
            }

            // 3. Bindar Eventos
            console.log('🔍 [DEBUG] [3] Bindando Eventos...');
            this.bindEvents();
            console.log('✅ [3] Eventos OK');

            // 4. Render Inicial
            this.render();
            console.log('🏁 [DEBUG] Inicialização CONCLUÍDA com sucesso!');

        } catch (e) {
            console.error('❌ FATAL ERROR NA INICIALIZAÇÃO:', e.message);
            alert('Erro Crítico: ' + e.message);
        }
    },

    initSocket() {
        try {
            this.socket = io({ transports: ['websocket', 'polling'], reconnection: true });
            const s = this.socket;

            s.on('room_created', (data) => {
                console.log('📡 [DEBUG] Sala criada no servidor:', data.code);
                this.updateState({ 
                    myRoomCode: data.code, 
                    playerColor: data.color || 'w', 
                    statusText: (this.state.isLocalMode) ? 'Modo Local (Sincronizado)' : 'Aguardando oponente...' 
                });
                // Só inicializa se o tabuleiro ainda não existir
                if (!this.state.board) {
                    this.initBoard();
                    this.startClock();
                }
            });

            s.on('game_start', (data) => {
                console.log('🎮 [DEBUG] Partida iniciada online.');
                this.updateState({ myRoomCode: data.code, isLocalMode: (data.playerColor === undefined), playerColor: data.playerColor || 'w', timers: data.timers || { w: 600, b:600 }, statusText: 'Partida iniciada!' });
                this.initBoard(data.fen);
                this.startClock();
            });

            s.on('move_made', (data) => {
                if (data.pgn) {
                    this.state.game.load_pgn(data.pgn);
                } else if (data.fen) {
                    this.state.game.load(data.fen);
                }
                this.updateState({ isWaitingForServer: false, timers: data.timers || this.state.timers, isGameOver: data.status === 'finished' });
                if (this.state.board) this.state.board.position(this.state.game.fen());
                this.render();
            });

            s.on('error_message', (msg) => alert('Erro: ' + msg));
            s.on('player_disconnected', (m) => this.updateState({ statusText: m.message }));
            s.on('timer_update', (d) => this.updateState({ timers: d.timers }));
            s.on('pause_updated', (d) => this.updateState({ isTimerPaused: d.paused }));

        } catch (e) {
            console.error('❌ Erro no Socket:', e);
        }
    },

    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.render();
    },

    initBoard(fen) {
        console.log('🎲 [DEBUG] Montando Tabuleiro...');
        try {
            const config = {
                draggable: true,
                position: fen || 'start',
                orientation: (this.state.isLocalMode || this.state.playerColor === 'w') ? 'white' : 'black',
                onDragStart: (s, p) => this.onDragStart(s, p),
                onDrop: (s, t) => this.onDrop(s, t),
                onSnapEnd: () => this.state.board.position(this.state.game.fen()),
                pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
            };
            this.state.board = Chessboard('board', config);
            if (fen) this.state.game.load(fen);
        } catch (e) { console.error('❌ Erro Chessboard:', e); }
    },

    onDragStart(source, piece) {
        if (this.state.isGameOver || this.state.isTimerPaused) return false;
        if (!this.state.isLocalMode) {
            if (this.state.game.turn() !== this.state.playerColor) return false;
            if ((this.state.playerColor === 'w' && piece.search(/^b/) !== -1) ||
                (this.state.playerColor === 'b' && piece.search(/^w/) !== -1)) return false;
        }
    },

    onDrop(source, target) {
        const move = this.state.game.move({ from: source, to: target, promotion: 'q' });
        if (move === null) return 'snapback';

        if (this.state.isLocalMode) {
            this.render();
            if (this.state.myRoomCode) this.socket?.emit('make_move', { code: this.state.myRoomCode, move });
        } else {
            this.updateState({ isWaitingForServer: true });
            this.socket?.emit('make_move', { code: this.state.myRoomCode, move });
        }
    },

    startClock() {
        if (this.clockInterval) clearInterval(this.clockInterval);
        this.clockInterval = setInterval(() => {
            if (this.state.isGameOver || this.state.isTimerPaused) return;
            const turn = this.state.game.turn();
            this.state.timers[turn]--;
            if (this.state.timers[turn] <= 0) this.endGame(turn === 'w' ? 'Pretas' : 'Brancas');
            this.renderTimers();
        }, 1000);
    },

    endGame(winner) {
        this.updateState({ isGameOver: true, statusText: 'Fim de Jogo! Vencedor: ' + winner });
        if (this.clockInterval) clearInterval(this.clockInterval);
    },

    render() {
        const isGameStarted = (this.state.myRoomCode !== null);
        
        ['welcome-screen', 'game-screen', 'about-screen'].forEach(s => {
            const el = document.getElementById(s);
            if (!el) return;
            if (this.state.showAbout) el.classList.toggle('active', s === 'about-screen');
            else if (isGameStarted) el.classList.toggle('active', s === 'game-screen');
            else el.classList.toggle('active', s === 'welcome-screen');
        });

        const statusEl = document.getElementById('status-text');
        if (statusEl) {
            if (this.state.isGameOver) statusEl.innerText = this.state.statusText;
            else if (this.state.isTimerPaused) statusEl.innerText = 'Pausado';
            else statusEl.innerText = (this.state.isLocalMode || (this.state.game.turn() === this.state.playerColor)) ? 'Sua Vez' : 'Vez do Oponente';
        }

        const myCodeSpan = document.getElementById('my-room-code');
        if (myCodeSpan) myCodeSpan.innerText = this.state.myRoomCode || '......';

        const gameCodeSpan = document.getElementById('game-room-code');
        const hideCodes = ['CARREGANDO...', 'LOCAL'];
        if (gameCodeSpan) {
            gameCodeSpan.innerText = (this.state.myRoomCode && !hideCodes.includes(this.state.myRoomCode)) ? this.state.myRoomCode : '';
        }

        if (pgnLog) {
            // Remove os cabeçalhos [Event...], [Site...], [SetUp...], [FEN...] etc. que aparecem ao carregar FEN
            const movesOnly = this.state.game.pgn().replace(/\[.*?\]\n?/g, '').trim();
            pgnLog.innerText = movesOnly || 'Nenhum movimento ainda.';
        }

        this.renderTimers();
        this.renderCapturedPieces();
    },

    renderTimers() {
        const format = (s) => {
            const m = Math.floor(Math.max(0, s) / 60);
            const sec = Math.max(0, s) % 60;
            return `${m}:${sec.toString().padStart(2, '0')}`;
        };
        const tw = document.getElementById('timer-white');
        const tb = document.getElementById('timer-black');
        if (tw) tw.innerText = format(this.state.timers.w);
        if (tb) tb.innerText = format(this.state.timers.b);

        document.querySelectorAll('.timer').forEach(t => t.classList.remove('active'));
        document.getElementById(this.state.game.turn() === 'w' ? 'timer-white' : 'timer-black')?.classList.add('active');
    },

    renderCapturedPieces() {
        const history = this.state.game.history({ verbose: true });
        const caps = { w: [], b: [] };
        history.forEach(m => { if (m.captured) caps[m.color === 'w' ? 'b' : 'w'].push(m.captured); });

        const draw = (id, pieces, color) => {
            const el = document.querySelector(`#${id} .captured-container`);
            if (!el) return;
            el.innerHTML = '';
            pieces.forEach(p => {
                const img = document.createElement('img');
                img.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${(color === 'w' ? 'b' : 'w')}${p.toUpperCase()}.png`;
                img.className = 'captured-piece';
                el.appendChild(img);
            });
        };
        if (this.state.playerColor === 'w') { draw('captured-player', caps.b, 'w'); draw('captured-opponent', caps.w, 'b'); }
        else { draw('captured-player', caps.w, 'b'); draw('captured-opponent', caps.b, 'w'); }
    },

    bindEvents() {
        const listen = (id, evt, fn) => {
            const el = document.getElementById(id);
            if (el) {
                console.log(`🔗 [DEBUG] Listener adicionado em: ${id}`);
                el.addEventListener(evt, fn.bind(this));
            } else {
                console.warn(`⚠️ [DEBUG] Elemento ${id} não encontrado para vínculo de evento.`);
            }
        };

        listen('start-game-btn', 'click', () => {
            console.log('🖱️ [DEBUG] Click em INICIAR!');
            // Força a transição imediata para o modo local
            this.updateState({ 
                myRoomCode: 'LOCAL', 
                isLocalMode: true, 
                statusText: 'Iniciando partida...',
                showAbout: false 
            });
            this.initBoard();
            this.startClock();
            
            // Tenta avisar o servidor para persistência (não bloqueia se falhar)
            if (this.socket) {
                this.socket.emit('create_room', { 
                    settings: { local: true }, 
                    sessionId: this.state.sessionId 
                });
            }
        });

        listen('join-btn', 'click', () => {
            const code = document.getElementById('join-code-input')?.value.trim().toUpperCase();
            if (code && this.socket) this.socket.emit('join_room', { code, sessionId: this.state.sessionId });
        });

        listen('pause-timer-btn', 'click', () => {
            if (this.state.isLocalMode) this.updateState({ isTimerPaused: !this.state.isTimerPaused });
            else this.socket?.emit('toggle_pause', this.state.myRoomCode);
        });

        listen('add-5m-btn', 'click', () => {
            if (this.state.isLocalMode) { this.state.timers.w += 300; this.state.timers.b += 300; this.render(); }
            else this.socket?.emit('add_time', this.state.myRoomCode);
        });

        listen('abandon-btn', 'click', () => {
            if (confirm('Deseja realmente abandonar?')) {
                if (this.socket && !this.state.isLocalMode) this.socket.emit('resign_game', this.state.myRoomCode);
                location.reload();
            }
        });

        listen('menu-home', 'click', () => location.reload());
        listen('menu-about', 'click', () => this.updateState({ showAbout: true }));
        listen('menu-local', 'click', () => {
            document.getElementById('close-menu')?.click();
            document.getElementById('start-game-btn')?.click();
        });
        listen('menu-btn', 'click', () => {
            document.getElementById('side-menu')?.classList.add('active');
            document.getElementById('menu-overlay')?.classList.add('active');
        });
        listen('close-menu', 'click', () => {
            document.getElementById('side-menu')?.classList.remove('active');
            document.getElementById('menu-overlay')?.classList.remove('active');
        });
        listen('menu-overlay', 'click', () => {
            document.getElementById('side-menu')?.classList.remove('active');
            document.getElementById('menu-overlay')?.classList.remove('active');
        });

        listen('restore-session-btn', 'click', () => document.getElementById('restore-session-input')?.click());
        document.getElementById('restore-session-input')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const data = JSON.parse(event.target.result);
                    if (data.fen) {
                        this.updateState({ isLocalMode: true, timers: data.timers || { w: 600, b: 600 } });
                        this.initBoard(data.fen);
                        if (data.pgn) this.state.game.load_pgn(data.pgn);
                        this.startClock();
                        alert('Restaurado!');
                    }
                } catch (err) { alert('Erro no arquivo.'); }
            };
            reader.readAsText(file);
        });

        listen('save-game-btn', 'click', () => {
            const data = { fen: this.state.game.fen(), pgn: this.state.game.pgn(), timers: this.state.timers };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `chess_${this.state.myRoomCode || 'local'}.json`;
            a.click();
        });

        listen('download-summary-btn', 'click', () => {
            if (!this.state.isLocalMode && this.state.myRoomCode) window.open(`/api/games/${this.state.myRoomCode}/history`, '_blank');
            else {
                const summary = `Xadrez Premium\nData: ${new Date().toLocaleString()}\nPGN:\n${this.state.game.pgn()}`;
                const blob = new Blob([summary], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'sumula.txt';
                a.click();
            }
        });

        listen('restart-btn', 'click', () => location.reload());
    }
};

// Helpers globais para compatibilidade com HTML
window.showScreen = (screenId) => {
    if (screenId === 'welcome-screen') {
        App.updateState({ showAbout: false });
    } else if (screenId === 'about-screen') {
        App.updateState({ showAbout: true });
    }
};

// Auto Start
document.addEventListener('DOMContentLoaded', () => {
    console.log('⚡ DOM carregado, disparando App.init()');
    setTimeout(() => App.init(), 100); // 100ms de margem para o DOM respirar no Hostinger
});
