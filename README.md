# Xadrez Premium - Giacomel Art

Um sistema de xadrez em tempo real, desenvolvido para ser executado em ambientes como Hostinger, com suporte a partidas locais e online, sincronização via Socket.io e persistência em banco de dados.

## 🚀 Tecnologias

- **Backend**: Node.js, Express, Sequelize (MySQL)
- **Real-time**: Socket.io
- **Frontend**: HTML5, Vanilla CSS, JS (Chess.js, Chessboard.js)
- **Gerenciamento**: Git, NPM

## 🛠️ Configuração

1. Clone o repositório:
   ```bash
   git clone https://github.com/fabiogiacomel/xadrez.git
   ```
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Configure as variáveis de ambiente:
   - Copie `.env.example` para `.env`
   - Preencha os dados de conexão com o banco de dados MySQL.

4. Inicie o servidor:
   ```bash
   npm start
   ```

## 📦 Estrutura do Projeto

- `public/`: Arquivos estáticos (HTML, CSS, JS do cliente)
- `src/`: Lógica do servidor
  - `config/`: Configurações de banco de dados
  - `models/`: Definições das tabelas do banco
  - `sockets/`: Handlers para eventos Socket.io
  - `routes/`: Endpoints da API

## 📝 Licença

Este projeto está sob a licença ISC.
