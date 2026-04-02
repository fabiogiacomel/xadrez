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
    methods: ["GET", "POST"]
  }
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
                whiteSessionId: sessionId // Armazena a sessão do criador (Brancas)
            });

            socket.join(code);
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

            // Lógica de Reconexão: Verifica se o sessionId já pertence a esta sala
            if (sessionId === game.whiteSessionId || sessionId === game.blackSessionId) {
                const color = (sessionId === game.whiteSessionId) ? 'w' : 'b';
                socket.join(code);
                return socket.emit('game_start', {
                    code: game.roomCode,
                    fen: game.fen,
                    timers: { w: game.timerWhite, b: game.timerBlack },
                    settings: { noClock: game.noClock, paused: game.paused },
                    playerColor: color, // Reconexão: Informa ao cliente qual é a cor dele
                    players: [
                        { id: 'remoto_w', color: 'w' },
                        { id: 'remoto_b', color: 'b' }
                    ]
                });
            }

            // Novo jogador tentando entrar
            if (game.status === 'playing') {
                return socket.emit('error_message', 'Esta partida já está cheia.');
            }

            if (game.status !== 'waiting') {
                return socket.emit('error_message', 'Esta partida já foi encerrada.');
            }

            // Segundo jogador entra (Pretas)
            await game.update({
                status: 'playing',
                blackSessionId: sessionId,
                lastMoveTimestamp: new Date()
            });

            socket.join(code);
            io.to(code).emit('game_start', {
                code: game.roomCode,
                fen: game.fen,
                timers: { w: game.timerWhite, b: game.timerBlack },
                settings: { noClock: game.noClock },
                playerColor: 'b', // Novo jogador é sempre pretas
                players: [
                    { id: 'remoto_w', color: 'w' },
                    { id: 'remoto_b', color: 'b' }
                ]
            });
        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Erro ao processar entrada na sala.');
        }
    });

    // Fazer Jogada (Online)
    socket.on('make_move', async ({ code, move }) => {
        try {
            const gameRecord = await Game.findOne({ where: { roomCode: code } });
            if (!gameRecord || gameRecord.status !== 'playing') return;

            const chess = new Chess(gameRecord.fen);
            if (chess.turn() !== gameRecord.turn) {
                return socket.emit('error_message', 'Não é seu turno.');
            }

            const result = chess.move(move);
            if (result) {
                const now = new Date();
                let whiteTime = gameRecord.timerWhite;
                let blackTime = gameRecord.timerBlack;

                if (!gameRecord.noClock && !gameRecord.paused && gameRecord.lastMoveTimestamp) {
                    const elapsed = Math.floor((now - new Date(gameRecord.lastMoveTimestamp)) / 1000);
                    if (gameRecord.turn === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
                    else blackTime = Math.max(0, blackTime - elapsed);
                }

                let status = 'playing';
                let winner = null;

                if (chess.isCheckmate()) {
                    status = 'finished';
                    winner = gameRecord.turn === 'w' ? 'Brancas' : 'Pretas';
                } else if (chess.isDraw()) {
                    status = 'finished';
                    winner = 'Empate';
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
                socket.emit('error_message', 'Movimento rejeitado.');
            }
        } catch (err) {
            console.error(err);
            socket.emit('error_message', 'Erro crítico ao processar jogada.');
        }
    });

    socket.on('add_time', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game || game.status !== 'playing') return;

            await game.update({
                timerWhite: game.timerWhite + 300,
                timerBlack: game.timerBlack + 300
            });

            io.to(code).emit('timer_update', { 
                timers: { w: game.timerWhite + 300, b: game.timerBlack + 300 } 
            });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('toggle_pause', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game || game.status !== 'playing') return;

            const isPaused = !game.paused;
            await game.update({
                paused: isPaused,
                // Se estiver despausando, recomeça o cronômetro do zero
                lastMoveTimestamp: isPaused ? null : new Date()
            });

            io.to(code).emit('pause_updated', { paused: isPaused });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('resign_game', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game || game.status !== 'playing') return;

            // Simple resignation logic: the one who resigned loses.
            // As we don't have login, we don't strictly know who resigned here,
            // but the front-end handles the button click.
            await game.update({ status: 'finished', winner: 'Abandono' });
            io.to(code).emit('move_made', { 
                fen: game.fen, 
                move: null, 
                timers: { w: game.timerWhite, b: game.timerBlack }, 
                status: 'finished', 
                winner: 'Abandono' 
            });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('restart_game', async (code) => {
        try {
            const game = await Game.findOne({ where: { roomCode: code } });
            if (!game || game.status !== 'finished') return;

            await game.update({
                fen: 'start',
                pgn: '',
                turn: 'w',
                status: 'playing',
                timerWhite: 600,
                timerBlack: 600,
                lastMoveTimestamp: new Date(),
                winner: null
            });

            io.to(code).emit('game_restart', {
                fen: 'start',
                timers: { w: 600, b: 600 },
                settings: { noClock: game.noClock },
                players: [
                    { id: 'remoto', color: 'w' },
                    { id: socket.id, color: 'b' }
                ]
            });
        } catch (err) {
            console.error(err);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
});
