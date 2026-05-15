import express from 'express';
import { createServer } from 'http';
import { Readable } from 'stream';
import { Server as SocketIO } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import Role from './models/Role.js';
import Currency from './models/Currency.js';
import ReplaceRequest from './models/ReplaceRequest.js';
import GoogleAdsProduct from './models/GoogleAdsProduct.js';
import YoutubeProduct from './models/YoutubeProduct.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logError } from './controllers/healthController.js';
import { deleteAnyFile } from './utils/deleteFile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.resolve(__dirname, 'uploads');

dotenv.config();

const _origError = console.error.bind(console);
console.error = (...args) => {
  _origError(...args);
  const msg = args.map(a => (a instanceof Error ? a.message : String(a))).join(' ');
  const stack = args.find(a => a instanceof Error)?.stack || null;
  logError(msg, stack);
};

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
const httpServer = createServer(app);
const PORT = process.env.PORT || 8000;

const corsOptions = {
  origin: process.env.WHITE_LIST?.split(',') || [],
  credentials: true
};

export const io = new SocketIO(httpServer, {
  cors: corsOptions
});

export const onlineCustomers = new Set();

io.of('/customer').on('connection', async (socket) => {
  const customerId = socket.handshake.auth?.customerId;
  if (customerId) {
    socket.join(`customer:${customerId}`);
    onlineCustomers.add(String(customerId));
    try {
      const { default: CustomerUser } = await import('./models/CustomerUser.js');
      await CustomerUser.findByIdAndUpdate(customerId, { lastSeen: new Date() });
    } catch {}
  }
  socket.on('disconnect', () => {
    if (customerId) {
      const room = io.of('/customer').adapter.rooms?.get(`customer:${customerId}`);
      if (!room || room.size === 0) {
        onlineCustomers.delete(String(customerId));
      }
      try {
        import('./models/CustomerUser.js').then(({ default: CustomerUser }) => {
          CustomerUser.findByIdAndUpdate(customerId, { lastSeen: new Date() }).catch(() => {});
        });
      } catch {}
    }
  });
});

/* ===== Support namespace (real-time tickets) ===== */
import jwt from 'jsonwebtoken';
import cookie from 'cookie';

const supportNs = io.of('/support');

const parseCookies = (raw) => {
  try { return raw ? cookie.parse(raw) : {}; } catch { return {}; }
};

supportNs.use(async (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers?.cookie);
    const customerToken = cookies.customer_token;
    const adminToken = cookies.token;

    if (customerToken) {
      try {
        const decoded = jwt.verify(customerToken, process.env.JWT_SECRET);
        if (decoded.type === 'customer') {
          const { default: CustomerSession } = await import('./models/CustomerSession.js');
          const session = await CustomerSession.findOne({ token: customerToken, userId: decoded.id });
          if (session && session.expire >= new Date()) {
            socket.data = { role: 'customer', userId: String(decoded.id) };
            return next();
          }
        }
      } catch {}
    }

    if (adminToken) {
      try {
        const decoded = jwt.verify(adminToken, process.env.JWT_SECRET);
        if (decoded.type === 'admin') {
          const { default: Session } = await import('./models/Session.js');
          const session = await Session.findOne({ token: adminToken, userId: decoded.id });
          if (session && session.expire >= new Date()) {
            const { default: User } = await import('./models/User.js');
            const user = await User.findById(decoded.id).populate('role_id');
            if (user && user.status && user.role_id?.access !== 'nothing' && user.role_id?.name !== 'new') {
              socket.data = { role: 'staff', userId: String(decoded.id), access: user.role_id?.access };
              return next();
            }
          }
        }
      } catch {}
    }

    return next(new Error('unauthorized'));
  } catch (e) {
    return next(new Error('unauthorized'));
  }
});

supportNs.on('connection', async (socket) => {
  const { role, userId } = socket.data || {};
  if (role === 'staff') {
    socket.join('support:staff');
  } else if (role === 'customer') {
    socket.join(`customer:${userId}`);
  }

  const checkTicketAccess = async (ticketId) => {
    if (!ticketId || !/^[a-f0-9]{24}$/i.test(String(ticketId))) return false;
    if (role === 'staff') return true;
    try {
      const { default: SupportTicket } = await import('./models/SupportTicket.js');
      const t = await SupportTicket.findById(ticketId).select('customerId').lean();
      return t && String(t.customerId) === String(userId);
    } catch { return false; }
  };

  socket.on('ticket:join', async ({ ticketId } = {}) => {
    if (!(await checkTicketAccess(ticketId))) return;
    socket.join(`ticket:${ticketId}`);
    socket.to(`ticket:${ticketId}`).emit('presence', { ticketId, role, online: true });
  });

  socket.on('ticket:leave', ({ ticketId } = {}) => {
    if (!ticketId) return;
    socket.leave(`ticket:${ticketId}`);
    socket.to(`ticket:${ticketId}`).emit('presence', { ticketId, role, online: false });
  });

  socket.on('ticket:typing', async ({ ticketId, typing } = {}) => {
    if (!(await checkTicketAccess(ticketId))) return;
    socket.to(`ticket:${ticketId}`).emit('ticket:typing', { ticketId, by: role, typing: !!typing });
  });

  socket.on('disconnect', () => {});
});

