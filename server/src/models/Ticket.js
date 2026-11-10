import mongoose from 'mongoose';
// One ticket = one seat (or one general-admission place) at an event that sells tiers.
// status "held": reserved for a few minutes while it is paid. "confirmed": paid. "cancelled": refunded.
const ticketSchema = new mongoose.Schema({
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', required: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tierId: { type: mongoose.Schema.Types.ObjectId, required: true },
  tierName: { type: String, required: true },
  price: { type: Number, required: true, min: 0 },
  seat: { type: String, default: null },
  status: { type: String, enum: ['held', 'confirmed', 'cancelled'], required: true },
  // true while the ticket occupies a seat (held or confirmed). Used by the unique seat index below.
  active: { type: Boolean, default: true },
  holdExpiresAt: { type: Date, default: null },
  // Anyone with this token can open the payment link for this ticket (group booking).
  payToken: { type: String, required: true, unique: true },
  // The code in the QR ticket. It changes when the ticket is transferred.
  code: { type: String, required: true, unique: true },
  paidAt: { type: Date, default: null },
  paidAmount: { type: Number, default: 0 },
  paymentRef: { type: String, default: '' },
  refunded: { type: Boolean, default: false },
  checkedInAt: { type: Date, default: null },
  transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });
// Two people can never own the same seat: the database itself refuses a second active ticket for a seat.
ticketSchema.index({ eventId: 1, seat: 1 }, { unique: true, partialFilterExpression: { active: true, seat: { $type: 'string' } } });
ticketSchema.index({ ownerId: 1, status: 1 });
ticketSchema.index({ status: 1, holdExpiresAt: 1 });
export default mongoose.model('Ticket', ticketSchema);
