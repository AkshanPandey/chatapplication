require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// In-memory fallback stores (for quick demo)
const InMemory = {
  users: [], // { id, name, role, status }
  rooms: {}, // roomId -> { participants: [ids], messages: [] }
};

// Try connect to MongoDB if provided
let DB = null;
if(process.env.MONGODB_URI){
  mongoose.connect(process.env.MONGODB_URI).then(()=>{ 
    console.log('MongoDB connected');
    DB = mongoose;
  }).catch(err=>{
    console.warn('MongoDB connect failed, using in-memory DB', err.message);
  });
} else {
  console.log('No MONGODB_URI provided — using in-memory stores (demo mode)');
}

// Helper - find or create room between admin and user
function roomIdFor(adminId, userId){
  return [adminId, userId].sort().join('--');
}

// REST endpoints
app.post('/api/register', (req, res)=>{
  const { id, name } = req.body;
  if(!id || !name) return res.status(400).json({ ok:false, error:'missing id/name' });
  
  // Check for existing user first
  const existingUser = InMemory.users.find(u => u.name.toLowerCase() === name.toLowerCase());
  if (existingUser) {
    return res.json({ ok:true, user: existingUser });
  }

  // If no users exist, create admin
  if(!InMemory.users.length){
    const admin = { id, name, role:'admin', status:'approved', createdAt: Date.now() };
    InMemory.users.push(admin);
    return res.json({ ok:true, user: admin });
  }

  // Create new user
  const user = { id, name, role:'user', status:'pending', createdAt: Date.now() };
  InMemory.users.push(user);
  return res.json({ ok:true, user });
});

// Add admin transfer endpoint
app.post('/api/transfer-admin', (req, res) => {
  const { currentAdminId, newAdminId } = req.body;
  
  // Validate request
  if (!currentAdminId || !newAdminId) {
    return res.status(400).json({ ok: false, error: 'Missing required parameters' });
  }

  // Find current admin and new admin users
  const currentAdmin = InMemory.users.find(u => u.id === currentAdminId);
  const newAdmin = InMemory.users.find(u => u.id === newAdminId);

  // Validate users and roles
  if (!currentAdmin || currentAdmin.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Current user is not admin' });
  }
  if (!newAdmin) {
    return res.status(404).json({ ok: false, error: 'New admin user not found' });
  }

  // Transfer admin rights
  currentAdmin.role = 'user';
  newAdmin.role = 'admin';
  newAdmin.status = 'approved';

  return res.json({ ok: true });
});

app.get('/api/users', (req, res)=>{
  return res.json({ ok:true, users: InMemory.users });
});

app.post('/api/users/approve', (req, res)=>{
  const { id } = req.body;
  const u = InMemory.users.find(x=>x.id===id);
  if(u) u.status = 'approved';
  return res.json({ ok:true });
});
app.post('/api/users/reject', (req, res)=>{
  const { id } = req.body;
  const idx = InMemory.users.findIndex(x=>x.id===id);
  if(idx!==-1) InMemory.users.splice(idx,1);
  return res.json({ ok:true });
});

app.get('/api/partner', (req, res)=>{
  const userId = req.query.userId;
  const admin = InMemory.users.find(u=>u.role==='admin');
  const me = InMemory.users.find(u=>u.id===userId);
  const approved = InMemory.users.filter(u=>u.status==='approved' && u.id !== admin?.id);
  if(me?.role === 'admin'){
    const partner = approved[0] || null;
    const roomId = partner ? roomIdFor(admin.id, partner.id) : null;
    return res.json({ ok:true, partner, roomId });
  }
  const partner = admin || null;
  const roomId = partner ? roomIdFor(admin.id, userId) : null;
  return res.json({ ok:true, partner, roomId });
});

// Presign upload (placeholder using S3 if configured)
app.post('/api/upload/presign', async (req, res)=>{
  // For demo: return a mocked URL; if AWS keys provided, you can implement S3 presign here.
  const { name } = req.body;
  if(!name) return res.status(400).json({ ok:false, error:'missing name' });
  if(process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET){
    // Implementing minimal presign using aws-sdk v2
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({ region: process.env.AWS_REGION });
    const key = `uploads/${Date.now()}-${name}`;
    const params = { Bucket: process.env.S3_BUCKET, Key: key, Expires: 60*5, ContentType: req.body.type || 'application/octet-stream' };
    const url = s3.getSignedUrl('putObject', params);
    const publicUrl = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    return res.json({ ok:true, uploadUrl: url, publicUrl, key });
  } else {
    const publicUrl = `https://example.com/uploads/${encodeURIComponent(name)}`;
    return res.json({ ok:true, uploadUrl: publicUrl, publicUrl, key: null });
  }
});

// Clear room messages endpoint
app.post('/api/clear-chats', async (req, res)=>{
  const { userId, deleteAll } = req.body;
  if(!userId) return res.status(400).json({ ok:false, error:'missing userId' });
  
  // Clear all rooms where user is a participant
  Object.keys(InMemory.rooms).forEach(roomId => {
    const room = InMemory.rooms[roomId];
    if(room.participants.includes(userId)){
      if (deleteAll) {
        // Delete the entire room
        delete InMemory.rooms[roomId];
      } else {
        // Just clear the messages
        room.messages = [];
      }
      // Notify all participants about the cleared chat
      io.to(roomId).emit('chat:cleared', { roomId });
    }
  });
  return res.json({ ok:true });
});

// Start server and socket.io
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

io.on('connection', (socket)=>{
  // join room
  socket.on('join', ({ roomId, user })=>{
    socket.join(roomId);
    socket.data.user = user;
    // send room history if any
    const r = InMemory.rooms[roomId] || { participants: [], messages: [] };
    InMemory.rooms[roomId] = r;
    if(!r.participants.includes(user.id)) r.participants.push(user.id);
    // Send room history with roomId
    socket.emit('room:history', { roomId, history: r.messages || [] });
  });

  socket.on('message', (payload)=>{
    // payload: { roomId, msg }
    const { roomId, msg } = payload;
    InMemory.rooms[roomId] = InMemory.rooms[roomId] || { participants: [], messages: [] };
    InMemory.rooms[roomId].messages.push(msg);
    // Broadcast message with roomId
    io.to(roomId).emit('message', { roomId, msg });
  });

  socket.on('typing', ({ roomId, userId, value })=>{
    socket.to(roomId).emit('typing', { userId, value });
  });

  socket.on('reaction', ({ roomId, msgId, by, reaction })=>{
    // naive: broadcast
    io.to(roomId).emit('reaction', { msgId, by, reaction });
  });

  socket.on('clear', ({ roomId })=>{
    if(InMemory.rooms[roomId]) InMemory.rooms[roomId].messages = [];
    io.to(roomId).emit('room:cleared');
  });

  socket.on('disconnect', ()=>{});
});

server.listen(PORT, ()=> console.log('Server listening on', PORT));
