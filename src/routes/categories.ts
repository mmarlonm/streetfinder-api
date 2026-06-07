import { Router, Request, Response } from 'express';
import { VENDOR_CATEGORIES } from '../models/VendorProfile';
import { protect } from '../middleware/auth';

const router = Router();

// GET /api/categories
router.get('/', protect, async (_req: Request, res: Response): Promise<void> => {
  res.status(200).json({
    success: true,
    categories: VENDOR_CATEGORIES,
  });
});

export default router;
