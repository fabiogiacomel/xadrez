require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const sequelize = require('./src/config/database');
const Game = require('./src/models/Game');
const Move = require('./src/models/Move');
const { Chess } = require('chess.js');

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
    } catch (e) { return {}; }
};
const apiRoutes = require('./src/routes/api');
const gameHandler = require('./src/sockets/gameHandler');

// ====================== CONFIGURAÇÃO ======================
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    pingTimeout: 45000,
    pingInterval: 20000,
    transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());

// Força o navegador a NÃO cachear o index.html e outros arquivos estáticos críticos
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));
app.use('/api', apiRoutes);

app.set('io', io);

// ====================== BANCO DE DADOS ======================
sequelize.sync({ alter: process.env.NODE_ENV === 'development' })
    .then(() => console.log('✅ Banco de Dados sincronizado.'))
    .catch(err => console.error('❌ Erro ao sincronizar BD:', err));

// ====================== MONITORAMENTO DE TEMPO ======================
setInterval(async () => {
    try {
        const { Op } = require('sequelize');
        const now = new Date();

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
            const currentTime = game.turn === 'w' ? game.timerWhite : game.timerBlack;

            if (currentTime - elapsed <= 0) {
                const winner = game.turn === 'w' ? 'Pretas' : 'Brancas';

                await game.update({
                    status: 'finished',
                    winner: `${winner} (Tempo)`,
                    [`timer${game.turn === 'w' ? 'White' : 'Black'}`]: 0
                });

                // Registrar evento de tempo no histórico
                await Move.create({
                    gameId: game.id,
                    fen: game.fen,
                    move: null,
                    player: game.turn, // Quem perdeu por tempo
                    event: 'timeout',
                    boardSnapshot: getBoardSnapshot(new Chess(game.fen)),
                    metadata: {
                        timers: { w: game.timerWhite, b: game.timerBlack },
                        winner: `${winner} (Tempo)`
                    }
                });

                io.to(game.roomCode).emit('game_over_time', { winner: `${winner} (Tempo)` });
            }
        }
    } catch (err) {
        console.error('Erro no loop de checagem de tempo:', err);
    }
}, 5000);

// ====================== SOCKET.IO ======================
// Inicializar os handlers separados
gameHandler(io);

// ====================== INICIALIZAÇÃO ======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
