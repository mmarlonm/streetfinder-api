import mongoose, { Schema, Document, Model } from 'mongoose';

export const VENDOR_CATEGORIES = [
  { id: 'comida', name: 'Comida', icon: '🌮', color: '#FF6B35' },
  { id: 'bebidas', name: 'Bebidas', icon: '🥤', color: '#4ECDC4' },
  { id: 'frutas', name: 'Frutas y Verduras', icon: '🍎', color: '#6BCF7F' },
  { id: 'dulces', name: 'Dulces y Postres', icon: '🍰', color: '#F7B731' },
  { id: 'ropa', name: 'Ropa y Accesorios', icon: '👕', color: '#A855F7' },
  { id: 'artesanias', name: 'Artesanías', icon: '🎨', color: '#EC4899' },
  { id: 'electronicos', name: 'Electrónicos', icon: '📱', color: '#3B82F6' },
  { id: 'juguetes', name: 'Juguetes', icon: '🧸', color: '#F97316' },
  { id: 'flores', name: 'Flores y Plantas', icon: '🌺', color: '#10B981' },
  { id: 'otros', name: 'Otros', icon: '🛍️', color: '#6B7280' },
] as const;

export type CategoryId = typeof VENDOR_CATEGORIES[number]['id'];

export interface IProduct {
  name: string;
  price: number;
  description?: string;
  imageBase64?: string;
  category?: string;
}

export interface IVendorProfile extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  businessName: string;
  category: CategoryId;
  description?: string;
  avatar?: string;
  isActive: boolean;
  currentLocation?: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  lastSeen?: Date;
  rating: number;
  totalReviews: number;
  products?: IProduct[];
  createdAt: Date;
  updatedAt: Date;
}

const VendorProfileSchema: Schema<IVendorProfile> = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    businessName: {
      type: String,
      required: [true, 'El nombre del negocio es requerido'],
      trim: true,
      maxlength: [80, 'El nombre no puede tener más de 80 caracteres'],
    },
    category: {
      type: String,
      required: [true, 'La categoría es requerida'],
      enum: VENDOR_CATEGORIES.map((c) => c.id),
    },
    description: {
      type: String,
      maxlength: [300, 'La descripción no puede tener más de 300 caracteres'],
    },
    avatar: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    lastSeen: {
      type: Date,
      default: null,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    products: {
      type: [
        {
          name: { type: String, required: true },
          price: { type: Number, required: true },
          description: { type: String },
          imageBase64: { type: String },
          category: { type: String, default: 'Otros' },
        }
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// 2dsphere index for geospatial queries
VendorProfileSchema.index({ currentLocation: '2dsphere' });
VendorProfileSchema.index({ isActive: 1 });
VendorProfileSchema.index({ category: 1 });

const VendorProfile: Model<IVendorProfile> = mongoose.model<IVendorProfile>(
  'VendorProfile',
  VendorProfileSchema
);

export default VendorProfile;
