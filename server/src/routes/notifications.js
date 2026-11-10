import { Router } from 'express';
import Notification from '../models/Notification.js';
import { protect } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const router = Router();
router.use(protect);
router.get('/', asyncHandler(async (req, res) => {
  const [items, unread] = await Promise.all([
    Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(30),
    Notification.countDocuments({ userId: req.user._id, readAt: null })
  ]);
  res.json({ unread, items });
}));
router.post('/read-all', asyncHandler(async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ unread: 0 });
}));
router.patch('/:id/read', asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, userId: req.user._id, readAt: null }, { readAt: new Date() });
  res.json({ ok: true });
}));
export default router;
