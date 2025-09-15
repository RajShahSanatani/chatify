// server.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/mern_ejs_chat';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this';

// --- MongoDB connect
mongoose.set('strictQuery', false);
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error', err); process.exit(1); });

// --- Models
const { Schema } = mongoose;

const UserSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  name: { type: String, default: '' },
  email: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  bio: { type: String, default: '' },
  avatarIndex: { type: Number, default: null },
  friends: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  friendRequests: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  // presence
  online: { type: Boolean, default: false },
  lastSeen: { type: Date, default: null }
}, { timestamps: true });

const MessageSchema = new Schema({
  sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true }, // text or base64 audio data URL
  type: { type: String, enum: ['text','voice'], default: 'text' },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
MessageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// --- Session middleware
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});

// --- Express setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '5mb' })); // allow larger payloads for audio base64
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

// --- helpers
function ensureAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/auth/login');
}
async function currentUser(req) {
  if (!req.session || !req.session.userId) return null;
  return await User.findById(req.session.userId).lean();
}

// --- Routes: auth + redirect to profile-setup if incomplete
app.get('/', ensureAuth, async (req, res) => {
  const me = await User.findById(req.session.userId).lean();
  if (!me) return res.redirect('/auth/login');
  if (!(me.avatarIndex === 0 || me.avatarIndex) || !me.name) {
    return res.redirect('/profile-setup');
  }
  res.render('index', { user: me });
});

app.get('/auth/login', (req, res) => res.render('auth', { mode: 'login', error: null }));
app.get('/auth/signup', (req, res) => res.render('auth', { mode: 'signup', error: null }));

app.post('/auth/signup', async (req, res) => {
  try {
    const { username, name, password, email } = req.body;
    if (!username || !password) return res.render('auth', { mode: 'signup', error: 'Username & password required' });
    const exists = await User.findOne({ username });
    if (exists) return res.render('auth', { mode: 'signup', error: 'Username already taken' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username: username.trim(), name: name || '', email, password: hashed });
    req.session.userId = user._id;
    return res.redirect('/profile-setup');
  } catch (err) {
    console.error(err);
    res.render('auth', { mode: 'signup', error: 'Error creating account' });
  }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.render('auth', { mode: 'login', error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.render('auth', { mode: 'login', error: 'Invalid credentials' });
    req.session.userId = user._id;
    if (!(user.avatarIndex === 0 || user.avatarIndex) || !user.name) {
      return res.redirect('/profile-setup');
    }
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.render('auth', { mode: 'login', error: 'Something went wrong' });
  }
});

app.get('/auth/logout', (req, res) => {
  (async () => {
    try {
      if (req.session && req.session.userId) {
        await User.findByIdAndUpdate(req.session.userId, { online: false, lastSeen: new Date() });
        const user = await User.findById(req.session.userId).select('friends').lean();
        const ioA = app.get('io');
        if (ioA && user && user.friends && user.friends.length) {
          user.friends.forEach(fid => ioA.to(String(fid)).emit('user-offline', { userId: String(req.session.userId), lastSeen: new Date() }));
        }
      }
    } catch(e){ console.error(e); }
  })();
  req.session.destroy(()=>res.redirect('/auth/login'));
});

// --- profile setup
app.get('/profile-setup', ensureAuth, async (req, res) => {
  const me = await User.findById(req.session.userId).lean();
  res.render('profile-setup', { user: me, avatars: Array.from({length:10}, (_,i)=>i) });
});

app.post('/profile-setup', ensureAuth, async (req, res) => {
  const { name, bio, avatarIndex } = req.body;
  await User.findByIdAndUpdate(req.session.userId, { name, bio, avatarIndex: avatarIndex !== undefined ? Number(avatarIndex) : null });
  res.redirect('/');
});

// quick API for client to fetch me (populated friendRequests & friends)
app.get('/api/me', ensureAuth, async (req, res) => {
  const me = await User.findById(req.session.userId)
    .populate({ path: 'friendRequests', select: 'username name avatarIndex online lastSeen' })
    .populate({ path: 'friends', select: 'username name avatarIndex online lastSeen' })
    .lean();
  res.json({ user: me });
});

// search
app.get('/search', ensureAuth, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ users: [] });
  const re = new RegExp(q, 'i');
  const users = await User.find({
    _id: { $ne: req.session.userId },
    $or: [{ username: re }, { name: re }]
  }).limit(12).select('username name avatarIndex online lastSeen').lean();
  res.json({ users });
});

