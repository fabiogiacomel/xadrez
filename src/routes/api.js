const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const { Chess } = require('chess.js');

// Middleware de Autenticação para o Bot Antigravity
const authenticateBot = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const apiKey = authHeader && authHeader.split(' ')[1];

    if (!apiKey || apiKey !== process.env.ANTIGRAVITY_API_KEY) {
        return res.status(401).json({ error: 'Não autorizado. Chave de API inválida.' });
    }
    next();
};

// 1. Criar nova partida (Post por Antigravity)
router.post('/games', authenticateBot, async (req, res) => {
    try {
        const { noClock } = req.body;
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const game = await Game.create({
            roomCode: code,
            noClock: !!noClock,
            status: 'waiting'
        });

        res.json({ roomCode: game.roomCode });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao criar partida no banco.' });
    }
});

// NOVO: Endpoint para Sincronização de Tabelas (Útil se o acesso remoto MySQL estiver bloqueado)
router.get('/setup-db', authenticateBot, async (req, res) => {
    try {
        const sequelize = require('../config/database');
        await sequelize.sync({ alter: true });
        res.json({ success: true, message: 'Banco de dados sincronizado com sucesso diretamente pelo servidor!' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao sincronizar banco pelo servidor.', details: error.message });
    }
});

// 2. Consultar estado da partida
router.get('/games/:code', authenticateBot, async (req, res) => {
    try {
        const game = await Game.findOne({ where: { roomCode: req.params.code } });
        if (!game) return res.status(404).json({ error: 'Partida não encontrada.' });

        res.json(game);
    } catch (error) {
        res.status(500).json({ error: 'Erro ao consultar banco.' });
    }
});

// 3. Executar movimento via API (Bot fazendo a jogada)
router.post('/games/:code/move', authenticateBot, async (req, res) => {
    try {
        const { from, to, promotion } = req.body;
        const gameRecord = await Game.findOne({ where: { roomCode: req.params.code } });

        if (!gameRecord || gameRecord.status !== 'playing') {
            return res.status(400).json({ error: 'Partida não está ativa ou não existe.' });
        }

        const chess = new Chess(gameRecord.fen);
        const moveResult = chess.move({ from, to, promotion: promotion || 'q' });

        if (!moveResult) {
            return res.status(400).json({ error: 'Movimento inválido para esta posição.' });
        }

        // Cálculo de relógio (Lazy Evaluation)
        const now = new Date();
        let newTimer = gameRecord.turn === 'w' ? gameRecord.timerWhite : gameRecord.timerBlack;
        
        if (!gameRecord.noClock && !gameRecord.paused && gameRecord.lastMoveTimestamp) {
            const elapsed = Math.floor((now - new Date(gameRecord.lastMoveTimestamp)) / 1000);
            newTimer = Math.max(0, newTimer - elapsed);
        }

        // Atualiza o registro
        const updateData = {
            fen: chess.fen(),
            pgn: chess.pgn(),
            turn: chess.turn(),
            lastMoveTimestamp: now
        };

        if (gameRecord.turn === 'w') updateData.timerWhite = newTimer;
        else updateData.timerBlack = newTimer;

        if (chess.isCheckmate()) {
            updateData.status = 'finished';
            updateData.winner = gameRecord.turn === 'w' ? 'Brancas' : 'Pretas';
        } else if (chess.isDraw()) {
            updateData.status = 'finished';
            updateData.winner = 'Empate';
        }

        await gameRecord.update(updateData);

        // Notifica o humano via Socket
        const io = req.app.get('io');
        io.to(gameRecord.roomCode).emit('move_made', {
            fen: updateData.fen,
            move: moveResult,
            timers: { w: updateData.timerWhite || gameRecord.timerWhite, b: updateData.timerBlack || gameRecord.timerBlack },
            turn: updateData.turn,
            status: updateData.status || gameRecord.status,
            winner: updateData.winner || gameRecord.winner
        });

        res.json({ success: true, fen: updateData.fen });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao processar movimento.' });
    }
});

module.exports = router;
