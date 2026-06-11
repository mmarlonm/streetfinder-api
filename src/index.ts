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
  const routes: string[] = [];
  function getRoutes(layer: any, path: string) {
    if (layer.route) {
      layer.route.stack.forEach((stackItem: any) => {
        const method = stackItem.method ? stackItem.method.toUpperCase() : '';
        routes.push(`${method} ${path}${layer.route.path}`);
      });
    } else if (layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach((stackItem: any) => {
        // Clean regex path formatting
        let cleanPath = '';
        if (layer.regexp && layer.regexp.source) {
          cleanPath = layer.regexp.source
            .replace('\\/?(?=\\/|$)', '')
            .replace('^', '')
            .replace('\\/', '/')
            .replace('\\', '');
          // Remove trailing slash if present
          if (cleanPath.endsWith('/')) {
            cleanPath = cleanPath.slice(0, -1);
          }
        }
        getRoutes(stackItem, path + cleanPath);
      });
    }
  }
  
  try {
    const routerObj = (app as any).router || (app as any)._router;
    console.log('[Health] Router object found:', !!routerObj, 'stack length:', routerObj && routerObj.stack ? routerObj.stack.length : 'undefined');
    if (routerObj && routerObj.stack) {
      routerObj.stack.forEach((layer: any) => {
        getRoutes(layer, '');
      });
    }
  } catch (err) {
    console.error('[Health] Error listing routes:', err);
  }

  res.json({
    success: true,
    message: '🚀 StreetFinder API corriendo',
    timestamp: new Date().toISOString(),
    version: '1.0.1',
    routes: routes.filter((r, i, arr) => arr.indexOf(r) === i), // deduplicate
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
