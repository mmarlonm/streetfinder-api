import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import VendorProfile from '../models/VendorProfile';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

const signToken = (id: string): string => {
  const secret = process.env.JWT_SECRET || 'secret';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ id }, secret, { expiresIn } as jwt.SignOptions);
};

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role, businessName, category, phone } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      res.status(400).json({ success: false, message: 'Nombre, email, contraseña y rol son requeridos' });
      return;
    }

    if (!['client', 'vendor'].includes(role)) {
      res.status(400).json({ success: false, message: 'Rol inválido' });
      return;
    }

    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(409).json({ success: false, message: 'El email ya está registrado' });
      return;
    }

    // Create user
    const user = await User.create({ name, email, password, role, phone });

    // If vendor, create profile
    if (role === 'vendor') {
      if (!businessName || !category) {
        await User.findByIdAndDelete(user._id);
        res.status(400).json({ success: false, message: 'Los vendedores necesitan nombre de negocio y categoría' });
        return;
      }
      await VendorProfile.create({
        userId: user._id,
        businessName,
        category,
      });
    }

    const token = signToken(user._id.toString());

    res.status(201).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
      },
    });
  } catch (error: unknown) {
    console.error('Register error:', error);
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === '11000') {
      res.status(409).json({ success: false, message: 'El email ya está registrado' });
    } else {
      res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email y contraseña son requeridos' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
      return;
    }

    let vendorProfile = null;
    if (user.role === 'vendor') {
      vendorProfile = await VendorProfile.findOne({ userId: user._id });
    }

    const token = signToken(user._id.toString());

    res.status(200).json({
      success: true,
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
      },
      vendorProfile,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    let vendorProfile = null;
    if (user.role === 'vendor') {
      vendorProfile = await VendorProfile.findOne({ userId: user._id });
    }

    res.status(200).json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        phone: user.phone,
      },
      vendorProfile,
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

export default router;
