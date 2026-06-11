import { Router, Response } from 'express';
import VendorProfile, { VENDOR_CATEGORIES } from '../models/VendorProfile';
import { protect, requireRole, AuthRequest } from '../middleware/auth';
import { io } from '../index';

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

    res.status(200).json({ success: true, count: vendors.length, vendors });
  } catch (error) {
    console.error('Nearby vendors error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
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

    // Emit vendor:online so clients immediately see the vendor on map
    if (isActive && io && vendor.currentLocation) {
      const [vLng, vLat] = vendor.currentLocation.coordinates;
      io.emit('vendor:online', {
        vendorId: vendor._id.toString(),
        lat: vLat, lng: vLng,
        businessName: vendor.businessName,
        category: vendor.category,
      });
    }

    res.status(200).json({ success: true, vendor });
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

export default router;
