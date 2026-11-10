import { Router } from 'express';
import Event from '../models/Event.js';
import Booking from '../models/Booking.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { promoteWaitlist } from '../utils/seats.js';
import { cancelEvent } from '../utils/cancelEvent.js';
import { notify } from '../utils/notify.js';
import mongoose from 'mongoose';
import Ticket from '../models/Ticket.js';
import { cleanTicketing, isTiered } from '../utils/ticketing.js';
const router = Router();
const fields = ['title','description','venue','startsAt','endsAt','capacity','category','imageUrl','offersCertificate'];
const own = req => (req.user.role === 'admin' ? {} : { organiserId: req.user._id });
const asBool = v => v === true || v === 'true';
const validDate = v => v !== undefined && v !== null && v !== '' && !Number.isNaN(new Date(v).getTime());
router.get('/', asyncHandler(async (req, res) => {
  if ((req.query.from && !validDate(req.query.from)) || (req.query.to && !validDate(req.query.to))) return res.status(400).json({ message: 'Invalid date filter.' });
  const filter = { status: 'published' };
  if (req.query.category && req.query.category !== 'All') filter.category = req.query.category;
  if (req.query.from || req.query.to) filter.startsAt = { ...(req.query.from ? { $gte: new Date(req.query.from) } : {}), ...(req.query.to ? { $lte: new Date(req.query.to) } : {}) };

  if (!req.query.from && !req.query.to && req.query.past !== '1') filter.endsAt = { $gte: new Date() };
  const events = await Event.find(filter).populate('organiserId', 'name').sort({ startsAt: 1 });
  res.json(events);
}));
router.get('/mine', protect, allow('organiser'), asyncHandler(async (req, res) => {
  res.json(await Event.find({ organiserId: req.user._id }).sort({ createdAt: -1 }));
}));
router.get('/mine/stats', protect, allow('organiser'), asyncHandler(async (req, res) => {
  let tz = 'UTC';
  try { if (req.query.tz) { new Intl.DateTimeFormat('en', { timeZone: String(req.query.tz) }); tz = String(req.query.tz); } } catch { tz = 'UTC'; }
  const events = await Event.find({ organiserId: req.user._id }).select('_id capacity status');
  const ids = events.map(e => e._id);
  const rows = await Booking.aggregate([
    { $match: { eventId: { $in: ids } } },
    { $group: { _id: { eventId: '$eventId', status: '$status' }, n: { $sum: 1 }, checkedIn: { $sum: { $cond: [{ $ne: ['$checkedInAt', null] }, 1, 0] } } } }
  ]);
  const ticketRows = await Ticket.aggregate([
    { $match: { eventId: { $in: ids }, status: { $in: ['confirmed', 'cancelled'] } } },
    { $group: { _id: { eventId: '$eventId', status: '$status' }, n: { $sum: 1 }, checkedIn: { $sum: { $cond: [{ $ne: ['$checkedInAt', null] }, 1, 0] } }, revenue: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, '$paidAmount', 0] } } } }
  ]);
  const perEvent = {};
  const totals = { events: events.length, confirmed: 0, waitlisted: 0, cancelled: 0, checkedIn: 0, revenue: 0 };
  for (const r of [...rows, ...ticketRows]) {
    const key = String(r._id.eventId);
    perEvent[key] = perEvent[key] || { confirmed: 0, waitlisted: 0, cancelled: 0, checkedIn: 0, revenue: 0 };
    perEvent[key][r._id.status] += r.n; perEvent[key].checkedIn += r.checkedIn;
    totals[r._id.status] += r.n; totals.checkedIn += r.checkedIn;
    if (r.revenue) { perEvent[key].revenue += r.revenue; totals.revenue += r.revenue; }
  }
  totals.revenue = Math.round(totals.revenue * 100) / 100;
  const open = events.filter(e => e.status === 'published');
  const capacity = open.reduce((s, e) => s + e.capacity, 0);
  const seated = open.reduce((s, e) => s + (perEvent[String(e._id)]?.confirmed || 0), 0);
  totals.fillRate = capacity ? Math.round((seated / capacity) * 100) : 0;
  const since = new Date(Date.now() - 14 * 864e5);
  const perDay = await Booking.aggregate([
    { $match: { eventId: { $in: ids }, createdAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }, n: { $sum: 1 } } }
  ]);
  const perDayTickets = await Ticket.aggregate([
    { $match: { eventId: { $in: ids }, status: 'confirmed', paidAt: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: tz } }, n: { $sum: 1 } } }
  ]);
  const map = {};
  for (const d of [...perDay, ...perDayTickets]) map[d._id] = (map[d._id] || 0) + d.n;
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const daily = [];
  for (let i = 13; i >= 0; i--) { const d = fmt.format(new Date(Date.now() - i * 864e5)); daily.push({ date: d, count: map[d] || 0 }); }
  res.json({ totals, perEvent, daily });
}));st.
router.get('/recommended', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const interests = req.user.interests || [];
  const wanted = new Set(interests.map(i => i.toLowerCase()));
  const mine = await Booking.find({ userId: req.user._id, status: { $in: ['confirmed', 'waitlisted'] } }).select('eventId');
  const events = await Event.find({
    status: 'published',
    startsAt: { $gt: new Date() },
    $expr: { $lt: ['$seatsBooked', '$capacity'] },
    _id: { $nin: mine.map(b => b.eventId) }
  }).populate('organiserId', 'name').sort({ startsAt: 1 });
  const scored = events.map(e => {
    const match = wanted.has(String(e.category || '').toLowerCase());
    return { ...e.toObject(), matchScore: match ? 100 : 0, matchReason: match ? `Matches your interest in ${e.category}` : 'You may also be interested in this upcoming event' };
  });
  scored.sort((a, b) => b.matchScore - a.matchScore);
  res.json({ interests, recommendations: scored.slice(0, 9) });
}));
router.get('/:id', asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, status: 'published' }).populate('organiserId', 'name');
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json(event);
}));
router.post('/', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const data = Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const venue = typeof data.venue === 'string' ? data.venue.trim() : '';
  const ticketing = cleanTicketing(req.body, data.startsAt);
  if (ticketing.error) return res.status(400).json({ message: ticketing.error });
  const ticketed = ticketing.tiers.length > 0;
  const capacity = ticketed ? ticketing.tiers.reduce((sum, t) => sum + t.limit, 0) : Number(data.capacity);
  if (!title || !venue || !validDate(data.startsAt) || !validDate(data.endsAt) || !Number.isInteger(capacity) || capacity < 1 || new Date(data.endsAt) <= new Date(data.startsAt)) return res.status(400).json({ message: 'Enter valid event details, dates, and capacity.' });
  const repeat = req.body.repeatWeeks === undefined || req.body.repeatWeeks === '' ? 0 : Number(req.body.repeatWeeks);
  if (!Number.isInteger(repeat) || repeat < 0 || repeat > 12) return res.status(400).json({ message: 'Repeat weeks must be a whole number from 0 to 12.' });
  try {
    const week = 7 * 864e5;
    const docs = [];
    const extra = ticketed ? { seating: ticketing.seating, tiers: ticketing.tiers.map(t => ({ name: t.name, price: t.price, limit: t.limit, left: t.limit, rows: t.rows, saleEndsAt: t.saleEndsAt })) } : {};
    if (data.offersCertificate !== undefined) data.offersCertificate = asBool(data.offersCertificate);
    for (let i = 0; i <= repeat; i++) docs.push({ ...data, ...extra, title, venue, organiserId: req.user._id, capacity, startsAt: new Date(new Date(data.startsAt).getTime() + i * week), endsAt: new Date(new Date(data.endsAt).getTime() + i * week) });
    const created = await Event.insertMany(docs);
    res.status(201).json(Object.assign(created[0].toObject(), { createdCount: created.length }));
  } catch { res.status(400).json({ message: 'Could not create event. Check your details.' }); }
}));
router.put('/:id', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  if (event.status === 'cancelled') return res.status(400).json({ message: 'A cancelled event cannot be edited.' });
  const updates = Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]]));
  if (updates.offersCertificate !== undefined) updates.offersCertificate = asBool(updates.offersCertificate);
  if (updates.title !== undefined) { updates.title = String(updates.title).trim(); if (!updates.title) return res.status(400).json({ message: 'Title cannot be empty.' }); }
  if (updates.venue !== undefined) { updates.venue = String(updates.venue).trim(); if (!updates.venue) return res.status(400).json({ message: 'Venue cannot be empty.' }); }
  if (isTiered(event)) delete updates.capacity;
  if (updates.capacity !== undefined) {
    updates.capacity = Number(updates.capacity);
    if (!Number.isInteger(updates.capacity) || updates.capacity < 1) return res.status(400).json({ message: 'Capacity must be a whole number of at least 1.' });
  }
  const start = updates.startsAt !== undefined ? updates.startsAt : event.startsAt;
  const end = updates.endsAt !== undefined ? updates.endsAt : event.endsAt;
  if (!validDate(start) || !validDate(end) || new Date(end) <= new Date(start)) return res.status(400).json({ message: 'The end time must be after the start time.' });
  const filter = { _id: event._id, status: 'published' };
  if (updates.capacity !== undefined) filter.seatsBooked = { $lte: updates.capacity };
  if (req.body.tiers !== undefined || req.body.seating !== undefined) {
    const t = cleanTicketing({ tiers: req.body.tiers !== undefined ? req.body.tiers : event.tiers.map(x => x.toObject()), seating: req.body.seating !== undefined ? req.body.seating : event.seating }, start);
    if (t.error) return res.status(400).json({ message: t.error });
    const activeTickets = await Ticket.countDocuments({ eventId: event._id, active: true });
    if (!isTiered(event) && t.tiers.length) {
      if (event.seatsBooked > 0 || await Booking.exists({ eventId: event._id, status: { $in: ['confirmed', 'waitlisted'] } })) return res.status(400).json({ message: 'Ticket tiers cannot be added to an event that already has bookings.' });
    }
    if (activeTickets > 0) {
      const same = t.tiers.length === event.tiers.length && t.tiers.every(n => event.tiers.id(n._id)) && t.seating.enabled === event.seating.enabled && t.seating.rows === event.seating.rows && t.seating.seatsPerRow === event.seating.seatsPerRow;
      if (!same || t.tiers.some(n => n.rows !== event.tiers.id(n._id).rows)) return res.status(400).json({ message: 'Tickets are already held or sold, so tiers cannot be added or removed and the seat map cannot change. You can still change names, prices, sale dates and limits.' });
      for (const n of t.tiers) {
        const old = event.tiers.id(n._id);
        n.left = n.limit - (old.limit - old.left);
        if (n.left < 0) return res.status(400).json({ message: `"${n.name}" already has ${old.limit - old.left} tickets sold or held, so its limit cannot be lower than that.` });
      }
    } else t.tiers.forEach(n => { delete n._id; n.left = n.limit; });
    updates.tiers = t.tiers; updates.seating = t.seating;
    updates.capacity = t.tiers.reduce((s, x) => s + x.limit, 0);
    delete filter.seatsBooked;
    filter.seatsBooked = event.seatsBooked;
  }
  const saved = await Event.findOneAndUpdate(filter, updates, { new: true, runValidators: true });
  if (!saved) return res.status(400).json({ message: req.body.tiers !== undefined ? 'A ticket was just booked. Please try saving again.' : 'Capacity cannot be lower than confirmed bookings.' });
  if (updates.capacity !== undefined && updates.capacity > event.capacity) await promoteWaitlist(event._id);
  res.json(await Event.findById(event._id));
}));
router.patch('/:id/cancel', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await cancelEvent({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json(event);
}));
const ticketRow = t => ({ _id: t._id, userId: t.ownerId, status: 'confirmed', createdAt: t.paidAt || t.createdAt, checkedInAt: t.checkedInAt, ticket: true, tierName: t.tierName, seat: t.seat, code: t.code, price: t.price });
async function everyone(eventId) {
  const [b, t] = await Promise.all([
    Booking.find({ eventId }).populate('userId', 'name email').sort({ createdAt: 1 }),
    Ticket.find({ eventId, status: 'confirmed' }).populate('ownerId', 'name email').sort({ paidAt: 1 })
  ]);
  return [...b, ...t.map(ticketRow)].sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
}
router.get('/:id/attendees', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json(await everyone(event._id));
}));
router.get('/:id/live', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const [bt, bc, tt, tc] = await Promise.all([
    Booking.countDocuments({ eventId: event._id, status: 'confirmed' }), Booking.countDocuments({ eventId: event._id, status: 'confirmed', checkedInAt: { $ne: null } }),
    Ticket.countDocuments({ eventId: event._id, status: 'confirmed' }), Ticket.countDocuments({ eventId: event._id, status: 'confirmed', checkedInAt: { $ne: null } })
  ]);
  res.json({ checkedIn: bc + tc, total: bt + tt, capacity: event.capacity, updatedAt: new Date() });
}));
const csvCell = v => {
  let t = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
};
router.get('/:id/attendees.csv', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const list = await everyone(event._id);
  const lines = [['Name', 'Email', 'Status', 'Booked at', 'Checked in at', 'Ticket code', 'Ticket type', 'Seat'].map(csvCell).join(',')];
  for (const b of list) lines.push([b.userId?.name, b.userId?.email, b.status, new Date(b.createdAt).toISOString(), b.checkedInAt ? b.checkedInAt.toISOString() : '', b.ticket ? b.code : b._id, b.tierName || '', b.seat || ''].map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send('\uFEFF' + lines.join('\r\n') + '\r\n');
}));
router.patch('/:id/checkin/:bookingId', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOne({ _id: req.params.id, ...own(req) });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  const idOrCode = String(req.params.bookingId);
  const validId = mongoose.isValidObjectId(idOrCode);
  const checkedIn = req.body.checkedIn !== false;
  const done = (updated, name) => res.json({ message: checkedIn ? `Checked in: ${name}` : 'Check-in undone.', booking: updated });
  if (validId) {
    const base = { _id: idOrCode, eventId: event._id, status: 'confirmed' };
    const updated = await Booking.findOneAndUpdate(checkedIn ? { ...base, checkedInAt: null } : base, { checkedInAt: checkedIn ? new Date() : null }, { new: true }).populate('userId', 'name email');
    if (updated) return done(updated, updated.userId?.name);
    const found = await Booking.findOne(base).populate('userId', 'name');
    if (found && checkedIn) return res.status(409).json({ message: `${found.userId?.name} is already checked in.` });
    if (found) return res.status(404).json({ message: 'No confirmed ticket with that code for this event.' });
  }
  const tbase = { eventId: event._id, status: 'confirmed', $or: [{ code: idOrCode.toUpperCase() }, ...(validId ? [{ _id: idOrCode }] : [])] };
  const tu = await Ticket.findOneAndUpdate(checkedIn ? { ...tbase, checkedInAt: null } : tbase, { checkedInAt: checkedIn ? new Date() : null }, { new: true }).populate('ownerId', 'name email');
  if (tu) return done(ticketRow(tu), tu.ownerId?.name);
  const tf = await Ticket.findOne(tbase).populate('ownerId', 'name');
  if (tf && checkedIn) return res.status(409).json({ message: `${tf.ownerId?.name} is already checked in.` });
  res.status(404).json({ message: 'No confirmed ticket with that code for this event.' });
}));
router.post('/:id/announcements', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 500) return res.status(400).json({ message: 'Write an announcement of 1 to 500 characters.' });
  const event = await Event.findOneAndUpdate({ _id: req.params.id, ...own(req), status: 'published' }, { $push: { announcements: { message } } }, { new: true });
  if (!event) return res.status(404).json({ message: 'Event not found or already cancelled.' });
  const people = await Booking.find({ eventId: event._id, status: { $in: ['confirmed', 'waitlisted'] } }).select('userId');
  await notify(people.map(b => b.userId), `New update for "${event.title}": ${message.length > 80 ? message.slice(0, 77) + '...' : message}`, '/events/' + event._id);
  res.status(201).json(event.announcements);
}));
router.delete('/:id/announcements/:announcementId', protect, allow('organiser', 'admin'), asyncHandler(async (req, res) => {
  const event = await Event.findOneAndUpdate({ _id: req.params.id, ...own(req) }, { $pull: { announcements: { _id: req.params.announcementId } } }, { new: true });
  if (!event) return res.status(404).json({ message: 'Event not found.' });
  res.json(event.announcements);
}));
export default router;
