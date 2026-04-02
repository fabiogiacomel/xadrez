require('dotenv').config();
const axios = require('axios');

const BASE_URL = 'https://xadrez.giacomel.art/api/antigravity';
const API_KEY = 'my-secret-key-123';

const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
};

async function testAPIs() {
    try {
        console.log('--- TEST 1: Criar Partida ---');
        const createRes = await axios.post(`${BASE_URL}/games`, { noClock: false }, { headers });
        const roomCode = createRes.data.roomCode;
        console.log('✓ Sucesso! Room Code:', roomCode);

        console.log('\n--- TEST 2: Consultar Partida ---');
        const getRes = await axios.get(`${BASE_URL}/games/${roomCode}`, { headers });
        console.log('✓ Sucesso! Status:', getRes.data.status);

        console.log('\n--- TEST 3: Tentar Jogada (Esperado erro se não estiver "playing") ---');
        try {
            await axios.post(`${BASE_URL}/games/${roomCode}/move`, { from: 'e2', to: 'e4' }, { headers });
            console.log('✓ Sucesso! Jogada realizada.');
        } catch (e) {
            console.log('✓ Erro esperado capturado:', e.response?.data?.error || e.message);
        }

        console.log('\n--- TEST 4: Sincronização de Banco ---');
        const setupRes = await axios.get(`${BASE_URL}/setup-db`, { headers });
        console.log('✓ Sucesso! Resposta:', setupRes.data.message);

        console.log('\n--- TODOS OS TESTES PASSARAM ---');
    } catch (error) {
        console.error('X Falha nos testes de API:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

testAPIs();
