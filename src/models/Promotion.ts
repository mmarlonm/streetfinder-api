import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPromotion extends Document {
  vendorId: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  imageBase64?: string;       // foto del producto en base64
  price?: number;
  discount?: number;          // porcentaje de descuento (0-100)
  isActive: boolean;
  expiresAt: Date;            // calculado: createdAt + durationDays
  durationDays: number;
  createdAt: Date;
  updatedAt: Date;
}

const PromotionSchema: Schema<IPromotion> = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'VendorProfile', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, maxlength: 300, trim: true },
    imageBase64: { type: String, default: null }, // base64 compressed image
    price: { type: Number, min: 0 },
    discount: { type: Number, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date, required: true },
    durationDays: { type: Number, required: true, min: 1, max: 30 },
  },
  { timestamps: true }
);


const Promotion: Model<IPromotion> = mongoose.model<IPromotion>('Promotion', PromotionSchema);
export default Promotion;

