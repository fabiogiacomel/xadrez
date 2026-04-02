const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
    process.env.DB_NAME, 
    process.env.DB_USER, 
    process.env.DB_PASS, 
    {
        host: process.env.DB_HOST || '127.0.0.1',
        port: process.env.DB_PORT || 3306,
        dialect: 'mysql',
        dialectOptions: {
            // Se precisar de socket, use uma variável específica
            socketPath: process.env.DB_SOCKET || undefined
        },
        logging: false
    }
);

module.exports = sequelize;
