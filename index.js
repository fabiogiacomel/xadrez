require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game State Management
const rooms = new Map();
let timerInterval = null;

function startGlobalTimer() {
  if (timerInterval) return;
  timerInterval = setInterval(() => {
    rooms.forEach((room, code) => {
      if (room.status === 'playing' && !room.settings?.noClock && !room.settings?.paused) {
        const turn = room.chess.turn();
        room.timers[turn]--;
        if (room.timers[turn] <= 0) {
          room.status = 'finished';
          room.winner = turn === 'w' ? 'Black (Time)' : 'White (Time)';
          io.to(code).emit('game_over_time', { winner: room.winner });
        }
        // Broadcast every 5 seconds to sync, or every second for smooth UI
        io.to(code).emit('timer_update', { timers: room.timers });
      }
    });
  }, 1000);
}

startGlobalTimer();

function generateCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User requests a new room code
  socket.on('create_room', (settings = {}) => {
    let code = generateCode();
    while (rooms.has(code)) {
      code = generateCode();
    }

    const roomData = {
      id: code,
      players: [{ id: socket.id, color: 'w' }],
      chess: new Chess(),
      timers: { w: 600, b: 600 }, // 10 minutes in seconds
      lastMoveTime: null,
      status: 'waiting', // waiting, playing, finished
      winner: null,
      settings: {
        noClock: !!settings.noClock
      }
    };

    rooms.set(code, roomData);
    socket.join(code);
    socket.emit('room_created', { code, color: 'w', settings: roomData.settings });
    console.log(`Room ${code} created by ${socket.id} (noClock: ${roomData.settings.noClock})`);
  });

  socket.on('restore_game', (data) => {
    if (!data || !data.fen) return;
    
    let code = generateCode();
    while (rooms.has(code)) {
      code = generateCode();
    }

    const roomData = {
      id: code,
      players: [{ id: socket.id, color: 'w' }], // Restorer is always White for now
      chess: new Chess(data.fen),
      timers: data.timers || { w: 600, b: 600 },
      lastMoveTime: null,
      status: 'waiting',
      winner: null,
      settings: data.settings || { noClock: false }
    };

    rooms.set(code, roomData);
    socket.join(code);
    socket.emit('room_created', { 
      code, 
      color: 'w', 
      settings: roomData.settings, 
      restored: true,
      fen: data.fen,
      timers: roomData.timers
    });
    console.log(`Room ${code} restored from JSON by ${socket.id}`);
  });

  // User joins an existing room
  socket.on('join_room', (code) => {
    const room = rooms.get(code);

    if (!room) {
      return socket.emit('error_message', 'Sala não encontrada.');
    }

    if (room.players.length >= 2) {
      return socket.emit('error_message', 'Sala já está cheia.');
    }

    room.players.push({ id: socket.id, color: 'b' });
    room.status = 'playing';
    room.lastMoveTime = Date.now();
    
    socket.join(code);
    
    // Notify both players that the game started
    io.to(code).emit('game_start', {
      fen: room.chess.fen(),
      players: room.players,
      timers: room.timers,
      settings: room.settings
    });

    console.log(`User ${socket.id} joined room ${code}`);
  });

  // Handle movements
  socket.on('make_move', ({ code, move }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.color !== room.chess.turn()) {
      return socket.emit('error_message', 'Não é o seu turno.');
    }

    try {
      const result = room.chess.move(move);
      if (result) {
        // Update timers
        if (!room.settings?.noClock) {
          const now = Date.now();
          const elapsed = Math.floor((now - room.lastMoveTime) / 1000);
          const color = player.color;
          room.timers[color] = Math.max(0, room.timers[color] - elapsed);
          room.lastMoveTime = now;
        }

        // Check for game over
        let status = 'playing';
        let winner = null;

        if (room.chess.isCheckmate()) {
          status = 'finished';
          winner = color === 'w' ? 'White' : 'Black';
        } else if (room.chess.isDraw()) {
          status = 'finished';
          winner = 'Draw';
        }

        room.status = status;
        room.winner = winner;

        io.to(code).emit('move_made', {
          fen: room.chess.fen(),
          move: result,
          timers: room.timers,
          turn: room.chess.turn(),
          status,
          winner
        });
      }
    } catch (e) {
      socket.emit('error_message', 'Movimento inválido.');
    }
  });

  socket.on('resign_game', (code) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    room.status = 'finished';
    room.winner = player.color === 'w' ? 'Black (Resignation)' : 'White (Resignation)';

    io.to(code).emit('move_made', {
      fen: room.chess.fen(),
      move: null,
      timers: room.timers,
      turn: room.chess.turn(),
      status: 'finished',
      winner: room.winner
    });
  });

  socket.on('restart_game', (code) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'finished') return;

    // "Quem vence joga com as brancas"
    // If Black won, swap roles. If White won, keep.
    // If it was a draw, maybe keep roles or random.
    if (room.winner && room.winner.includes('Black')) {
       room.players.forEach(p => {
         p.color = p.color === 'w' ? 'b' : 'w';
       });
    }

    room.chess.reset();
    room.timers = { w: 600, b: 600 };
    room.status = 'playing';
    room.lastMoveTime = Date.now();
    room.winner = null;

    io.to(code).emit('game_restart', {
      fen: room.chess.fen(),
      players: room.players,
      timers: room.timers,
      settings: room.settings
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Cleanup simple room logic could be added here
  });

  socket.on('add_time', (code) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    
    room.timers.w += 300;
    room.timers.b += 300;
    
    io.to(code).emit('timer_update', { timers: room.timers });
    console.log(`Room ${code}: Added 5m to both clocks.`);
  });

  socket.on('toggle_pause', (code) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'playing') return;
    
    room.settings.paused = !room.settings.paused;
    
    io.to(code).emit('pause_updated', { paused: room.settings.paused });
    console.log(`Room ${code}: Timers ${room.settings.paused ? 'paused' : 'resumed'}.`);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
});
