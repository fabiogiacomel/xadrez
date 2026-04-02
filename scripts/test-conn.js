require('dotenv').config();
const mysql = require('mysql2/promise');

async function testConn() {
    try {
        console.log(`Tentando conectar ao host: ${process.env.DB_HOST}`);
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            database: process.env.DB_NAME
        });
        console.log('Conexão direta bem-sucedida!');
        await connection.end();
    } catch (err) {
        console.error('Erro de conexão direta:');
        console.error(err);
    }
}

testConn();
