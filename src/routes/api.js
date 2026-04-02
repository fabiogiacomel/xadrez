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

        const { status } = req.query;
        const where = status ? { status } : {};

        const games = await Game.findAll({
            where,
            limit: 50,
            order: [['updatedAt', 'DESC']]
        });
        res.json(games);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Endpoint para listar apenas partidas em tempo real (ativas)
router.get('/games/live', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        const activeGames = await Game.findAll({
            where: { status: 'playing' },
            order: [['updatedAt', 'DESC']]
        });

        const liveData = await Promise.all(activeGames.map(async (game) => {
            const lastMove = await Move.findOne({
                where: { gameId: game.id },
                order: [['createdAt', 'DESC']]
            });
            return {
                roomCode: game.roomCode,
                fen: game.fen,
                turn: game.turn,
                timers: { w: game.timerWhite, b: game.timerBlack },
                lastMove: lastMove ? lastMove.move : null,
                updatedAt: game.updatedAt
            };
        }));

        res.json(liveData);
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

// Endpoint para uma LLM criar uma nova sala
router.post('/games', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        const { settings = {} } = req.body;
        
        // Gerador de código (reutilizando a lógica do handler se estivesse exportada, mas faremos aqui)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = '';
        for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

        const game = await Game.create({
            roomCode: code,
            noClock: !!settings.noClock,
            status: 'waiting',
            whiteSessionId: 'llm_session_' + Date.now(),
            fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
            turn: 'w'
        });

        res.status(201).json({
            roomCode: game.roomCode,
            color: 'w',
            message: 'Sala criada. Forneça o código ao oponente.'
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar sala via API.' });
    }
});

// Endpoint para uma LLM realizar uma jogada
router.post('/games/:code/move', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        const { move } = req.body;
        const code = req.params.code.toUpperCase();
        const game = await Game.findOne({ where: { roomCode: code } });

        if (!game || game.status !== 'playing') {
            return res.status(400).json({ error: 'Partida não está ativa ou não existe.' });
        }

        const { Chess } = require('chess.js');
        const chess = new Chess();
        const standardFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
        
        if (game.pgn) {
            chess.loadPgn(game.pgn);
        } else if (game.fen && game.fen !== standardFen) {
            chess.load(game.fen);
        }
        const result = chess.move(move);

        if (!result) {
            return res.status(400).json({ error: 'Movimento inválido.' });
        }

        const now = new Date();
        const playerWhoMoved = game.turn;

        await game.update({
            fen: chess.fen(),
            pgn: chess.pgn(),
            turn: chess.turn(),
            status: chess.isGameOver() ? 'finished' : 'playing',
            winner: chess.isCheckmate() ? (playerWhoMoved === 'w' ? 'Brancas' : 'Pretas') : (chess.isDraw() ? 'Empate' : null),
            lastMoveTimestamp: now
        });

        // Registrar no histórico (Súmula)
        const MoveModel = require('../models/Move');
        const getBoardSnapshot = (c) => {
            try {
                const b = {};
                const r = '87654321', f = 'abcdefgh', raw = c.board();
                for(let i=0; i<8; i++) for(let j=0; j<8; j++) if(raw[i][j]) b[f[j]+r[i]] = raw[i][j].color + raw[i][j].type.toUpperCase();
                return b;
            } catch(e) { return {}; }
        };

        await MoveModel.create({
            gameId: game.id,
            fen: chess.fen(),
            move: result.san,
            player: playerWhoMoved,
            isCheck: chess.isCheck(),
            isCheckmate: chess.isCheckmate(),
            isDraw: chess.isDraw(),
            event: 'move',
            boardSnapshot: getBoardSnapshot(chess),
            metadata: { via_api: true, timers: { w: game.timerWhite, b: game.timerBlack } }
        });

        // NOTIFICAR INTERFACE VIA SOCKET
        const io = req.app.get('io');
        if (io) {
            io.to(code).emit('move_made', {
                fen: chess.fen(),
                move: result,
                timers: { w: game.timerWhite, b: game.timerBlack },
                turn: chess.turn(),
                status: game.status,
                winner: game.winner
            });
        }

        res.json({ success: true, fen: chess.fen(), turn: chess.turn() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao processar jogada via API.' });
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

// Endpoint para ZERAR (reseta tudo) o banco de dados
router.post('/db/reset', async (req, res) => {
    try {
        const apiKey = req.headers['authorization']?.split(' ')[1];
        if (apiKey !== process.env.ANTIGRAVITY_API_KEY) {
            return res.status(403).json({ error: 'Chave API inválida.' });
        }

        // force: true APAGA todas as tabelas e cria do zero
        await sequelize.sync({ force: true });
        res.json({ message: 'Banco de dados REINICIADO (todos os dados foram apagados).' });
    } catch (err) {
        console.error('Erro ao resetar banco:', err);
        res.status(500).json({ error: 'Erro ao resetar banco de dados.' });
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
