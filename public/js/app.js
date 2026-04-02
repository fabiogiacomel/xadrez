/**
 * Xadrez Premium - Giacomel Art
 * Frontend Logic (Refactor: State-Driven Architecture)
 */

window.App = {
    // 1. ESTADO CENTRALIZADO (O cérebro da aplicação)
    state: {
        game: new Chess(),
        board: null,
        myRoomCode: null,
        playerColor: 'w',
        isGameOver: false,
        isLocalMode: true,
        isTimerPaused: false,
        isWaitingForServer: false,
        timers: { w: 600, b: 600 },
        pgn: '',
        statusText: 'Pronto para jogar',
        sessionId: localStorage.getItem('chess_session_id') || ('sess_' + Math.random().toString(36).substring(2))
    },

    // 2. INICIALIZAÇÃO
    init() {
        console.log('🚀 Iniciando Xadrez Premium...');
        localStorage.setItem('chess_session_id', this.state.sessionId);
        this.initSocket();
        this.bindEvents();
        this.render(); // Primeira renderização
    },

    // 3. CONEXÃO (SOCKET.IO)
    initSocket() {
        this.socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true
        });

        const s = this.socket;

        s.on('room_created', (data) => {
            this.updateState({
                myRoomCode: data.code,
                playerColor: data.color || 'w',
                statusText: 'Aguardando oponente...'
            });
        });

        s.on('game_start', (data) => {
            this.updateState({
                myRoomCode: data.code,
                isLocalMode: (data.playerColor === undefined),
                playerColor: data.playerColor || 'w',
                timers: data.timers || { w: 600, b:600 },
                statusText: 'Partida iniciada!'
            });
            this.initBoard(data.fen);
            this.startClock();
        });

        s.on('move_made', (data) => {
            if (data.fen) this.state.game.load(data.fen);
            this.updateState({
                isWaitingForServer: false,
                timers: data.timers || this.state.timers,
                isGameOver: data.status === 'finished'
            });
            if (this.state.board) this.state.board.position(this.state.game.fen());
            this.render();
        });

        s.on('pause_updated', (data) => this.updateState({ isTimerPaused: data.paused }));
        s.on('timer_update', (data) => this.updateState({ timers: data.timers }));
        s.on('player_disconnected', (data) => this.updateState({ statusText: data.message }));
        s.on('game_over', (data) => this.endGame(data.winner));
        s.on('error_message', (msg) => alert('Erro: ' + msg));
    },

    // 4. LÓGICA DE JOGO
    updateState(newState) {
        this.state = { ...this.state, ...newState };
        this.render();
    },

    initBoard(fen) {
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
    },

    onDragStart(source, piece) {
        if (this.state.isGameOver || this.state.isTimerPaused) return false;
        if (this.state.game.game_over()) return false;
        
        // No modo online, só move as próprias peças no próprio turno
        if (!this.state.isLocalMode) {
            if (this.state.game.turn() !== this.state.playerColor) return false;
            if ((this.state.playerColor === 'w' && piece.search(/^b/) !== -1) ||
                (this.state.playerColor === 'b' && piece.search(/^w/) !== -1)) return false;
        }
    },

    onDrop(source, target) {
        const move = this.state.game.move({
            from: source,
            to: target,
            promotion: 'q'
        });

        if (move === null) return 'snapback';

        if (this.state.isLocalMode) {
            this.render();
            if (this.state.myRoomCode) {
                this.socket.emit('make_move', { code: this.state.myRoomCode, move });
            }
        } else {
            this.updateState({ isWaitingForServer: true });
            this.socket.emit('make_move', { code: this.state.myRoomCode, move });
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

    // 5. INTERFACE (RENDERIZAÇÃO)
    render() {
        // Atualiza telas
        const screens = ['welcome-screen', 'game-screen', 'about-screen'];
        screens.forEach(s => {
            const el = document.getElementById(s);
            if (el) el.classList.toggle('active', el.id === (this.state.myRoomCode ? 'game-screen' : (this.state.showAbout ? 'about-screen' : 'welcome-screen')));
        });

        // Atualiza texto de status
        const statusEl = document.getElementById('status-text');
        if (statusEl) {
            if (this.state.isGameOver) statusEl.innerText = this.state.statusText;
            else if (this.state.isTimerPaused) statusEl.innerText = 'Pausado';
            else {
                const isMyTurn = this.state.isLocalMode || (this.state.game.turn() === this.state.playerColor);
                statusEl.innerText = isMyTurn ? 'Sua Vez' : 'Vez do Oponente';
            }
        }

        // Atualiza códigos de sala
        const codeDisplay = document.getElementById('room-code-container');
        if (codeDisplay) codeDisplay.hidden = !this.state.myRoomCode;
        
        const myCodeSpan = document.getElementById('my-room-code');
        if (myCodeSpan) myCodeSpan.innerText = this.state.myRoomCode || '......';

        const gameCodeSection = document.getElementById('game-room-code-section');
        if (gameCodeSection) gameCodeSection.hidden = !this.state.myRoomCode;

        const gameCodeSpan = document.getElementById('game-room-code');
        if (gameCodeSpan) gameCodeSpan.innerText = this.state.myRoomCode || '';

        // PGN
        const pgnLog = document.getElementById('pgn-log');
        if (pgnLog) pgnLog.innerText = this.state.game.pgn();

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
        const activeId = this.state.game.turn() === 'w' ? 'timer-white' : 'timer-black';
        document.getElementById(activeId)?.classList.add('active');
    },

    renderCapturedPieces() {
        const history = this.state.game.history({ verbose: true });
        const caps = { w: [], b: [] }; // Peças das BRANCAS capturadas (estão com as pretas), etc.
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
        
        if (this.state.playerColor === 'w') {
            draw('captured-player', caps.b, 'w');
            draw('captured-opponent', caps.w, 'b');
        } else {
            draw('captured-player', caps.w, 'b');
            draw('captured-opponent', caps.b, 'w');
        }
    },

    // 6. EVENTOS (BINDING)
    bindEvents() {
        // Toda interação do usuário passa por aqui
        const listen = (id, evt, fn) => document.getElementById(id)?.addEventListener(evt, fn.bind(this));

        listen('start-game-btn', 'click', () => {
            this.socket.emit('create_room', { settings: { local: true }, sessionId: this.state.sessionId });
            // Não mudamos a tela aqui, esperamos o 'room_created' ou 'game_start'
        });

        listen('join-btn', 'click', () => {
            const code = document.getElementById('join-code-input')?.value.trim().toUpperCase();
            if (code) this.socket.emit('join_room', { code, sessionId: this.state.sessionId });
        });

        listen('pause-timer-btn', 'click', () => {
            if (this.state.isLocalMode) this.updateState({ isTimerPaused: !this.state.isTimerPaused });
            else this.socket.emit('toggle_pause', this.state.myRoomCode);
        });

        listen('add-5m-btn', 'click', () => {
            if (this.state.isLocalMode) {
                this.state.timers.w += 300;
                this.state.timers.b += 300;
                this.render();
            } else this.socket.emit('add_time', this.state.myRoomCode);
        });

        listen('abandon-btn', 'click', () => {
            if (confirm('Deseja realmente abandonar?')) {
                if (!this.state.isLocalMode) this.socket.emit('resign_game', this.state.myRoomCode);
                location.reload();
            }
        });

        listen('menu-home', 'click', () => location.reload());
        listen('menu-about', 'click', () => this.updateState({ showAbout: true, myRoomCode: null }));
        listen('menu-btn', 'click', () => {
            const sideMenu = document.getElementById('side-menu');
            const menuOverlay = document.getElementById('menu-overlay');
            sideMenu?.classList.add('active');
            menuOverlay?.classList.add('active');
        });
        const closeSideMenu = () => {
            const sideMenu = document.getElementById('side-menu');
            const menuOverlay = document.getElementById('menu-overlay');
            sideMenu?.classList.remove('active');
            menuOverlay?.classList.remove('active');
        };
        listen('close-menu', 'click', closeSideMenu);
        listen('menu-overlay', 'click', closeSideMenu);

        listen('restore-session-btn', 'click', () => document.getElementById('restore-session-input')?.click());
        document.getElementById('restore-session-input')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
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
                        alert('Partida restaurada!');
                    }
                } catch (err) { alert('Erro ao carregar arquivo.'); }
            };
            reader.readAsText(file);
        });

        listen('save-game-btn', 'click', () => {
            const data = { fen: this.state.game.fen(), pgn: this.state.game.pgn(), timers: this.state.timers };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `xadrez_${this.state.myRoomCode || 'local'}.json`;
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

// Start
document.addEventListener('DOMContentLoaded', () => App.init());
