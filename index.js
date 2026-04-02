require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');
const cors = require('cors');
const sequelize = require('./src/config/database');
const Game = require('./src/models/Game');
const apiRoutes = require('./src/routes/api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true,
  transports: ['websocket', 'polling'], // Prioriza WebSocket mas aceita polling se necessário
  pingTimeout: 60000,
  pingInterval: 25000
});

app.set('io', io);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/antigravity', apiRoutes);

// Sincronizar Banco de Dados
sequelize.sync().then(() => {
    console.log('Banco de Dados MySQL Sincronizado.');
}).catch(err => {
    console.error('Erro ao sincronizar MySQL:', err);
});

// Loop Global de Monitoramento de Tempo (Lazy Evaluation)
// Executa a cada 5 segundos para decretar vitórias por tempo "offline"
setInterval(async () => {
    const { Op } = require('sequelize');
    try {
        const now = new Date();
        // Encontra partidas ativas onde o tempo do jogador da vez expirou
        const activeGames = await Game.findAll({
            where: {
                status: 'playing',
                paused: false,
                noClock: false,
                lastMoveTimestamp: { [Op.ne]: null }
            }
        });

        for (const game of activeGames) {
            const elapsed = Math.floor((now - new Date(game.lastMoveTimestamp)) / 1000);
            const currentTimer = game.turn === 'w' ? game.timerWhite : game.timerBlack;

            if (currentTimer - elapsed <= 0) {
                const winnerColor = game.turn === 'w' ? 'Pretas' : 'Brancas';
                await game.update({
                    status: 'finished',
                    winner: `${winnerColor} (Tempo)`,
                    timerWhite: game.turn === 'w' ? 0 : game.timerWhite,
                    timerBlack: game.turn === 'b' ? 0 : game.timerBlack
                });
                io.to(game.roomCode).emit('game_over_time', { winner: `${winnerColor} (Tempo)` });
            }
        }
    } catch (err) {
        console.error('Erro no loop de tempo:', err);
    }
}, 5000);

function generateCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Mapeamento de socket.id para código de sala para facilitar desconexão
const socketToRoom = new Map();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Criar Sala (Online)
    socket.on('create_room', async ({ settings = {}, sessionId }) => {
        try {
            const code = generateCode();
            const game = await Game.create({
                roomCode: code,
                noClock: !!settings.noClock,
                status: 'waiting',
                whiteSessionId: sessionId
            });

            socket.join(code);
            socketToRoom.set(socket.id, code);
            
            socket.emit('room_created', { 
                code: game.roomCode, 
                color: 'w', 
                settings: { noClock: game.noClock } 
            });
            console.log(`Room ${game.roomCode} created with sessionId: ${sessionId}`);
        } catch (err) {
            socket.emit('error_message', 'Erro ao criar sala no banco.');
        }
    });

    // Entrar em Sala / Reconectar (Online)
    socket.on('join_room', async ({ code, sessionId }) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });

            if (!game) {
                return socket.emit('error_message', 'Sala não encontrada.');
            }

            socket.join(code);
            socketToRoom.set(socket.id, code);

            // Se for reconexão de um jogador existente
            if (sessionId === game.whiteSessionId || sessionId === game.blackSessionId) {
                const color = (sessionId === game.whiteSessionId) ? 'w' : 'b';
                
                // Se estava pausado por desconexão, retoma
                if (game.paused && game.status === 'playing') {
                    await game.update({ paused: false, lastMoveTimestamp: new Date() });
                    io.to(code).emit('pause_updated', { paused: false });
                }

                return socket.emit('game_start', {
                    code: game.roomCode,
                    fen: game.fen,
                    timers: { w: game.timerWhite, b: game.timerBlack },
                    settings: { noClock: game.noClock, paused: false },
                    playerColor: color,
                    players: [{ color: 'w' }, { color: 'b' }]
                });
            }

            // Novo jogador (Pretas)
            if (game.status === 'playing') return socket.emit('error_message', 'Partida cheia.');
            if (game.status !== 'waiting') return socket.emit('error_message', 'Partida encerrada.');

            await game.update({
                status: 'playing',
                blackSessionId: sessionId,
                lastMoveTimestamp: new Date(),
                paused: false
            });

            // Avisa o novo jogador (Pretas)
            socket.emit('game_start', {
                code: game.roomCode,
                fen: game.fen,
                timers: { w: game.timerWhite, b: game.timerBlack },
                settings: { noClock: game.noClock },
                playerColor: 'b'
            });

            // Avisa o criador (Brancas)
            socket.to(code).emit('game_start', {
                code: game.roomCode,
                fen: game.fen,
                timers: { w: game.timerWhite, b: game.timerBlack },
                settings: { noClock: game.noClock },
                playerColor: 'w'
            });

        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Erro ao processar entrada.');
        }
    });

    // Fazer Jogada (Online)
    socket.on('make_move', async ({ code, move }) => {
        try {
            const gameRecord = await Game.findOne({ where: { roomCode: code } });
            if (!gameRecord || gameRecord.status !== 'playing' || gameRecord.paused) {
                return socket.emit('error_message', 'Partida pausada ou indisponível.');
            }

            const chess = new Chess(gameRecord.fen);
            if (chess.turn() !== gameRecord.turn) {
                return socket.emit('error_message', 'Não é seu turno.');
            }

            const result = chess.move(move);
            if (result) {
                const now = new Date();
                let whiteTime = gameRecord.timerWhite;
                let blackTime = gameRecord.timerBlack;

                if (!gameRecord.noClock && gameRecord.lastMoveTimestamp) {
                    const elapsed = Math.floor((now - new Date(gameRecord.lastMoveTimestamp)) / 1000);
                    if (gameRecord.turn === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
                    else blackTime = Math.max(0, blackTime - elapsed);
                }

                let status = 'playing';
                let winner = null;
                if (chess.game_over()) {
                    status = 'finished';
                    if (chess.in_checkmate()) winner = chess.turn() === 'w' ? 'Pretas' : 'Brancas';
                    else if (chess.in_draw()) winner = 'Empate';
                }

                await gameRecord.update({
                    fen: chess.fen(),
                    pgn: chess.pgn(),
                    turn: chess.turn(),
                    status,
                    winner,
                    timerWhite: whiteTime,
                    timerBlack: blackTime,
                    lastMoveTimestamp: now
                });

                io.to(code).emit('move_made', {
                    fen: chess.fen(),
                    move: result,
                    timers: { w: whiteTime, b: blackTime },
                    turn: chess.turn(),
                    status,
                    winner
                });
            } else {
                socket.emit('error_message', 'Movimento inválido.');
            }
        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Erro crítico na jogada.');
        }
    });

    socket.on('add_time', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game) return;
            const newW = game.timerWhite + 300;
            const newB = game.timerBlack + 300;
            await game.update({ timerWhite: newW, timerBlack: newB });
            io.to(code).emit('timer_update', { timers: { w: newW, b: newB } });
        } catch (e) {}
    });

    socket.on('toggle_pause', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game) return;
            const newState = !game.paused;
            await game.update({ paused: newState, lastMoveTimestamp: newState ? null : new Date() });
            io.to(code).emit('pause_updated', { paused: newState });
        } catch (e) {}
    });

    socket.on('resign_game', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (game) {
                await game.update({ status: 'finished', winner: 'Desistência' });
                io.to(code).emit('move_made', { status: 'finished', winner: 'Desistência', fen: game.fen });
            }
        } catch (e) {}
    });

    socket.on('restart_game', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game || game.status !== 'finished') return;

            await game.update({
                fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
                pgn: '',
                turn: 'w',
                status: 'playing',
                timerWhite: 600,
                timerBlack: 600,
                lastMoveTimestamp: new Date(),
                paused: false,
                winner: null
            });

            io.to(code).emit('game_restart', {
                fen: 'start',
                timers: { w: 600, b: 600 },
                settings: { noClock: game.noClock }
            });
        } catch (e) {}
    });

    socket.on('disconnect', async () => {
        const roomCode = socketToRoom.get(socket.id);
        if (roomCode) {
            console.log(`Player disconnected from room ${roomCode}`);
            const game = await Game.findOne({ where: { roomCode } });
            if (game && game.status === 'playing') {
                await game.update({ paused: true });
                io.to(roomCode).emit('player_disconnected', { 
                    message: 'Oponente desconectado. O relógio foi pausado até que ele retorne.' 
                });
                io.to(roomCode).emit('pause_updated', { paused: true });
            }
            socketToRoom.delete(socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});

