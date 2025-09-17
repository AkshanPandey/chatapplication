require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// ---------- App setup ----------
const allowedOrigins = [
  // "http://localhost:3000",        // React local dev
  "https://akshan-11092002-8254.netlify.app", // Netlify deploy
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true
}));
const app = express();

app.use(express.json());

const PORT = process.env.PORT || 4000;

// ---------- MongoDB Connection ----------
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB connection failed:', err.message);
  process.exit(1);
});

// ---------- Schemas ----------
const userSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, unique: true },
  role: { type: String, default: 'user' },
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  participants: [{ type: String }],
  messages: [{ type: Object }]
});

const User = mongoose.model('User', userSchema);
const Room = mongoose.model('Room', roomSchema);

// ---------- Helper ----------
function roomIdFor(adminId, userId){
  return [adminId, userId].sort().join('--');
}

// ---------- REST APIs ----------

// Register user
app.post('/api/register', async (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ ok:false, error:'missing id/name' });

  try {
    // Check if user exists
    let user = await User.findOne({ name: new RegExp(`^${name}$`, 'i') });
    if (user) return res.json({ ok:true, user });

    // If first user → admin
    const count = await User.countDocuments();
    if (count === 0) {
      user = await User.create({ id, name, role:'admin', status:'approved' });
    } else {
      user = await User.create({ id, name, role:'user', status:'pending' });
    }

    return res.json({ ok:true, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error:'server error' });
  }
});

// Transfer admin rights
app.post('/api/transfer-admin', async (req, res) => {
  const { currentAdminId, newAdminId } = req.body;
  if (!currentAdminId || !newAdminId) {
    return res.status(400).json({ ok: false, error: 'Missing required parameters' });
  }

  try {
    const currentAdmin = await User.findOne({ id: currentAdminId });
    const newAdmin = await User.findOne({ id: newAdminId });

    if (!currentAdmin || currentAdmin.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Current user is not admin' });
    }
    if (!newAdmin) {
      return res.status(404).json({ ok: false, error: 'New admin user not found' });
    }

    currentAdmin.role = 'user';
    await currentAdmin.save();

    newAdmin.role = 'admin';
    newAdmin.status = 'approved';
    await newAdmin.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok:false, error:'server error' });
  }
});

// Get all users
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find();
    return res.json({ ok:true, users });
  } catch (err) {
    res.status(500).json({ ok:false, error:'server error' });
  }
});

// Approve user
app.post('/api/users/approve', async (req, res) => {
  const { id } = req.body;
  await User.updateOne({ id }, { status: 'approved' });
  return res.json({ ok:true });
});

// Reject (delete) user
app.post('/api/users/reject', async (req, res) => {
  const { id } = req.body;
  await User.deleteOne({ id });
  return res.json({ ok:true });
});

// Partner API
app.get('/api/partner', async (req, res) => {
  const { userId } = req.query;
  const admin = await User.findOne({ role: 'admin' });
  const me = await User.findOne({ id: userId });
  const approved = await User.find({ status: 'approved', id: { $ne: admin?.id } });

  if (me?.role === 'admin') {
    const partner = approved[0] || null;
    const roomId = partner ? roomIdFor(admin.id, partner.id) : null;
    return res.json({ ok:true, partner, roomId });
  }

  const partner = admin || null;
  const roomId = partner ? roomIdFor(admin.id, userId) : null;
  return res.json({ ok:true, partner, roomId });
});

// ---------- Socket.IO ----------
const server = http.createServer(app);
// const io = new Server(server, { cors: { origin: '*' } });
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true
  }
});

io.on('connection', (socket) => {
  console.log('⚡ New client connected');

  socket.on('join', async ({ roomId, user }) => {
    socket.join(roomId);
    socket.data.user = user;

    let room = await Room.findOne({ roomId });
    if (!room) {
      room = await Room.create({ roomId, participants: [user.id], messages: [] });
    } else if (!room.participants.includes(user.id)) {
      room.participants.push(user.id);
      await room.save();
    }

    socket.emit('room:history', { roomId, history: room.messages });
  });

  socket.on('message', async ({ roomId, msg }) => {
    let room = await Room.findOne({ roomId });
    if (!room) {
      room = await Room.create({ roomId, participants: [], messages: [] });
    }
    room.messages.push(msg);
    await room.save();

    io.to(roomId).emit('message', { roomId, msg });
  });

  socket.on('typing', ({ roomId, userId, value }) => {
    socket.to(roomId).emit('typing', { userId, value });
  });

  socket.on('reaction', ({ roomId, msgId, by, reaction }) => {
    io.to(roomId).emit('reaction', { msgId, by, reaction });
  });

  socket.on('clear', async ({ roomId }) => {
    await Room.updateOne({ roomId }, { $set: { messages: [] } });
    io.to(roomId).emit('room:cleared');
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected');
  });
});

// ---------- Start Server ----------
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
