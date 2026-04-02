const express = require('express');
const router = express.Router();
const Game = require('../models/Game');

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

// Endpoint para buscar status de uma sala específica
router.get('/games/:code', async (req, res) => {
    try {
        const game = await Game.findOne({ where: { roomCode: req.params.code } });
        if (!game) return res.status(404).json({ error: 'Não encontrado.' });
        res.json(game);
    } catch (err) {
        res.status(500).json({ error: 'Erro interno.' });
    }
});

module.exports = router;