io.of('/admin').on('connection', (socket) => {
  socket.join('admins');
  socket.on('disconnect', () => {});
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
const PRIVATE_PREFIXES = ['/digital-items/', '/preorders/', '/service-orders/', '/replace-requests/'];
/** Legacy URLs only — new uploads store full CDN URLs in DB and never touch disk here */
const PUBLIC_BUNNY_ONLY_PREFIXES = ['/products/', '/services/', '/reviews/', '/manuals/'];

const servePublicFile = async (filePath, res, next) => {
  if (PRIVATE_PREFIXES.some(p => filePath.startsWith(p))) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const relativeUploadPath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  const localPath = path.join(UPLOADS_ROOT, relativeUploadPath);
  const bunnyOnly = PUBLIC_BUNNY_ONLY_PREFIXES.some((p) => filePath.startsWith(p));

  if (!bunnyOnly && fs.existsSync(localPath) && !fs.statSync(localPath).isDirectory()) {
    return next();
  }
  const storagePath = filePath.startsWith('/') ? filePath : `/${filePath}`;
  const storageUrl = `https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_ZONE}${storagePath}`;
  try {
    const upstream = await fetch(storageUrl, { headers: { AccessKey: process.env.BUNNY_ACCESS_KEY } });
    if (!upstream.ok) return res.status(404).end();
    const ct = upstream.headers.get('content-type');
    const cl = upstream.headers.get('content-length');
    if (ct) res.setHeader('Content-Type', ct);
    if (cl) res.setHeader('Content-Length', cl);
    res.setHeader('Cache-Control', 'public, max-age=2592000');
    return Readable.fromWeb(upstream.body).pipe(res);
  } catch {
    return res.status(500).end();
  }
};

app.use('/uploads', async (req, res, next) => {
  await servePublicFile(req.path, res, next);
}, express.static('uploads', { dotfiles: 'deny' }));

app.use('/api/v3/uploads', async (req, res, next) => {
  await servePublicFile(req.path, res, next);
}, express.static('uploads', { dotfiles: 'deny' }));

// Database connection
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await seedRoles();
    await seedCurrencies();
    await migrateProductUids();
    cleanOldReplacePhotos();
  })
  .catch(err => console.error('MongoDB connection error:', err));

// Seed default roles
async function seedRoles() {
  const roles = [
    { name: 'manager', access: 'manager' },
    { name: 'support', access: 'support' },
    { name: 'admin', access: 'all' },
    { name: 'new', access: 'nothing' }
  ];

  for (const roleData of roles) {
    const roleExists = await Role.findOne({ name: roleData.name });
    if (!roleExists) {
      await Role.create(roleData);
      console.log(`Role ${roleData.name} created`);
    }
  }
}

async function seedCurrencies() {
  const usd = await Currency.findOne({ symbol: 'USD' });
  if (!usd) {
    await Currency.create({ name: 'US Dollar', symbol: 'USD', isDefault: true });
    console.log('Currency USD created');
  }
}

async function migrateProductUids() {
  try {
    const crypto = await import('crypto');
    const gadsNoUid = await GoogleAdsProduct.find({ uid: { $exists: false } }).select('_id');
    for (const p of gadsNoUid) {
      await GoogleAdsProduct.updateOne({ _id: p._id }, { $set: { uid: 'GADS-' + crypto.randomBytes(4).toString('hex').toUpperCase() } });
    }
    const ytNoUid = await YoutubeProduct.find({ uid: { $exists: false } }).select('_id');
    for (const p of ytNoUid) {
      await YoutubeProduct.updateOne({ _id: p._id }, { $set: { uid: 'YT-' + crypto.randomBytes(4).toString('hex').toUpperCase() } });
    }
    const total = gadsNoUid.length + ytNoUid.length;
    if (total > 0) console.log(`[migrate] Added uid to ${gadsNoUid.length} GoogleAds + ${ytNoUid.length} YouTube products`);
  } catch (e) {
    console.error('[migrate] migrateProductUids error:', e.message);
  }
}

async function cleanOldReplacePhotos() {
  try {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const old = await ReplaceRequest.find({
      createdAt: { $lt: cutoff },
      'photos.0': { $exists: true }
    }).select('photos');
    for (const req of old) {
      for (const photo of req.photos) deleteAnyFile(photo);
      req.photos = [];
      await req.save();
    }
    if (old.length > 0) console.log(`[cleanup] Cleared photos from ${old.length} old replace requests`);
  } catch (e) {
    console.error('[cleanup] cleanOldReplacePhotos error:', e.message);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
setInterval(cleanOldReplacePhotos, DAY_MS);

// Routes
import v2Routes from './routes/v2/index.js';
import v3Routes from './routes/v3/index.js';
app.use('/api/v2', v2Routes);
app.use('/api/v3', v3Routes);

app.get('/', (req, res) => {
  res.send('Banana Shop API');
});

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ message: 'Internal server error' });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