// friends + last message + unread flag + online/lastSeen
app.get('/friends', ensureAuth, async (req, res) => {
  const me = await User.findById(req.session.userId).populate('friends', 'username name avatarIndex online lastSeen').lean();
  const friends = me.friends || [];
  const friendsWithLast = await Promise.all(friends.map(async (f) => {
    const last = await Message.findOne({
      $or: [
        { sender: req.session.userId, receiver: f._id },
        { sender: f._id, receiver: req.session.userId }
      ]
    }).sort({ createdAt: -1 }).lean();
    const unread = await Message.exists({ sender: f._id, receiver: req.session.userId, read: false });
    return { user: f, lastMessage: last || null, hasUnread: !!unread };
  }));
  res.json({ friends: friendsWithLast });
});

// get messages and mark them read (so unread indicator clears)
// Also emit messages-read event to the friend (so sender sees read/seen)
app.get('/messages/:friendId', ensureAuth, async (req, res) => {
  const friendId = req.params.friendId;
  const me = await User.findById(req.session.userId).select('friends').lean();
  if (!me.friends.find(f => String(f) === String(friendId))) return res.status(403).json({ error: 'Not friends' });
  // mark incoming messages from friend as read
  await Message.updateMany({ sender: friendId, receiver: req.session.userId, read: false }, { $set: { read: true } });
  // notify friend (sender) that their messages were read
  const io = app.get('io');
  if (io) {
    io.to(String(friendId)).emit('messages-read', { by: String(req.session.userId), to: String(friendId) });
  }
  const msgs = await Message.find({
    $or: [
      { sender: req.session.userId, receiver: friendId },
      { sender: friendId, receiver: req.session.userId }
    ]
  }).sort({ createdAt: 1 }).lean();
  res.json({ messages: msgs });
});

