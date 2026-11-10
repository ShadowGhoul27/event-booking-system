import mongoose from 'mongoose';
const eventSchema = new mongoose.Schema({
  organiserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  venue: { type: String, required: true },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  capacity: { type: Number, required: true, min: 1 },
  seatsBooked: { type: Number, default: 0, min: 0 },
  category: { type: String, default: 'Other' },
  imageUrl: { type: String, default: '' },
  // Short updates the organiser posts for everyone who is interested in the event.
  announcements: [{ message: { type: String, required: true, maxlength: 500 }, createdAt: { type: Date, default: Date.now } }],
  // Optional seat map. When enabled, attendees pick exact seats (rows are letters A, B, C..., seats are numbers).
  seating: {
    enabled: { type: Boolean, default: false },
    rows: { type: Number, default: 0 },
    seatsPerRow: { type: Number, default: 0 }
  },
  // Optional ticket tiers (Regular, VIP, Early Bird...). With tiers, booking works through a seat hold plus payment.
  // "left" is how many tickets of the tier can still be held or bought. "rows" is only used with a seat map.
  // "saleEndsAt" switches the tier off automatically (for example Early Bird).
  tiers: [{
    name: { type: String, required: true, trim: true, maxlength: 40 },
    price: { type: Number, required: true, min: 0 },
    limit: { type: Number, required: true, min: 1 },
    left: { type: Number, required: true, min: 0 },
    saleEndsAt: { type: Date, default: null },
    rows: { type: Number, default: 0 }
  }],
  // Attendees who were checked in can download a certificate after the event ends.
  offersCertificate: { type: Boolean, default: false },
  status: { type: String, enum: ['published', 'cancelled'], default: 'published' }
}, { timestamps: true });
eventSchema.index({ status:  1, startsAt: 1 });
export default mongoose.model('Event', eventSchema);
