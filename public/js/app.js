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
        isPublic: false,
        publicRooms: [],
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
                console.log('📡 [DEBUG] room_created recebido do servidor:', data.code);
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
                this.updateState({ myRoomCode: data.code, isLocalMode: (data.playerColor === undefined), playerColor: data.playerColor || 'w', timers: data.timers || { w: 600, b: 600 }, statusText: 'Partida iniciada!' });
                this.initBoard(data.fen);
                this.startClock();
            });

            s.on('move_made', (data) => {
                console.log('♟️ [DEBUG] move_made recebido:', data.code);
                try {
                    // Limpa o estado de espera e atualiza timers
                    this.updateState({ isWaitingForServer: false, timers: data.timers || this.state.timers, isGameOver: data.status === 'finished' });

                    // Prioridade 1: Sincronizar pelo FEN (mais robusto)
                    if (data.fen) {
                        this.state.game.load(data.fen);
                        if (this.state.board) this.state.board.position(data.fen);
                    }

                    // Prioridade 2: Sincronizar o PGN para histórico (compatível com v0.x e v1.x)
                    if (data.pgn) {
                        try {
                            if (this.state.game.loadPgn) this.state.game.loadPgn(data.pgn);
                            else if (this.state.game.load_pgn) this.state.game.load_pgn(data.pgn);
                        } catch (pgnErr) {
                            console.warn('⚠️ [DEBUG] PGN não pôde ser carregado sincronizadamente, mas FEN já atualizou.', pgnErr);
                        }
                    }

                    this.render();
                } catch (e) {
                    console.error('❌ [DEBUG] Erro Crítico ao processar move_made:', e);
                    this.updateState({ isWaitingForServer: false }); // Destrava a UI em caso de erro
                }
            });

            s.on('opponent_joined', (data) => {
                console.log('👤 [DEBUG] Oponente entrou:', data.sessionId);
                this.updateState({ 
                    isLocalMode: false, 
                    statusText: 'Oponente conectado! Sua vez (Brancas).' 
                });
            });

            s.on('error_message', (msg) => {
                console.error('❌ [SERVER ERROR]:', msg);
                this.updateState({ statusText: 'Erro: ' + msg });
            });
            s.on('player_disconnected', (m) => this.updateState({ statusText: m.message }));
            s.on('timer_update', (d) => {
                console.log('🕒 [DEBUG] timer_update recebido:', d.timers);
                this.updateState({ timers: d.timers });
            });
            s.on('pause_updated', (d) => this.updateState({ isTimerPaused: d.paused }));
            s.on('public_rooms_list', (rooms) => {
                console.log('📋 [DEBUG] public_rooms_list recebido:', rooms.length);
                this.updateState({ publicRooms: rooms });
            });
            s.on('public_status_updated', (data) => {
                console.log('🌐 [DEBUG] public_status_updated recebido:', data.isPublic);
                this.updateState({ isPublic: data.isPublic });
            });
            s.on('move_rejected', (data) => {
                console.warn('♟️ [SERVER] Jogada recusada pelo servidor. Sincronizando...', data.fen);
                this.syncWithServer(data.fen);
            });

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
            if (this.state.myRoomCode && this.state.myRoomCode !== 'LOCAL') {
                this.socket?.emit('make_move', { code: this.state.myRoomCode, move });
            }
        } else {
            this.updateState({ isWaitingForServer: true });
            this.socket?.emit('make_move', { code: this.state.myRoomCode, move });
        }
    },

    syncWithServer(fen) {
        if (!fen) return;
        this.state.game.load(fen);
        if (this.state.board) this.state.board.position(fen);
        this.render();
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

    fetchPublicRooms() {
        console.log('🔍 [DEBUG] Buscando salas públicas...');
        document.getElementById('public-rooms-section')?.removeAttribute('hidden');
        this.socket?.emit('get_public_rooms');
    },

    renderPublicRooms() {
        const list = document.getElementById('public-rooms-list');
        if (!list) return;

        if (this.state.publicRooms.length === 0) {
            list.innerHTML = '<p class="empty-msg">Nenhuma sala disponível no momento. Seja o primeiro a publicar!</p>';
            return;
        }

        list.innerHTML = this.state.publicRooms.map(room => `
            <div class="room-item">
                <div class="room-info">
                    <span class="room-code-tag">${room.code}</span>
                    <span class="room-meta">Turno: ${room.turn === 'w' ? 'Brancas' : 'Pretas'} | Tempo: ${Math.floor(room.timerWhite / 60)} min</span>
                </div>
                <button class="btn-join-room" onclick="App.joinRoom('${room.code}')">JOGAR</button>
            </div>
        `).join('');
    },

    joinRoom(code) {
        if (this.socket) {
            this.socket.emit('join_room', { code, sessionId: this.state.sessionId });
        }
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

        const pgnLog = document.getElementById('pgn-log');
        if (pgnLog) { const movesOnly = this.state.game.pgn().replace(/\\[.*?\\]/g, '').trim(); pgnLog.innerText = movesOnly || 'Nenhum movimento ainda.'; }

        this.renderTimers();
        this.renderCapturedPieces();
        this.renderPublicRooms();

        const pubBtn = document.getElementById('toggle-public-btn');
        if (pubBtn) {
            pubBtn.classList.toggle('active-public', this.state.isPublic);
            pubBtn.innerHTML = this.state.isPublic ? '🌐 Público On' : '🌍 Público Off';
        }
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

        listen('search-opponent-btn', 'click', () => {
            this.fetchPublicRooms();
        });

        listen('refresh-rooms-btn', 'click', () => {
            this.fetchPublicRooms();
        });

        listen('toggle-public-btn', 'click', () => {
            if (this.state.myRoomCode) {
                const newPublic = !this.state.isPublic;
                this.socket?.emit('toggle_public', { code: this.state.myRoomCode, isPublic: newPublic });
            }
        });

        listen('join-btn', 'click', () => {
            const code = document.getElementById('join-code-input')?.value.trim().toUpperCase();
            if (code && this.socket) this.socket.emit('join_room', { code, sessionId: this.state.sessionId });
        });

        listen('pause-timer-btn', 'click', () => {
            const newPaused = !this.state.isTimerPaused;
            this.updateState({ isTimerPaused: newPaused });
            if (this.state.myRoomCode && this.state.myRoomCode !== 'LOCAL') {
                this.socket?.emit('toggle_pause', this.state.myRoomCode);
            }
        });

        listen('add-5m-btn', 'click', () => {
            // Atualiza localmente para feedback imediato
            this.state.timers.w += 300;
            this.state.timers.b += 300;
            this.render();
            
            // Sincroniza com o servidor/banco de dados
            if (this.state.myRoomCode && this.state.myRoomCode !== 'LOCAL') {
                this.socket?.emit('add_time', this.state.myRoomCode);
            }
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
