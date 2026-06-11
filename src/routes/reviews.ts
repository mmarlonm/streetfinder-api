import { Router, Response } from 'express';
import Review from '../models/Review';
import VendorProfile from '../models/VendorProfile';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/reviews — Leave a review (client only)
router.post('/', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { vendorId, rating, comment } = req.body;
    if (!vendorId || !rating) {
      res.status(400).json({ success: false, message: 'vendorId y rating son requeridos' });
      return;
    }
    if (rating < 1 || rating > 5) {
      res.status(400).json({ success: false, message: 'El rating debe ser entre 1 y 5' });
      return;
    }

    // Upsert: update if user already reviewed this vendor
    const review = await Review.findOneAndUpdate(
      { vendorId, userId: req.user!._id },
      { rating, comment: comment?.trim() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Recalculate vendor rating
    const stats = await Review.aggregate([
      { $match: { vendorId: review.vendorId } },
      { $group: { _id: '$vendorId', avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    if (stats.length > 0) {
      const updatedVendor = await VendorProfile.findByIdAndUpdate(
        vendorId,
        {
          rating: Math.round(stats[0].avg * 10) / 10,
          totalReviews: stats[0].count,
        },
        { new: true }
      );
      const io = req.app.get('io');
      if (updatedVendor && io) {
        io.emit('vendor:stats-updated', {
          vendorId: vendorId.toString(),
          rating: updatedVendor.rating,
          totalReviews: updatedVendor.totalReviews,
        });
      }
    }

    res.status(201).json({ success: true, review });
  } catch (error: any) {
    console.error('Review error:', error);
    res.status(500).json({ success: false, message: 'Error al guardar la reseña' });
  }
});

// GET /api/reviews/vendor/:vendorId — Get reviews for a vendor
router.get('/vendor/:vendorId', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reviews = await Review.find({ vendorId: req.params.vendorId })
      .populate('userId', 'name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ success: true, reviews });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al obtener reseñas' });
  }
});

// GET /api/reviews/my/:vendorId — Check if current user already reviewed
router.get('/my/:vendorId', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const review = await Review.findOne({
      vendorId: req.params.vendorId,
      userId: req.user!._id,
    }).lean();
    res.json({ success: true, review: review || null });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

export default router;
