import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import VendorProfile from '../models/VendorProfile';

interface VendorLocationPayload {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  vendorProfileId?: string;
}

// Map of vendorProfileId -> socketId for tracking active vendors
const activeVendors = new Map<string, string>();

export const setupSocketHandlers = (io: Server): void => {
  // Authentication middleware for Socket.io
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) {
        return next(new Error('Token requerido'));
      }
      const secret = process.env.JWT_SECRET || 'secret';
      const decoded = jwt.verify(token, secret) as { id: string };
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', async (socket: AuthenticatedSocket) => {
    console.log(`🔌 Socket conectado: ${socket.id} (user: ${socket.userId})`);

    // ─── VENDOR: Start sharing location ───────────────────────────
    socket.on('vendor:start', async () => {
      try {
        const vendorProfile = await VendorProfile.findOne({ userId: socket.userId });
        if (!vendorProfile) return;

        socket.vendorProfileId = vendorProfile._id.toString();
        socket.userRole = 'vendor';
        activeVendors.set(vendorProfile._id.toString(), socket.id);

        // Join vendor's own room
        socket.join(`vendor:${socket.vendorProfileId}`);

        // Mark as active
        await VendorProfile.findByIdAndUpdate(vendorProfile._id, {
          isActive: true,
          lastSeen: new Date(),
        });

        socket.emit('vendor:ready', { vendorProfileId: socket.vendorProfileId });
        console.log(`📍 Vendedor activo: ${vendorProfile.businessName}`);
      } catch (error) {
        console.error('vendor:start error:', error);
      }
    });

    // ─── VENDOR: Update location ───────────────────────────────────
    socket.on('vendor:location', async (payload: VendorLocationPayload) => {
      try {
        if (!socket.vendorProfileId) return;

        const { lat, lng } = payload;
        if (typeof lat !== 'number' || typeof lng !== 'number') return;

        // Update location in MongoDB
        const updated = await VendorProfile.findByIdAndUpdate(
          socket.vendorProfileId,
          {
            $set: {
              currentLocation: { type: 'Point', coordinates: [lng, lat] },
              lastSeen: new Date(),
              isActive: true,
            },
          },
          { new: true }
        ).populate('userId', 'name avatar');

        if (!updated) return;

        // Broadcast to all clients listening to this vendor
        io.to(`vendor:${socket.vendorProfileId}`).emit('vendor:moved', {
          vendorId: socket.vendorProfileId,
          lat,
          lng,
          lastSeen: updated.lastSeen,
        });

        // Broadcast general update to all clients in the area
        io.emit('vendors:update', {
          vendorId: socket.vendorProfileId,
          lat,
          lng,
          businessName: updated.businessName,
          category: updated.category,
          avatar: (updated.userId as { avatar?: string })?.avatar,
        });

      } catch (error) {
        console.error('vendor:location error:', error);
      }
    });

    // ─── CLIENT: Subscribe to a specific vendor ────────────────────
    socket.on('client:watch', (vendorId: string) => {
      socket.join(`vendor:${vendorId}`);
      console.log(`👁️ Cliente observando vendedor: ${vendorId}`);
    });

    // ─── CLIENT: Unsubscribe from a vendor ────────────────────────
    socket.on('client:unwatch', (vendorId: string) => {
      socket.leave(`vendor:${vendorId}`);
    });

    // ─── VENDOR: Offer products to client in real-time ────────────
    socket.on('vendor:send-offer', async (payload: { clientId: string, vendorId: string }) => {
      try {
        const { clientId, vendorId } = payload;
        if (!clientId || !vendorId) return;

        // Buscar información completa del negocio
        const vendor = await VendorProfile.findById(vendorId).populate('userId', 'name avatar phone').lean();
        if (!vendor) return;

        // Emitir oferta a todos los clientes (ellos filtran localmente por clientId)
        io.emit('vendor:offer', {
          clientId,
          vendor: {
            _id: vendor._id.toString(),
            businessName: vendor.businessName,
            category: vendor.category,
            rating: vendor.rating,
            totalReviews: vendor.totalReviews,
            phone: (vendor.userId as any)?.phone,
            name: (vendor.userId as any)?.name,
          }
        });
        console.log(`✉️ Oferta en tiempo real enviada de ${vendor.businessName} a cliente ${clientId}`);
      } catch (error) {
        console.error('vendor:send-offer error:', error);
      }
    });

    // ─── VENDOR: Stop sharing location / Go offline ───────────────
    socket.on('vendor:offline', async () => {
      try {
        if (!socket.vendorProfileId) return;
        activeVendors.delete(socket.vendorProfileId);

        await VendorProfile.findByIdAndUpdate(socket.vendorProfileId, {
          isActive: false,
          lastSeen: new Date(),
        });

        io.emit('vendor:offline', { vendorId: socket.vendorProfileId });
        console.log(`📴 Vendedor desconectado (manual): ${socket.vendorProfileId}`);
      } catch (error) {
        console.error('vendor:offline error:', error);
      }
    });

    // ─── DISCONNECT ───────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔌 Socket desconectado: ${socket.id}`);

      if (socket.vendorProfileId) {
        activeVendors.delete(socket.vendorProfileId);

        await VendorProfile.findByIdAndUpdate(socket.vendorProfileId, {
          isActive: false,
          lastSeen: new Date(),
        });

        // Notify all clients that vendor went offline
        io.emit('vendor:offline', { vendorId: socket.vendorProfileId });
        console.log(`📴 Vendedor desconectado: ${socket.vendorProfileId}`);
      }
    });
  });

  console.log('⚡ Socket.io handlers configurados');
};
