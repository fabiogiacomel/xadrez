const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const Move = require('../models/Move');
const sequelize = require('../config/database');

// Endpoint para listar todos os jogos (Exemplo Antigravity Bot)
router.get('/games', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        const games = await Game.findAll({
            limit: 50,
            order: [['updatedAt', 'DESC']]
        });
        res.json(games);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Endpoint para buscar status de uma sala específica (incluindo último movimento)
router.get('/games/:code', async (req, res) => {
    try {
        const game = await Game.findOne({ where: { roomCode: req.params.code } });
        if (!game) return res.status(404).json({ error: 'Não encontrado.' });

        const lastMove = await Move.findOne({
            where: { gameId: game.id },
            order: [['createdAt', 'DESC']]
        });

        res.json({
            ...game.get({ plain: true }),
            lastMove
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Endpoint para buscar histórico completo de movimentos de uma sala
router.get('/games/:code/history', async (req, res) => {
    try {
        const game = await Game.findOne({ where: { roomCode: req.params.code } });
        if (!game) return res.status(404).json({ error: 'Não encontrado.' });

        const moves = await Move.findAll({
            where: { gameId: game.id },
            order: [['createdAt', 'ASC']]
        });

        res.json({
            game: {
                roomCode: game.roomCode,
                status: game.status,
                winner: game.winner
            },
            moves
        });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Endpoint para exportar o jogo em formato JSONL (para treinamento de LLM)
router.get('/games/:code/jsonl', async (req, res) => {
    try {
        const game = await Game.findOne({ where: { roomCode: req.params.code } });
        if (!game) return res.status(404).send('Não encontrado.');

        const moves = await Move.findAll({
            where: { gameId: game.id },
            order: [['createdAt', 'ASC']]
        });

        let jsonlString = '';
        for (let i = 0; i < moves.length; i++) {
            const currentMove = moves[i];
            const nextMove = moves[i + 1];

            if (currentMove.event === 'move' && nextMove && nextMove.event === 'move') {
                const entry = {
                    prompt: `Tabuleiro FEN: ${currentMove.fen}\nTurno: ${currentMove.player === 'w' ? 'Brancas' : 'Pretas'}\nÚltima jogada: ${currentMove.move}`,
                    completion: nextMove.move
                };
                jsonlString += JSON.stringify(entry) + '\n';
            }
        }

        res.setHeader('Content-Type', 'application/x-jsonlines');
        res.setHeader('Content-Disposition', `attachment; filename=game_${req.params.code}.jsonl`);
        res.send(jsonlString);
    } catch (err) {
        res.status(500).send('Erro interno.');
    }
});

// Endpoint para sincronizar o banco de dados (útil ao subir novas tabelas como 'Moves')
router.post('/db/sync', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        // alter: true tenta atualizar as tabelas sem deletar os dados existentes
        await sequelize.sync({ alter: true });
        res.json({ message: 'Banco de dados sincronizado com sucesso.' });
    } catch (err) {
        console.error('Erro ao sincronizar banco:', err);
        res.status(500).json({ error: 'Erro ao sincronizar banco de dados.' });
    }
});

// Endpoint para verificar o estado/saúde do banco de dados
router.get('/db/status', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        const gameCount = await Game.count();
        const moveCount = await Move.count();

        // Verificar conexão
        await sequelize.authenticate();

        res.json({
            status: 'online',
            connection: 'OK',
            database: process.env.DB_NAME,
            counts: {
                games: gameCount,
                moves: moveCount
            }
        });
    } catch (err) {
        console.error('Erro ao verificar Status do BD:', err);
        res.status(500).json({
            status: 'error',
            error: err.message
        });
    }
});

module.exports = router;
