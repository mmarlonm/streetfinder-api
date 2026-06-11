import { Router, Response } from 'express';
import Promotion from '../models/Promotion';
import VendorProfile from '../models/VendorProfile';
import User from '../models/User';
import { protect, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// Expo Push API helper
async function sendExpoPush(tokens: string[], title: string, body: string, data?: object) {
  if (!tokens.length) return;
  const messages = tokens.filter(t => t && t.startsWith('ExponentPushToken')).map(to => ({
    to, title, body, data: data || {}, sound: 'default', priority: 'high',
  }));
  if (!messages.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate' },
      body: JSON.stringify(messages),
    });
  } catch (e) { console.error('Push error:', e); }
}

// GET /api/promotions/vendor/:vendorId — Promotions of a vendor
router.get('/vendor/:vendorId', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const promotions = await Promotion.find({ vendorId: req.params.vendorId, isActive: true, expiresAt: { $gte: new Date() } }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, promotions });
  } catch (e) { res.status(500).json({ success: false, message: 'Error al obtener promociones' }); }

});

// GET /api/promotions/my — My promotions (vendor)
router.get('/my', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vp = await VendorProfile.findOne({ userId: req.user!._id });
    if (!vp) { res.status(404).json({ success: false, message: 'Perfil no encontrado' }); return; }
    // Use a raw find bypassing the pre-find hook to also show expired promotions owned by vendor
    const promotions = await Promotion.collection.find({ vendorId: vp._id }).sort({ createdAt: -1 }).toArray();
    res.json({ success: true, promotions });
  } catch (e) { res.status(500).json({ success: false, message: 'Error al obtener promociones' }); }
});

// POST /api/promotions — Create promotion (vendor only)
router.post('/', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vp = await VendorProfile.findOne({ userId: req.user!._id });
    if (!vp) { res.status(404).json({ success: false, message: 'Perfil de vendedor no encontrado' }); return; }
    if (!vp.isActive || !vp.currentLocation) {
      res.status(400).json({ success: false, message: 'Debes estar activo en el mapa para crear una promoción' }); return;
    }

    const { title, description, imageBase64, price, discount, durationDays } = req.body;
    if (!title || !durationDays) {
      res.status(400).json({ success: false, message: 'Título y duración son requeridos' }); return;
    }

    const expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    const promo = await Promotion.create({
      vendorId: vp._id, title, description, imageBase64, price, discount, durationDays, isActive: true, expiresAt,
    });

    // Notify nearby clients via push
    const [lng, lat] = vp.currentLocation.coordinates;
    const R = 6371000; // Earth radius in meters
    const latDelta = (2000 / R) * (180 / Math.PI);
    const lngDelta = latDelta / Math.cos(lat * Math.PI / 180);
    const nearbyUsers = await User.find({
      pushToken: { $exists: true, $ne: null },
      lastLat: { $gte: lat - latDelta, $lte: lat + latDelta },
      lastLng: { $gte: lng - lngDelta, $lte: lng + lngDelta },
    }).lean();
    const tokens = nearbyUsers.map(u => u.pushToken!).filter(Boolean);
    await sendExpoPush(tokens, `🎯 Promoción cerca de ti`, `${vp.businessName}: ${title}${discount ? ` — ${discount}% OFF` : ''}`, { type: 'promotion', promotionId: promo._id.toString(), vendorId: vp._id.toString() });

    // Emitir la promoción en tiempo real a todos los sockets conectados
    const io = req.app.get('io');
    if (io) {
      io.emit('vendor:promotion', {
        vendorId: vp._id.toString(),
        promotion: promo,
      });
    }

    res.status(201).json({ success: true, promotion: promo });
  } catch (e: any) {
    console.error('Create promotion error:', e);
    res.status(500).json({ success: false, message: 'Error al crear promoción' });
  }
});

// DELETE /api/promotions/:id — Delete promotion
router.delete('/:id', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vp = await VendorProfile.findOne({ userId: req.user!._id });
    if (!vp) { res.status(404).json({ success: false, message: 'Perfil no encontrado' }); return; }
    await Promotion.collection.deleteOne({ _id: new (require('mongoose').Types.ObjectId)(req.params.id), vendorId: vp._id });
    
    // Emitir en tiempo real que la promoción ha finalizado
    const io = req.app.get('io');
    if (io) {
      io.emit('vendor:promotion', {
        vendorId: vp._id.toString(),
        promotion: null,
      });
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Error al eliminar promoción' }); }
});

export { sendExpoPush };
export default router;
