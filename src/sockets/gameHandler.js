const { Chess } = require('chess.js');
const Game = require('../models/Game');
const Move = require('../models/Move');

/**
 * Geração de código de sala de 6 dígitos alfanuméricos
 */
const generateCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

/**
 * Converte o estado do chess.js (board()) para um objeto estilo chessboard.js {'a1': 'wR'}
 */
const getBoardSnapshot = (chess) => {
    try {
        const board = {};
        const ranks = '87654321';
        const files = 'abcdefgh';
        const raw = chess.board();
        
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                const piece = raw[i][j];
                if (piece) {
                    const square = files[j] + ranks[i];
                    board[square] = piece.color + piece.type.toUpperCase();
                }
            }
        }
        return board;
    } catch (e) {
        return {};
    }
};

// Mapa socket.id -> código de sala (para desconexão)
const socketToRoom = new Map();

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`🔌 Usuário conectado: ${socket.id}`);

        // ==================== CRIAR SALA ====================
        socket.on('create_room', async ({ settings = {}, sessionId }) => {
            try {
                if (!sessionId) return socket.emit('error_message', 'SessionId é obrigatório');

                const code = generateCode();

                const game = await Game.create({
                    roomCode: code,
                    noClock: !!settings.noClock,
                    status: settings.local ? 'playing' : 'waiting',
                    whiteSessionId: sessionId,
                    timerWhite: 600,
                    timerBlack: 600,
                    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                    turn: 'w',
                    lastMoveTimestamp: settings.local ? new Date() : null
                });

                socket.join(code);
                socketToRoom.set(socket.id, code);

                // Se for jogo local, já cria o primeiro movimento (estado inicial)
                if (settings.local) {
                    await Move.create({
                        gameId: game.id,
                        fen: game.fen,
                        move: null,
                        player: 'w',
                        event: 'start',
                        boardSnapshot: getBoardSnapshot(new Chess(game.fen)),
                        metadata: { local: true, timers: { w: 600, b: 600 } }
                    });
                }

                socket.emit('room_created', {
                    code,
                    color: 'w',
                    settings: { noClock: game.noClock, local: settings.local }
                });

            } catch (err) {
                console.error('Erro ao criar sala:', err);
                socket.emit('error_message', 'Erro ao criar sala.');
            }
        });

        // ==================== ENTRAR NA SALA ====================
        socket.on('join_room', async ({ code, sessionId }) => {
            try {
                if (!code || !sessionId) return socket.emit('error_message', 'Dados incompletos.');
                const roomCode = code.toUpperCase();

                const game = await Game.findOne({ where: { roomCode } });
                if (!game) return socket.emit('error_message', 'Sala não encontrada.');

                socket.join(roomCode);
                socketToRoom.set(socket.id, roomCode);

                // Reconexão
                if (sessionId === game.whiteSessionId || sessionId === game.blackSessionId) {
                    const color = sessionId === game.whiteSessionId ? 'w' : 'b';

                    if (game.paused && game.status === 'playing') {
                        await game.update({ paused: false, lastMoveTimestamp: new Date() });
                        io.to(roomCode).emit('pause_updated', { paused: false });
                    }

                    return socket.emit('game_start', {
                        code: game.roomCode,
                        fen: game.fen,
                        timers: { w: game.timerWhite, b: game.timerBlack },
                        playerColor: color,
                        settings: { noClock: game.noClock, paused: game.paused }
                    });
                }

                // Novo jogador (Pretas)
                if (game.status !== 'waiting') {
                    return socket.emit('error_message', 'Esta sala não está mais disponível.');
                }

                await game.update({
                    status: 'playing',
                    blackSessionId: sessionId,
                    lastMoveTimestamp: new Date(),
                    paused: false
                });

                // Registrar o início da partida no histórico de movimentos com súmula completa
                await Move.create({
                    gameId: game.id,
                    fen: game.fen,
                    move: null,
                    player: 'w',
                    event: 'start',
                    boardSnapshot: getBoardSnapshot(new Chess(game.fen)),
                    metadata: {
                        timers: { w: game.timerWhite, b: game.timerBlack },
                        settings: { noClock: game.noClock }
                    }
                });

                // Notifica ambos
                io.to(roomCode).emit('game_start', {
                    code: game.roomCode,
                    fen: game.fen,
                    timers: { w: game.timerWhite, b: game.timerBlack },
                    settings: { noClock: game.noClock }
                });

            } catch (err) {
                console.error('Erro ao entrar na sala:', err);
                socket.emit('error_message', 'Erro ao entrar na sala.');
            }
        });

        // ==================== FAZER JOGADA ====================
        socket.on('make_move', async ({ code, move }) => {
            try {
                const game = await Game.findOne({ where: { roomCode: code } });
                if (!game || game.status !== 'playing' || game.paused) {
                    return socket.emit('error_message', 'Partida indisponível ou pausada.');
                }

                const chess = new Chess();
                if (game.pgn) {
                    chess.loadPgn(game.pgn);
                } else if (game.fen) {
                    chess.load(game.fen);
                }
                const result = chess.move(move);

                if (!result) return socket.emit('error_message', 'Movimento inválido.');

                const now = new Date();
                let whiteTime = game.timerWhite;
                let blackTime = game.timerBlack;

                if (!game.noClock && game.lastMoveTimestamp) {
                    const elapsed = Math.floor((now - new Date(game.lastMoveTimestamp)) / 1000);
                    if (game.turn === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
                    else blackTime = Math.max(0, blackTime - elapsed);
                }

                let status = 'playing';
                let winner = null;

                if (chess.isGameOver()) {
                    status = 'finished';
                    if (chess.isCheckmate()) winner = chess.turn() === 'w' ? 'Pretas' : 'Brancas';
                    else if (chess.isDraw()) winner = 'Empate';
                }

                const playerWhoMoved = game.turn;

                await game.update({
                    fen: chess.fen(),
                    pgn: chess.pgn(),
                    turn: chess.turn(),
                    status,
                    winner,
                    timerWhite: whiteTime,
                    timerBlack: blackTime,
                    lastMoveTimestamp: now
                });

                // SALVAR NOVO MOVIMENTO NO BANCO DE DADOS (SÚMULA COMPLETA)
                await Move.create({
                    gameId: game.id,
                    fen: chess.fen(),
                    move: result.san || result.lan || JSON.stringify(result),
                    player: playerWhoMoved,
                    isCheck: chess.isCheck(),
                    isCheckmate: chess.isCheckmate(),
                    isDraw: chess.isDraw(),
                    event: 'move',
                    boardSnapshot: getBoardSnapshot(chess),
                    metadata: {
                        timers: { w: whiteTime, b: blackTime },
                        turn: chess.turn(),
                        status,
                        winner
                    }
                });

                io.to(code).emit('move_made', {
                    fen: chess.fen(),
                    move: result,
                    timers: { w: whiteTime, b: blackTime },
                    turn: chess.turn(),
                    status,
                    winner
                });

            } catch (err) {
                console.error('Erro ao fazer jogada:', err);
                socket.emit('error_message', 'Erro ao processar jogada.');
            }
        });

        // ==================== RELÓGIO E PAUSA ====================
        socket.on('add_time', async (code) => {
            try {
                const game = await Game.findOne({ where: { roomCode: code } });
                if (!game) return;

                const newW = game.timerWhite + 300;
                const newB = game.timerBlack + 300;

                await game.update({ timerWhite: newW, timerBlack: newB });
                io.to(code).emit('timer_update', { timers: { w: newW, b: newB } });
            } catch (e) {
                console.error('Erro ao adicionar tempo:', e);
            }
        });

        socket.on('toggle_pause', async (code) => {
            try {
                const game = await Game.findOne({ where: { roomCode: code } });
                if (!game) return;

                const newPaused = !game.paused;
                await game.update({
                    paused: newPaused,
                    lastMoveTimestamp: newPaused ? null : new Date()
                });

                io.to(code).emit('pause_updated', { paused: newPaused });
            } catch (e) {
                console.error('Erro ao pausar:', e);
            }
        });

        socket.on('resign_game', async (code) => {
            try {
                const game = await Game.findOne({ where: { roomCode: code } });
                if (game) {
                    await game.update({ status: 'finished', winner: 'Desistência' });

                    // Salvar evento de desistência no banco
                    const chess = new Chess(game.fen);
                    await Move.create({
                        gameId: game.id,
                        fen: game.fen,
                        move: null,
                        player: game.turn,
                        event: 'resign',
                        boardSnapshot: getBoardSnapshot(chess),
                        metadata: {
                            timers: { w: game.timerWhite, b: game.timerBlack },
                            winner: 'Desistência'
                        }
                    });

                    io.to(code).emit('game_over', { winner: 'Desistência' });
                }
            } catch (e) { console.error('Erro ao desistir:', e); }
        });

        // ==================== DESCONEXÃO ====================
        socket.on('disconnect', async () => {
            const roomCode = socketToRoom.get(socket.id);
            if (!roomCode) return;

            socketToRoom.delete(socket.id);

            const game = await Game.findOne({ where: { roomCode } });
            if (game && game.status === 'playing') {
                await game.update({ paused: true });

                io.to(roomCode).emit('player_disconnected', {
                    message: 'Oponente desconectado. Relógio pausado.'
                });
                io.to(roomCode).emit('pause_updated', { paused: true });
            }
        });
    });
};
