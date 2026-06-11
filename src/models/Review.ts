import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IReview extends Document {
  vendorId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  rating: number;
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewSchema: Schema<IReview> = new Schema(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'VendorProfile', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 300, trim: true },
  },
  { timestamps: true }
);

// One review per user per vendor
ReviewSchema.index({ vendorId: 1, userId: 1 }, { unique: true });

const Review: Model<IReview> = mongoose.model<IReview>('Review', ReviewSchema);
export default Review;
