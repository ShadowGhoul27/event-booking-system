import { Router } from 'express';
import Review from '../models/Review.js';
import Event from '../models/Event.js';
import Booking from '../models/Booking.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notify } from '../utils/notify.js';
const router = Router();

// Public: all reviews of an event, with the average rating.
router.get('/event/:eventId', asyncHandler(async (req, res) => {
  const reviews = await Review.find({ eventId: req.params.eventId }).populate('userId', 'name').sort({ createdAt: -1 });
  const count = reviews.length;
  const average = count ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / count) * 10) / 10 : 0;
  res.json({ average, count, reviews: reviews.map(r => ({ _id: r._id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, user: { name: r.userId?.name || 'Former user' } })) });
}));

// An attendee may review an event once it has ended and they held a confirmed seat.
async function eligibility(eventId, userId) {
  const event = await Event.findOne({ _id: eventId, status: 'published' });
  if (!event) return { event: null, ok: false, why: 'Event not found.' };
  if (event.endsAt > new Date()) return { event, ok: false, why: 'Reviews open when the event has ended.' };
  const booking = await Booking.findOne({ eventId, userId, status: 'confirmed' });
  if (!booking) return { event, ok: false, why: 'Only attendees with a confirmed booking can review this event.' };
  return { event, ok: true };
}
router.get('/event/:eventId/mine', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const e = await eligibility(req.params.eventId, req.user._id);
  res.json({ canReview: e.ok, reason: e.why || '', review: await Review.findOne({ eventId: req.params.eventId, userId: req.user._id }) });
}));
router.post('/event/:eventId', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const rating = Number(req.body.rating);
  const comment = typeof req.body.comment === 'string' ? req.body.comment.trim() : '';
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ message: 'Choose a rating from 1 to 5.' });
  if (comment.length > 500) return res.status(400).json({ message: 'Keep the comment under 500 characters.' });
  const e = await eligibility(req.params.eventId, req.user._id);
  if (!e.ok) return res.status(e.event ? 403 : 404).json({ message: e.why });
  const had = await Review.exists({ eventId: e.event._id, userId: req.user._id });
  const review = await Review.findOneAndUpdate({ eventId: e.event._id, userId: req.user._id }, { rating, comment }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (!had) await notify(e.event.organiserId, `${req.user.name} rated "${e.event.title}" ${rating}/5.`, '/events/' + e.event._id);
  res.status(had ? 200 : 201).json(review);
}));
router.delete('/event/:eventId', protect, allow('attendee'), asyncHandler(async (req, res) => {
  await Review.deleteOne({ eventId: req.params.eventId, userId: req.user._id });
  res.json({ ok: true });
}));
export default router;
