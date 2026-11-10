import mongoose from 'mongoose';
const bookingSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['confirmed', 'cancelled', 'waitlisted'], required: true },
  createdAt: { type: Date, default: Date.now },
  // Set when the organiser checks the attendee in at the door.
  checkedInAt: { type: Date, default: null }
});
bookingSchema.index({ eventId: 1, userId: 1 }, { unique: true });
export default mongoose.model('Booking', bookingSchema);
