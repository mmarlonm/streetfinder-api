import { Router, Response } from 'express';
import VendorProfile, { VENDOR_CATEGORIES } from '../models/VendorProfile';
import Promotion from '../models/Promotion';
import User from '../models/User';
import { protect, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/vendors/stats — Vendor stats
router.get('/stats', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vp = await VendorProfile.findOne({ userId: req.user!._id }).lean();
    if (!vp) { res.status(404).json({ success: false, message: 'Perfil no encontrado' }); return; }
    res.json({
      success: true,
      stats: {
        rating: vp.rating,
        totalReviews: vp.totalReviews,
        isActive: vp.isActive,
        memberSince: vp.createdAt,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: 'Error al obtener estadísticas' }); }
});

// PATCH /api/vendors/location — Background location update
router.patch('/location', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ success: false, message: 'Coordenadas inválidas' }); return;
    }
    const updated = await VendorProfile.findOneAndUpdate(
      { userId: req.user!._id, isActive: true },
      { $set: { currentLocation: { type: 'Point', coordinates: [lng, lat] }, lastSeen: new Date() } },
      { new: true }
    );
    const io = req.app.get('io');
    if (updated && io) {
      io.emit('vendors:update', { vendorId: updated._id.toString(), lat, lng });
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Error' }); }
});

// GET /api/vendors/nearby?lat=&lng=&radius=500&category=
router.get('/nearby', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseInt(req.query.radius as string) || 500;
    const category = req.query.category as string | undefined;

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ success: false, message: 'Coordenadas inválidas' });
      return;
    }

    const maxRadius = Math.min(radius, 5000);
    const query: Record<string, unknown> = {
      isActive: true,
      currentLocation: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: maxRadius,
        },
      },
    };

    if (category && category !== 'all') query.category = category;

    const vendors = await VendorProfile.find(query)
      .populate('userId', 'name avatar phone')
      .limit(50)
      .lean();

    // Buscar promociones activas para estos vendedores
    const vendorIds = vendors.map(v => v._id);
    const now = new Date();
    const activePromotions = await Promotion.find({
      vendorId: { $in: vendorIds },
      isActive: true,
      expiresAt: { $gt: now }
    }).lean();

    // Asociar promociones activas a los vendedores
    const vendorsWithPromos = vendors.map(v => {
      const promo = activePromotions.find(p => p.vendorId.toString() === v._id.toString());
      return {
        ...v,
        activePromotion: promo ? {
          _id: promo._id,
          title: promo.title,
          description: promo.description,
          price: promo.price,
          discount: promo.discount,
          imageBase64: promo.imageBase64,
          expiresAt: promo.expiresAt
        } : null
      };
    });

    res.status(200).json({ success: true, count: vendorsWithPromos.length, vendors: vendorsWithPromos });
  } catch (error) {
    console.error('Nearby vendors error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});


// PUT /api/vendors/profile — Update vendor profile
router.put('/profile', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { businessName, category, description, avatar } = req.body;
    const updates: Record<string, unknown> = {};
    if (businessName) updates.businessName = businessName;
    if (category) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (avatar !== undefined) updates.avatar = avatar;

    const vendor = await VendorProfile.findOneAndUpdate(
      { userId: req.user!._id },
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('userId', 'name avatar phone');

    if (!vendor) { res.status(404).json({ success: false, message: 'Perfil de vendedor no encontrado' }); return; }
    res.status(200).json({ success: true, vendor });
  } catch (error) {
    console.error('Update vendor profile error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PATCH /api/vendors/status — Toggle active/inactive
router.patch('/status', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isActive, lat, lng } = req.body;
    const updates: Record<string, unknown> = { isActive, lastSeen: new Date() };

    if (isActive && lat !== undefined && lng !== undefined) {
      updates.currentLocation = { type: 'Point', coordinates: [lng, lat] };
    }
    if (!isActive) {
      updates.currentLocation = undefined;
    }

    const vendor = await VendorProfile.findOneAndUpdate(
      { userId: req.user!._id },
      { $set: updates },
      { new: true }
    ).populate('userId', 'name avatar phone');

    if (!vendor) { res.status(404).json({ success: false, message: 'Perfil de vendedor no encontrado' }); return; }

    // Emit vendor:online / offline so clients immediately update their map
    const io = req.app.get('io');
    if (io) {
      if (isActive && vendor.currentLocation) {
        const [vLng, vLat] = vendor.currentLocation.coordinates;
        io.emit('vendor:online', {
          vendorId: vendor._id.toString(),
          lat: vLat, lng: vLng,
          businessName: vendor.businessName,
          category: vendor.category,
        });
      } else if (!isActive) {
        io.emit('vendor:offline', { vendorId: vendor._id.toString() });
      }
    }

    res.status(200).json({ success: true, vendor });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// GET /api/vendors/nearby-clients — Get active clients nearby
router.get('/nearby-clients', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseInt(req.query.radius as string) || 2000;

    if (isNaN(lat) || isNaN(lng)) {
      res.status(400).json({ success: false, message: 'Coordenadas inválidas' });
      return;
    }

    // Buscamos clientes que se hayan actualizado en las últimas 4 horas
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    
    // Buscamos usuarios con rol client que tengan coordenadas lastLat y lastLng y sean visibles
    const clients = await User.find({
      role: 'client',
      isVisible: { $ne: false },
      lastLat: { $exists: true, $ne: null },
      lastLng: { $exists: true, $ne: null },
      updatedAt: { $gte: fourHoursAgo }
    }).select('name avatar phone lastLat lastLng craving updatedAt').lean();

    // Calcular distancia de Haversine en metros
    const R = 6371e3; // Radio de la tierra en metros
    const nearbyClients = clients.filter(c => {
      const lat1 = lat * Math.PI / 180;
      const lat2 = c.lastLat! * Math.PI / 180;
      const deltaLat = (c.lastLat! - lat) * Math.PI / 180;
      const deltaLng = (c.lastLng! - lng) * Math.PI / 180;

      const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
                Math.cos(lat1) * Math.cos(lat2) *
                Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
      const dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
      return dist <= radius;
    }).map(c => ({
      _id: c._id,
      name: c.name,
      avatar: c.avatar,
      phone: c.phone,
      latitude: c.lastLat,
      longitude: c.lastLng,
      craving: c.craving,
      lastActive: c.updatedAt
    }));

    res.json({ success: true, count: nearbyClients.length, clients: nearbyClients });
  } catch (error) {
    console.error('Nearby clients error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PUT /api/vendors/products — Update vendor products catalog
router.put('/products', protect, requireRole('vendor'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products)) {
      res.status(400).json({ success: false, message: 'Productos debe ser un arreglo' });
      return;
    }

    const vendor = await VendorProfile.findOneAndUpdate(
      { userId: req.user!._id },
      { $set: { products } },
      { new: true }
    ).populate('userId', 'name avatar phone');

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Perfil de vendedor no encontrado' });
      return;
    }

    res.status(200).json({ success: true, vendor });
  } catch (error) {
    console.error('Update products error:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar catálogo de productos' });
  }
});

// GET /api/vendors/:id — Vendor detail
router.get('/:id', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const vendor = await VendorProfile.findById(req.params.id)
      .populate('userId', 'name avatar phone email')
      .lean();
    if (!vendor) { res.status(404).json({ success: false, message: 'Vendedor no encontrado' }); return; }
    res.status(200).json({ success: true, vendor });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

export default router;
