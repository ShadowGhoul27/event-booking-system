import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const router = Router();
const allowedInterests = ['Technology','Music','Education','Business','Sports','Arts','Other'];
const publicUser = u => ({ id: u._id, name: u.name, email: u.email, role: u.role, accountStatus: u.accountStatus || 'approved', interests: u.interests || [] });
const makeToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
router.post('/register', async (req, res) => {
  try {
    const { password, role } = req.body;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || !email || typeof password !== 'string' || !password || !['attendee', 'organiser'].includes(role)) return res.status(400).json({ message: 'Complete all fields and select a valid role.' });
    if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    if (await User.findOne({ email })) return res.status(409).json({ message: 'Email is already registered.' });
    // Names must be unique, ignoring upper/lower case ("Admin" and "admin" count as the same name).
    if (await User.findOne({ name }).collation({ locale: 'en', strength: 2 })) return res.status(409).json({ message: 'That name is already taken. Please choose a different name.' });
    const user = await User.create({ name, email, passwordHash: await bcrypt.hash(password, 12), role, accountStatus: role === 'organiser' ? 'pending' : 'approved' });
    res.status(201).json({ token: makeToken(user._id), user: publicUser(user) });
  } catch (e) {
    // Safety net: the database's unique indexes also reject duplicates if two people sign up at the same moment.
    if (e.code === 11000) return res.status(409).json({ message: e.keyPattern?.name ? 'That name is already taken. Please choose a different name.' : 'Email is already registered.' });
    res.status(500).json({ message: 'Could not create account.' });
  }
});
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) return res.status(400).json({ message: 'Enter your email and password.' });
  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ message: 'Incorrect email or password.' });
  if (user.accountStatus === 'rejected') return res.status(403).json({ message: 'Your organiser account was not approved.' });
  res.json({ token: makeToken(user._id), user: publicUser(user) });
}));
// Attendees save the categories they like; "For You" uses them.
router.put('/interests', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const list = Array.isArray(req.body.interests) ? req.body.interests : [];
  const interests = [...new Set(list)];
  if (interests.some(i => !allowedInterests.includes(i))) return res.status(400).json({ message: 'One or more interests are invalid.' });
  const user = await User.findByIdAndUpdate(req.user._id, { interests }, { new: true, runValidators: true });
  res.json({ message: 'Your interests have been saved.', user: publicUser(user) });
}));
// Change your own password.
router.put('/password', protect, asyncHandler(async (req, res) => {
  if (req.user.role === 'admin') return res.status(403).json({ message: 'The admin password is set in server/.env.' });
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') return res.status(400).json({ message: 'Enter your current and new password.' });
  if (newPassword.length < 8) return res.status(400).json({ message: 'The new password must be at least 8 characters.' });
  const user = await User.findById(req.user._id);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ message: 'Your current password is not correct.' });
  if (currentPassword === newPassword) return res.status(400).json({ message: 'Choose a password different from the current one.' });
  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  res.json({ message: 'Your password has been changed.' });
}));
router.get('/me', protect, (req, res) => res.json({ user: publicUser(req.user) }));
export default router;
