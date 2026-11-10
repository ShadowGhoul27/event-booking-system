import { Router } from 'express';
import User from '../models/User.js';
import Event from '../models/Event.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const router = Router();
router.use(protect, allow('attendee'));
// Saved (favourite) events of the logged-in attendee. Cancelled events are left out.
router.get('/', asyncHandler(async (req, res) => {
  res.json(await Event.find({ _id: { $in: req.user.savedEvents || [] }, status: 'published' }).populate('organiserId', 'name').sort({ startsAt: 1 }));
}));
router.put('/:eventId', asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.eventId, status: 'published' }).select('_id');
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  await User.updateOne({ _id: req.user._id }, { $addToSet: { savedEvents: event._id } });
  res.json({ saved: true });
}));
router.delete('/:eventId', asyncHandler(async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $pull: { savedEvents: req.params.eventId } });
  res.json({ saved: false });
}));
export default router;
