import { Router } from 'express';
import User from '../models/User.js';
import Event from '../models/Event.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { cancelEvent } from '../utils/cancelEvent.js';
import { notify } from '../utils/notify.js';
const router = Router();
router.use(protect, allow('admin'));

router.get('/overview', asyncHandler(async (req, res) => {
  const [attendees, organisers, pending, events, published] = await Promise.all([
    User.countDocuments({ role: 'attendee' }),
    User.countDocuments({ role: 'organiser', accountStatus: { $ne: 'rejected' } }),
    User.countDocuments({ role: 'organiser', accountStatus: 'pending' }),
    Event.countDocuments(),
    Event.countDocuments({ status: 'published' })
  ]);
  res.json({ attendees, organisers, pendingOrganisers: pending, events, publishedEvents: published });
}));

router.get('/organisers', asyncHandler(async (req, res) => {
  const list = await User.find({ role: 'organiser' }).select('name email accountStatus createdAt').sort({ createdAt: -1 }).lean();
  const counts = await Event.aggregate([{ $group: { _id: '$organiserId', n: { $sum: 1 } } }]);
  const byId = Object.fromEntries(counts.map(c => [String(c._id), c.n]));
  res.json(list.map(u => ({ ...u, accountStatus: u.accountStatus || 'approved', eventCount: byId[String(u._id)] || 0 })));
}));

router.patch('/organisers/:id', asyncHandler(async (req, res) => {
  const status = req.body.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ message: 'Status must be approved, rejected or pending.' });
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: 'organiser' }, { accountStatus: status }, { new: true }).select('name email accountStatus');
  if (!user) return res.status(404).json({ message: 'Organiser not found.' });
  if (status === 'approved') await notify(user._id, 'Your organiser account was approved. You can now create events!', '/dashboard');
  // A rejected organiser loses their events: they are cancelled, along with every booking on them.
  if (status === 'rejected') {
    const mine = await Event.find({ organiserId: user._id, status: 'published' }).select('_id');
    for (const e of mine) await cancelEvent({ _id: e._id });
  }
  res.json(user);
}));

router.get('/events', asyncHandler(async (req, res) => {
  res.json(await Event.find().populate('organiserId', 'name email').sort({ startsAt: -1 }));
}));

router.patch('/events/:id/cancel', asyncHandler(async (req, res) => {
  const event = await cancelEvent({ _id: req.params.id, status: 'published' });
  if (!event) return res.status(404).json({ message: 'Active event not found.' });
  res.json(event);
}));

router.get('/users', asyncHandler(async (req, res) => {
  res.json(await User.find().select('name email role accountStatus createdAt').sort({ createdAt: -1 }).lean());
}));

export default router;
