const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Game = sequelize.define('Game', {
    roomCode: {
        type: DataTypes.STRING(6),
        allowNull: false,
        unique: true,
        index: true
    },
    status: {
        type: DataTypes.ENUM('waiting', 'playing', 'finished', 'abandoned'),
        defaultValue: 'waiting'
    },
    fen: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: 'start'
    },
    pgn: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    turn: {
        type: DataTypes.ENUM('w', 'b'),
        defaultValue: 'w'
    },
    whiteSessionId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    blackSessionId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    timerWhite: {
        type: DataTypes.INTEGER,
        defaultValue: 600
    },
    timerBlack: {
        type: DataTypes.INTEGER,
        defaultValue: 600
    },
    lastMoveTimestamp: {
        type: DataTypes.DATE,
        allowNull: true
    },
    noClock: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    paused: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    winner: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true // Cria automaticamente createdAt e updatedAt
});

module.exports = Game;
