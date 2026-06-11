import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/db';
import authRoutes from './routes/auth';
import vendorRoutes from './routes/vendors';
import categoryRoutes from './routes/categories';
import reviewRoutes from './routes/reviews';
import promotionRoutes from './routes/promotions';
import { setupSocketHandlers } from './sockets/locationHandler';

const app = express();
const httpServer = createServer(app);

// ─── Socket.io ────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  },
  transports: ['websocket', 'polling'],
});

app.set('io', io);

// ─── Middleware ───────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Health check ─────────────────────────────────────────────────
app.get(['/', '/api/health'], (_req, res) => {
  res.json({
    success: true,
    message: '🚀 StreetFinder API corriendo',
    timestamp: new Date().toISOString(),
  });
});

// ─── Routes ───────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/promotions', promotionRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// ─── Socket.io setup ──────────────────────────────────────────────
setupSocketHandlers(io);

// ─── Start server ─────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3001', 10);

const startServer = async (): Promise<void> => {
  await connectDB();
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 StreetFinder API`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
};

startServer().catch(console.error);

export { io };
