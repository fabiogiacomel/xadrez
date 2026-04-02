require('dotenv').config();
const sequelize = require('../src/config/database');
const Game = require('../src/models/Game');

async function syncDB() {
    try {
        console.log('Tentando conectar ao MySQL na Hostinger...');
        await sequelize.authenticate();
        console.log('Conexão estabelecida com sucesso!');

        console.log('Sincronizando tabelas...');
        await sequelize.sync({ alter: true }); // 'alter: true' atualiza colunas existentes sem apagar dados
        console.log('Tabelas criadas/atualizadas com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('Erro ao sincronizar o banco de dados:', error);
        process.exit(1);
    }
}

syncDB();
