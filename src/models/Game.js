const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Game = sequelize.define('Game', {
    roomCode: {
        type: DataTypes.STRING(10),
        allowNull: false,
        unique: true
    },
    status: {
        type: DataTypes.ENUM('waiting', 'playing', 'finished', 'abandoned'),
        defaultValue: 'waiting'
    },
    fen: {
        type: DataTypes.STRING(255),
        defaultValue: 'start'
    },
    pgn: {
        type: DataTypes.TEXT,
        defaultValue: ''
    },
    turn: {
        type: DataTypes.ENUM('w', 'b'),
        defaultValue: 'w'
    },
    timerWhite: {
        type: DataTypes.INTEGER,
        defaultValue: 600 // 10 minutes in seconds
    },
    timerBlack: {
        type: DataTypes.INTEGER,
        defaultValue: 600
    },
    whiteSessionId: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    blackSessionId: {
        type: DataTypes.STRING(255),
        allowNull: true
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
        type: DataTypes.STRING(50),
        allowNull: true
    }
});

module.exports = Game;
