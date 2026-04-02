const { Chess } = require('chess.js');

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

module.exports = {
    generateCode,
    getBoardSnapshot
};
