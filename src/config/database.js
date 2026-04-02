const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST || 'localhost',
    dialect: 'mysql',
    dialectOptions: {
      socketPath: '/tmp/mysql.sock' // Caminho padrão Hostinger
    },
    logging: false, // Desligue no modo produção para não poluir o console
    timezone: '-03:00'
  }
);

module.exports = sequelize;
