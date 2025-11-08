// server.js
const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// In-memory store for rooms (for demo). Each room: { id, name, public, createdAt, users: Set }
const rooms = new Map();

// Create a room endpoint
app.post('/api/rooms', (req, res) => {
  const { name = 'Untitled Room', isPublic = true } = req.body;
  const id = uuidv4();
  const room = {
    id,
    name,
    public: !!isPublic,
    createdAt: Date.now(),
    usersCount: 0
  };
  rooms.set(id, room);
  res.json(room);
});

// Get list of public rooms
app.get('/api/rooms/public', (req, res) => {
  const publicRooms = Array.from(rooms.values())
    .filter(r => r.public)
    // sort newest first
    .sort((a,b) => b.createdAt - a.createdAt)
    .map(r => ({ id: r.id, name: r.name, usersCount: r.usersCount }));
  res.json(publicRooms);
});

// Join random public room
app.get('/api/rooms/random', (req, res) => {
  const publicRooms = Array.from(rooms.values()).filter(r => r.public);
  if (publicRooms.length === 0) return res.status(404).json({ error: 'No public rooms available' });
  const random = publicRooms[Math.floor(Math.random() * publicRooms.length)];
  res.json(random);
});

// Socket.io real-time handling
io.on('connection', socket => {
  // join room
  socket.on('join-room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    // create room if doesn't exist (defensive)
    if (!rooms.has(roomId)) {
      rooms.set(roomId, { id: roomId, name: 'Untitled Room', public: false, createdAt: Date.now(), usersCount: 0 });
    }
    socket.join(roomId);
    socket.data.username = username;
    socket.data.roomId = roomId;

    // update usersCount (simple count of sockets in room)
    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    const usersCount = clients.size;
    const room = rooms.get(roomId);
    room.usersCount = usersCount;
    rooms.set(roomId, room);

    // notify everyone in room
    io.to(roomId).emit('system-message', { text: `${username} joined the room.`, usersCount });
    io.to(roomId).emit('room-meta', room);
  });

  // handle posting messages
  socket.on('chat-message', ({ text }) => {
    const username = socket.data.username || 'Unknown';
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const msg = {
      id: uuidv4(),
      username,
      text,
      ts: Date.now()
    };
    io.to(roomId).emit('chat-message', msg);
  });

  // handle disconnect
  socket.on('disconnect', () => {
    const username = socket.data.username;
    const roomId = socket.data.roomId;
    if (!roomId) return;
    // update count
    const clients = io.sockets.adapter.rooms.get(roomId) || new Set();
    const usersCount = clients.size;
    const room = rooms.get(roomId);
    if (room) {
      room.usersCount = usersCount;
      rooms.set(roomId, room);
      io.to(roomId).emit('system-message', { text: `${username || 'A user'} left the room.`, usersCount });
      io.to(roomId).emit('room-meta', room);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
