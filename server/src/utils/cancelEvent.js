import Event from '../models/Event.js';
import Booking from '../models/Booking.js';
import Ticket from '../models/Ticket.js';
import { notify } from './notify.js';

// Cancels an event and every booking and waitlist entry on it, and tells the people affected.
export async function cancelEvent(filter) {
  const event = await Event.findOneAndUpdate(filter, { status: 'cancelled', seatsBooked: 0 }, { new: true });
  if (!event) return null;
  const active = await Booking.find({ eventId: event._id, status: { $in: ['confirmed', 'waitlisted'] } }).select('userId');
  await Booking.updateMany({ eventId: event._id, status: { $in: ['confirmed', 'waitlisted'] } }, { status: 'cancelled', checkedInAt: null });
  // Paid tickets are refunded (simulated) and held tickets are dropped.
  const tickets = await Ticket.find({ eventId: event._id, status: { $in: ['held', 'confirmed'] } }).select('ownerId status paidAmount');
  await Ticket.updateMany({ eventId: event._id, status: 'confirmed' }, [{ $set: { status: 'cancelled', active: false, refunded: { $gt: ['$paidAmount', 0] }, checkedInAt: null } }]);
  await Ticket.updateMany({ eventId: event._id, status: 'held' }, { status: 'cancelled', active: false, holdExpiresAt: null });
  await Event.updateOne({ _id: event._id }, { $set: { 'tiers.$[].left': 0 } });
  await notify([...active.map(b => b.userId), ...tickets.map(t => t.ownerId)], `"${event.title}" was cancelled.`, '/my-bookings');
  return event;
}
