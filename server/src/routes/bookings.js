import { Router } from 'express';
import Booking from '../models/Booking.js';
import Event from '../models/Event.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { promoteWaitlist, tellPromoted } from '../utils/seats.js';
const router = Router();
router.use(protect, allow('attendee'));
router.get('/mine', asyncHandler(async (req, res) => {
  const list = await Booking.find({ userId: req.user._id }).populate('eventId').sort({ createdAt: -1 });
  // For waitlisted bookings, say which place in the queue the attendee has (1 = next in line).
  const out = await Promise.all(list.map(async b => {
    const o = b.toObject();
    if (b.status === 'waitlisted') o.waitlistPosition = await Booking.countDocuments({ eventId: b.eventId._id || b.eventId, status: 'waitlisted', createdAt: { $lte: b.createdAt } });
    return o;
  }));
  res.json(out);
}));
router.post('/:eventId', asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.eventId, status: 'published' });
  if (!event) return res.status(404).json({ message: 'Event is unavailable.' });
  if (event.startsAt <= new Date()) return res.status(400).json({ message: 'This event has already started.' });
  if (event.tiers && event.tiers.length) return res.status(400).json({ message: 'This event sells tickets. Choose a ticket type to continue.' });
  const existing = await Booking.findOne({ eventId: event._id, userId: req.user._id });
  if (existing && existing.status !== 'cancelled') return res.status(409).json({ message: 'You already have a booking or waitlist entry.' });
  // Atomic conditional update prevents two users taking the final seat at the same time.
  const updated = await Event.findOneAndUpdate({ _id: event._id, status: 'published', $expr: { $lt: ['$seatsBooked', '$capacity'] } }, { $inc: { seatsBooked: 1 } }, { new: true });
  const status = updated ? 'confirmed' : 'waitlisted';
  // If saving the booking fails after a seat was taken, the seat is given back so the count never drifts.
  const giveSeatBack = async () => {
    if (!updated) return;
    await Event.updateOne({ _id: event._id, seatsBooked: { $gt: 0 } }, { $inc: { seatsBooked: -1 } });
    await promoteWaitlist(event._id);
  };
  try {
    let booking;
    if (existing) {
      // Re-activate the old cancelled booking, but only if it is still cancelled (guards against double clicks).
      booking = await Booking.findOneAndUpdate({ _id: existing._id, status: 'cancelled' }, { status, createdAt: new Date(), checkedInAt: null }, { new: true });
      if (!booking) {
        await giveSeatBack();
        return res.status(409).json({ message: 'You already have a booking or waitlist entry.' });
      }
    } else {
      booking = await Booking.create({ eventId: event._id, userId: req.user._id, status });
    }
    res.status(201).json({ booking, message: status === 'confirmed' ? 'Your seat is confirmed!' : 'The event is full. You have been added to the waitlist.' });
  } catch (e) {
    await giveSeatBack().catch(() => {});
    if (e.code === 11000) return res.status(409).json({ message: 'You already booked this event.' });
    throw e;
  }
}));
router.patch('/:id/cancel', asyncHandler(async (req, res) => {
  // One atomic update: only one request can turn an active booking into a cancelled one.
  // It returns the booking as it was BEFORE the change, so we know whether a seat was held.
  const booking = await Booking.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, status: { $in: ['confirmed', 'waitlisted'] } }, { status: 'cancelled', checkedInAt: null });
  if (!booking) return res.status(404).json({ message: 'Active booking not found.' });
  if (booking.status === 'confirmed') {
    // Hand the freed seat straight to the oldest waitlisted attendee (the seat count stays the same)...
    const next = await Booking.findOneAndUpdate({ eventId: booking.eventId, status: 'waitlisted' }, { status: 'confirmed' }, { sort: { createdAt: 1 } });
    if (next) await tellPromoted(next);
    if (!next) {
      // ...or, if nobody is waiting, release the seat. The extra check covers someone joining the waitlist at the same moment.
      await Event.updateOne({ _id: booking.eventId, seatsBooked: { $gt: 0 } }, { $inc: { seatsBooked: -1 } });
      await promoteWaitlist(booking.eventId);
    }
  }
  res.json({ message: 'Booking cancelled.' });
}));
export default router;
