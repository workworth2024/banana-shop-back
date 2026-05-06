import express from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import Role from './models/Role.js';
import Currency from './models/Currency.js';
import { logError } from './controllers/healthController.js';

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

io.of('/customer').on('connection', (socket) => {
  const customerId = socket.handshake.auth?.customerId;
  if (customerId) {
    socket.join(`customer:${customerId}`);
  }
  socket.on('disconnect', () => {});
});

io.of('/support').on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());
app.use('/uploads', (req, res, next) => {
  if (req.path.startsWith('/digital-items/')) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}, express.static('uploads'));

// Database connection
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    await seedRoles();
    await seedCurrencies();
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