// friend request send
app.post('/friend/request/:id', ensureAuth, async (req, res) => {
  try {
    const targetId = req.params.id;
    if (targetId === String(req.session.userId)) return res.status(400).json({ error: 'Cannot add self' });
    const target = await User.findById(targetId);
    const me = await User.findById(req.session.userId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (me.friends.find(f => String(f) === targetId)) return res.json({ ok: true, message: 'Already friends' });
    if (target.friendRequests.find(r => String(r) === String(me._id))) return res.json({ ok: true, message: 'Request already sent' });
    target.friendRequests.push(me._id);
    await target.save();
    const io = app.get('io');
    if (io) io.to(targetId.toString()).emit('friend-request', { from: { _id: me._id, username: me.username, name: me.name, avatarIndex: me.avatarIndex } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// accept friend
app.post('/friend/accept/:id', ensureAuth, async (req, res) => {
  try {
    const fromId = req.params.id;
    const me = await User.findById(req.session.userId);
    const other = await User.findById(fromId);
    if (!me || !other) return res.status(404).json({ error: 'User not found' });
    const idx = me.friendRequests.findIndex(r => String(r) === fromId);
    if (idx === -1) return res.status(400).json({ error: 'No such request' });
    me.friendRequests.splice(idx, 1);
    if (!me.friends.find(f => String(f) === fromId)) me.friends.push(other._id);
    if (!other.friends.find(f => String(f) === String(me._id))) other.friends.push(me._id);
    await me.save();
    await other.save();
    const io = app.get('io');
    if (io) io.to(fromId.toString()).emit('friend-accepted', { user: { _id: me._id, username: me.username, name: me.name, avatarIndex: me.avatarIndex } });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// decline friend
app.post('/friend/decline/:id', ensureAuth, async (req, res) => {
  try {
    const fromId = req.params.id;
    const me = await User.findById(req.session.userId);
    if (!me) return res.status(404).json({ error: 'User not found' });
    const idx = me.friendRequests.findIndex(r => String(r) === fromId);
    if (idx === -1) return res.status(400).json({ error: 'No such request' });
    me.friendRequests.splice(idx, 1);
    await me.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// remove friend
app.post('/friend/remove/:id', ensureAuth, async (req, res) => {
  try {
    const fid = req.params.id;
    const me = await User.findById(req.session.userId);
    const other = await User.findById(fid);
    if (!me || !other) return res.status(404).json({ error: 'User not found' });
    me.friends = me.friends.filter(f => String(f) !== String(fid));
    other.friends = other.friends.filter(f => String(f) !== String(req.session.userId));
    await me.save();
    await other.save();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// update profile (non-first-time)
app.post('/profile', ensureAuth, async (req, res) => {
  const { name, bio, avatarIndex } = req.body;
  await User.findByIdAndUpdate(req.session.userId, { name, bio, avatarIndex: avatarIndex !== undefined ? Number(avatarIndex) : null });
  res.redirect('/');
});

// --- HTTP + Socket.IO setup
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { maxHttpBufferSize: 1e7 }); // allow larger messages
app.set('io', io);

// share session with socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', async (socket) => {
  try {
    const req = socket.request;
    if (!req.session || !req.session.userId) { socket.disconnect(true); return; }
    const userId = String(req.session.userId);
    socket.join(userId);

    // set user online and notify their friends
    await User.findByIdAndUpdate(userId, { online: true });
    const me = await User.findById(userId).select('friends').lean();
    if (me && me.friends) {
      me.friends.forEach(fid => {
        io.to(String(fid)).emit('user-online', { userId });
      });
    }

    // typing events
    socket.on('typing', ({ to }) => {
      if (!to) return;
      io.to(String(to)).emit('typing', { from: userId });
    });
    socket.on('stop-typing', ({ to }) => {
      if (!to) return;
      io.to(String(to)).emit('stop-typing', { from: userId });
    });

    // private text message
    socket.on('private message', async ({ to, content }) => {
      if (!to || !content) return;
      const sender = await User.findById(userId).select('friends').lean();
      if (!sender) return;
      const isFriend = sender.friends.find(f => String(f) === String(to));
      if (!isFriend) {
        socket.emit('error-message', 'You can only message friends.');
        return;
      }
      const msg = await Message.create({ sender: userId, receiver: to, content, type: 'text', read: false });
      const out = { _id: msg._id, sender: msg.sender, receiver: msg.receiver, content: msg.content, type: msg.type, createdAt: msg.createdAt };
      io.to(String(to)).emit('new message', out);
      io.to(userId).emit('new message', out);
    });

    // private voice message (content expected as data URL base64)
    socket.on('voice message', async ({ to, content }) => {
      try {
        if (!to || !content) return;
        const sender = await User.findById(userId).select('friends').lean();
        if (!sender) return;
        const isFriend = sender.friends.find(f => String(f) === String(to));
        if (!isFriend) {
          socket.emit('error-message', 'You can only message friends.');
          return;
        }
        // Content should be a data URL (e.g. "data:audio/webm;....")
        const msg = await Message.create({ sender: userId, receiver: to, content, type: 'voice', read: false });
        const out = { _id: msg._id, sender: msg.sender, receiver: msg.receiver, content: msg.content, type: msg.type, createdAt: msg.createdAt };
        io.to(String(to)).emit('new message', out);
        io.to(userId).emit('new message', out);
      } catch (e) {
        console.error('voice message error', e);
      }
    });

    // messages-read event from client (optional) - client may also trigger via GET /messages
    socket.on('messages-read', async ({ by, withUser }) => {
      if (!withUser || !by) return;
      io.to(String(withUser)).emit('messages-read', { by });
    });

    socket.on('disconnect', async () => {
      try {
        // set offline and lastSeen
        await User.findByIdAndUpdate(userId, { online: false, lastSeen: new Date() });
        // notify their friends
        const me2 = await User.findById(userId).select('friends').lean();
        if (me2 && me2.friends) {
          me2.friends.forEach(fid => {
            io.to(String(fid)).emit('user-offline', { userId, lastSeen: new Date() });
          });
        }
      } catch(e) {
        console.error('disconnect error', e);
      }
    });

  } catch (err) {
    console.error('socket error', err);
  }
});

// start server
server.listen(PORT, ()=>console.log(`Server running on http://localhost:${PORT}`));

