const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Move = sequelize.define('Move', {
    gameId: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    fen: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    move: {
        type: DataTypes.STRING(10), // e.g., 'e4', 'Nf3'
        allowNull: true // Might be null for initial state or special events
    },
    player: {
        type: DataTypes.ENUM('w', 'b'),
        allowNull: false
    },
    isCheck: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isCheckmate: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    isDraw: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    event: {
        type: DataTypes.STRING(50), // 'move', 'resign', 'timeout', etc.
        defaultValue: 'move'
    },
    boardSnapshot: {
        type: DataTypes.JSON, // Armazena o tabuleiro como objeto {'a1': 'wR', ...}
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSON, // Armazena timers, capturas, etc.
        allowNull: true
    }
});

module.exports = Move;
