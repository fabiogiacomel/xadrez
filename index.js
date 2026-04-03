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

const { getBoardSnapshot } = require('./src/utils/chessUtils');
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
sequelize.authenticate()
    .then(() => {
        console.log('🔗 Conexão com o banco de dados estabelecida com sucesso.');
        return sequelize.sync({ alter: process.env.NODE_ENV === 'development' });
    })
    .then(() => console.log('✅ Tabelas sincronizadas com sucesso.'))
    .catch(err => {
        console.error('❌ ERRO CRÍTICO AO CONECTAR/SINCRONIZAR BANCO DE DADOS:');
        console.error(err.message);
        console.error('⚠️ O servidor continuará rodando, mas operações de banco podem falhar.');
    });

// ====================== MONITORAMENTO DE TEMPO (OTIMIZADO) ======================
const { Op } = require('sequelize');

async function checkGameTimers() {
    try {
        const now = new Date();
        const activeGames = await Game.findAll({
            where: {
                status: 'playing',
                paused: false,
                noClock: false,
                lastMoveTimestamp: { [Op.ne]: null }
            }
        }).catch(() => []);

        // Processar os jogos expirados em paralelo (evita loops bloqueantes)
        await Promise.all(activeGames.map(async (game) => {
            try {
                const elapsed = Math.floor((now - new Date(game.lastMoveTimestamp)) / 1000);
                const currentTime = game.turn === 'w' ? game.timerWhite : game.timerBlack;

                if (currentTime - elapsed <= 0) {
                    const winner = game.turn === 'w' ? 'Pretas' : 'Brancas';

                    await game.update({
                        status: 'finished',
                        winner: `${winner} (Tempo)`,
                        [`timer${game.turn === 'w' ? 'White' : 'Black'}`]: 0
                    }).catch(e => console.error('Falha ao atualizar jogo por timeout:', e));

                    await Move.create({
                        gameId: game.id,
                        fen: game.fen,
                        move: null,
                        player: game.turn,
                        event: 'timeout',
                        boardSnapshot: getBoardSnapshot(new Chess(game.fen)),
                        metadata: { timers: { w: game.timerWhite, b: game.timerBlack }, winner: `${winner} (Tempo)` }
                    }).catch(e => console.error('Falha ao registrar timeout:', e));

                    io.to(game.roomCode).emit('game_over_time', { winner: `${winner} (Tempo)` });
                }
            } catch (innerErr) {
                console.error(`Erro ao processar timeout do jogo ${game.id}:`, innerErr);
            }
        }));
    } catch (err) {
        if (err.name !== 'SequelizeConnectionError' && err.name !== 'SequelizeAccessDeniedError') {
            console.error('Erro no loop de checagem de tempo:', err);
        }
    }
    // Agenda a próxima rodada APÓS o término (evita acúmulo de requisições ao banco)
    setTimeout(checkGameTimers, 5000);
}

checkGameTimers();


// ====================== SOCKET.IO ======================
// Inicializar os handlers separados
gameHandler(io);

// ====================== INICIALIZAÇÃO ======================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
