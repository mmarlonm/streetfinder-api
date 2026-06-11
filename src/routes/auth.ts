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
        isVisible: user.isVisible,
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
        isVisible: user.isVisible,
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
        isVisible: user.isVisible,
      },
      vendorProfile,
    });
  } catch (error) {
    console.error('Me error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PUT /api/auth/avatar — Update user avatar (base64)
router.put('/avatar', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { avatar } = req.body;
    if (!avatar) { res.status(400).json({ success: false, message: 'Avatar requerido' }); return; }
    const user = await User.findByIdAndUpdate(req.user!._id, { avatar }, { new: true });
    if (!user) { res.status(404).json({ success: false, message: 'Usuario no encontrado' }); return; }
    res.json({ success: true, avatar: user.avatar });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar avatar' });
  }
});

// PUT /api/auth/profile — Update user profile (name, phone)
router.put('/profile', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, phone } = req.body;
    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;
    if (phone !== undefined) updates.phone = phone;
    const user = await User.findByIdAndUpdate(req.user!._id, updates, { new: true });
    if (!user) { res.status(404).json({ success: false, message: 'Usuario no encontrado' }); return; }
    res.json({ success: true, user: { _id: user._id, name: user.name, email: user.email, role: user.role, avatar: user.avatar, phone: user.phone, isVisible: user.isVisible } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al actualizar perfil' });
  }
});

// PUT /api/auth/push-token — Register push notification token
router.put('/push-token', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.user!._id, { pushToken });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error al registrar token' });
  }
});

// PATCH /api/auth/location — Client updates their last known location (for proximity push)
router.patch('/location', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ success: false, message: 'Coordenadas inválidas' }); return;
    }
    const user = await User.findByIdAndUpdate(req.user!._id, { lastLat: lat, lastLng: lng }, { new: true });
    const io = req.app.get('io');
    if (user && user.isVisible !== false && io) {
      io.emit('client:update', {
        clientId: user._id.toString(),
        name: user.name,
        craving: user.craving,
        latitude: lat,
        longitude: lng,
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error' });
  }
});

// PUT /api/auth/craving — Update user craving and emit in real-time
router.put('/craving', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { craving } = req.body;
    const user = await User.findByIdAndUpdate(req.user!._id, { craving: craving?.trim() || null }, { new: true });
    if (!user) { res.status(404).json({ success: false, message: 'Usuario no encontrado' }); return; }

    // Emitir el antojo en tiempo real a todos los sockets conectados si es visible
    const io = req.app.get('io');
    if (user.isVisible !== false && io) {
      io.emit('client:craving', {
        _id: user._id.toString(),
        name: user.name,
        avatar: user.avatar,
        phone: user.phone,
        craving: user.craving || null,
        latitude: user.lastLat,
        longitude: user.lastLng,
      });
    }

    res.json({ success: true, craving: user.craving });
  } catch (error) {
    console.error('Craving error:', error);
    res.status(500).json({ success: false, message: 'Error al actualizar antojo' });
  }
});

// PUT /api/auth/visibility — Toggle client visibility
router.put('/visibility', protect, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { isVisible } = req.body;
    if (typeof isVisible !== 'boolean') {
      res.status(400).json({ success: false, message: 'isVisible debe ser un valor booleano' }); return;
    }
    const user = await User.findByIdAndUpdate(req.user!._id, { isVisible }, { new: true });
    if (!user) { res.status(404).json({ success: false, message: 'Usuario no encontrado' }); return; }

    const io = req.app.get('io');
    if (!isVisible && io) {
      // Notificar a los vendedores que remuevan al cliente de sus mapas
      io.emit('client:offline', { clientId: user._id.toString() });
    } else if (isVisible && io && user.lastLat && user.lastLng) {
      // Si se vuelve visible, notificar su ubicación actual
      io.emit('client:update', {
        clientId: user._id.toString(),
        name: user.name,
        craving: user.craving,
        latitude: user.lastLat,
        longitude: user.lastLng,
      });
    }

    res.json({ success: true, isVisible: user.isVisible });
  } catch (error) {
    console.error('Visibility route error:', error);
    res.status(500).json({ success: false, message: 'Error al cambiar visibilidad' });
  }
});

export default router;

