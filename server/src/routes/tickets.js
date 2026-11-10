import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notify } from '../utils/notify.js';
import { MAX_TICKETS_PER_PERSON, holdMinutes, token, ticketCode, parseSeat, tierForRow, onSale, releaseTicket, releaseExpiredHolds, simulateCharge } from '../utils/ticketing.js';
const router = Router();
const bad = (res, status, message) => res.status(status).json({ message });
const money = n => (Math.round(n * 100) / 100).toFixed(2);
const eventBrief = 'title venue startsAt endsAt status offersCertificate seating';

// ---------- public: what is still available (seat map + tiers) ----------
router.get('/event/:eventId/availability', asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) return bad(res, 404, 'Event not found.');
  await releaseExpiredHolds(req.params.eventId);
  const event = await Event.findOne({ _id: req.params.eventId, status: 'published' });
  if (!event) return bad(res, 404, 'Event not found.');
  const now = new Date();
  const taken = event.seating?.enabled ? (await Ticket.find({ eventId: event._id, active: true, seat: { $type: 'string' } }).select('seat')).map(t => t.seat) : [];
  res.json({
    eventId: event._id, seating: event.seating, holdMinutes: holdMinutes(), serverTime: now,
    tiers: event.tiers.map(t => ({ _id: t._id, name: t.name, price: t.price, limit: t.limit, left: t.left, rows: t.rows, saleEndsAt: t.saleEndsAt, onSale: onSale(t, now) })),
    taken
  });
}));

// ---------- schedule conflicts: other events the person already has at the same time ----------
export async function findConflicts(userId, event) {
  const others = await Event.find({ _id: { $ne: event._id }, status: 'published', startsAt: { $lt: event.endsAt }, endsAt: { $gt: event.startsAt } }).select('title startsAt endsAt venue');
  if (!others.length) return [];
  const ids = others.map(e => e._id);
  const [b, t] = await Promise.all([
    Booking.find({ userId, eventId: { $in: ids }, status: 'confirmed' }).select('eventId'),
    Ticket.find({ ownerId: userId, eventId: { $in: ids }, status: { $in: ['confirmed', 'held'] } }).select('eventId')
  ]);
  const busy = new Set([...b, ...t].map(x => String(x.eventId)));
  return others.filter(e => busy.has(String(e._id)));
}
router.get('/conflicts/:eventId', protect, allow('attendee'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) return bad(res, 404, 'Event not found.');
  const event = await Event.findOne({ _id: req.params.eventId, status: 'published' });
  if (!event) return bad(res, 404, 'Event not found.');
  res.json({ conflicts: await findConflicts(req.user._id, event) });
}));

// ---------- hold seats / tickets ----------
// Body: { seats: ["A1","A2"] } for a seat-map event, or { tierId, quantity } for general admission.
router.post('/event/:eventId/hold', protect, allow('attendee'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.eventId)) return bad(res, 404, 'Event is unavailable.');
  await releaseExpiredHolds(req.params.eventId);
  const event = await Event.findOne({ _id: req.params.eventId, status: 'published' });
  if (!event) return bad(res, 404, 'Event is unavailable.');
  if (!event.tiers.length) return bad(res, 400, 'This event does not sell tickets. Use the normal booking button.');
  if (event.startsAt <= new Date()) return bad(res, 400, 'This event has already started.');
  // Work out exactly which tickets are wanted.
  const wanted = [];
  if (event.seating.enabled) {
    const seats = req.body.seats;
    if (!Array.isArray(seats) || !seats.length) return bad(res, 400, 'Pick at least one seat.');
    if (new Set(seats).size !== seats.length) return bad(res, 400, 'Each seat can only be picked once.');
    for (const label of seats) {
      const p = parseSeat(label);
      if (!p || p.row >= event.seating.rows || p.num < 1 || p.num > event.seating.seatsPerRow) return bad(res, 400, `Seat ${String(label).slice(0, 8)} does not exist.`);
      wanted.push({ tier: tierForRow(event, p.row), seat: label });
    }
  } else {
    const tier = event.tiers.id(req.body.tierId);
    const qty = Number(req.body.quantity);
    if (!tier) return bad(res, 400, 'Choose a ticket type.');
    if (!Number.isInteger(qty) || qty < 1) return bad(res, 400, 'Choose how many tickets you want.');
    for (let i = 0; i < qty; i++) wanted.push({ tier, seat: null });
  }
  if (wanted.length > MAX_TICKETS_PER_PERSON) return bad(res, 400, `You can hold up to ${MAX_TICKETS_PER_PERSON} tickets at a time.`);
  const already = await Ticket.countDocuments({ eventId: event._id, ownerId: req.user._id, active: true });
  if (already + wanted.length > MAX_TICKETS_PER_PERSON) return bad(res, 400, `You can have up to ${MAX_TICKETS_PER_PERSON} tickets for one event.`);

  // 1. Take the places from the tiers. Each step is one atomic update, so the last ticket can never be sold twice.
  const groups = new Map();
  for (const w of wanted) groups.set(String(w.tier._id), { tier: w.tier, n: (groups.get(String(w.tier._id))?.n || 0) + 1 });
  const taken = [];
  const putBack = async () => { for (const g of taken) await Event.updateOne({ _id: event._id, 'tiers._id': g.tier._id }, { $inc: { 'tiers.$.left': g.n, seatsBooked: -g.n } }); };
  for (const g of groups.values()) {
    const now = new Date();
    const ok = await Event.findOneAndUpdate(
      { _id: event._id, status: 'published', tiers: { $elemMatch: { _id: g.tier._id, left: { $gte: g.n }, $or: [{ saleEndsAt: null }, { saleEndsAt: { $gt: now } }] } } },
      { $inc: { 'tiers.$.left': -g.n, seatsBooked: g.n } }
    );
    if (!ok) {
      await putBack();
      const fresh = await Event.findById(event._id);
      const t = fresh?.tiers.id(g.tier._id);
      if (t && !onSale(t)) return bad(res, 409, `"${t.name}" tickets are no longer on sale.`);
      return bad(res, 409, `Not enough "${g.tier.name}" tickets left.`);
    }
    taken.push(g);
  }
  // 2. Create the tickets. The unique seat index refuses a seat somebody else already holds.
  const expires = new Date(Date.now() + holdMinutes() * 60000);
  const created = [];
  try {
    for (const w of wanted) created.push(await Ticket.create({ eventId: event._id, ownerId: req.user._id, tierId: w.tier._id, tierName: w.tier.name, price: w.tier.price, seat: w.seat, status: 'held', holdExpiresAt: expires, payToken: token(), code: ticketCode() }));
  } catch (e) {
    await Ticket.deleteMany({ _id: { $in: created.map(t => t._id) } });
    await putBack();
    if (e.code === 11000) return bad(res, 409, 'Someone just took one of those seats. Please pick again.');
    throw e;
  }
  res.status(201).json({ tickets: created, expiresAt: expires, total: Math.round(created.reduce((s, t) => s + t.price, 0) * 100) / 100, conflicts: await findConflicts(req.user._id, event) });
}));

// ---------- the attendee's own tickets ----------
router.get('/mine', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const mineHeld = await Ticket.find({ ownerId: req.user._id, status: 'held', holdExpiresAt: { $lte: new Date() } }).select('_id');
  for (const t of mineHeld) await releaseTicket(t, { onlyExpired: true });
  const list = await Ticket.find({ ownerId: req.user._id }).populate('eventId', eventBrief).sort({ createdAt: -1 });
  const now = new Date();
  res.json(list.map(t => {
    const o = t.toObject();
    o.canCertificate = !!(t.status === 'confirmed' && t.checkedInAt && t.eventId?.offersCertificate && t.eventId.status === 'published' && t.eventId.endsAt <= now);
    return o;
  }));
}));
router.delete('/:id/hold', protect, allow('attendee'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Held ticket not found.');
  const t = await Ticket.findOne({ _id: req.params.id, ownerId: req.user._id, status: 'held' });
  if (!t || !(await releaseTicket(t))) return bad(res, 404, 'Held ticket not found.');
  res.json({ message: 'Seat released.' });
}));

// ---------- payment (simulated: no real money is moved) ----------
async function confirmTickets(tickets, payerId, card) {
  const total = Math.round(tickets.reduce((s, t) => s + t.price, 0) * 100) / 100;
  let ref = 'FREE';
  if (total > 0) {
    const charge = simulateCharge(card, total);
    if (!charge.ok) return { error: charge };
    ref = charge.ref;
  }
  const done = [];
  for (const t of tickets) {
    // Only works while the hold is still running, so a seat that was already given away cannot be paid for.
    const c = await Ticket.findOneAndUpdate({ _id: t._id, status: 'held', holdExpiresAt: { $gt: new Date() } }, { status: 'confirmed', ownerId: payerId, holdExpiresAt: null, paidAt: new Date(), paidAmount: t.price, paymentRef: ref }, { new: true });
    if (!c) {
      // Undo the ones already confirmed in this request, so nobody is charged for a partial order.
      for (const d of done) await Ticket.updateOne({ _id: d._id, status: 'confirmed' }, { status: 'held', ownerId: d.prevOwner, holdExpiresAt: d.hold, paidAt: null, paidAmount: 0, paymentRef: '' });
      return { error: { ok: false, status: 410, message: 'Your hold ran out before the payment went through. You were not charged.' } };
    }
    done.push({ _id: t._id, prevOwner: t.ownerId, hold: t.holdExpiresAt, doc: c });
  }
  return { total, ref, tickets: done.map(d => d.doc) };
}
// Pay for your own held tickets. Body: { ticketIds: [...], card: { number, expiry, cvc } }
router.post('/pay', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ticketIds) ? [...new Set(req.body.ticketIds.map(String))] : [];
  if (!ids.length || ids.length > MAX_TICKETS_PER_PERSON || !ids.every(i => mongoose.isValidObjectId(i))) return bad(res, 400, 'Choose which held tickets to pay for.');
  const tickets = await Ticket.find({ _id: { $in: ids }, ownerId: req.user._id, status: 'held' });
  if (tickets.length !== ids.length) return bad(res, 404, 'Some of these tickets are no longer held for you.');
  if (tickets.some(t => t.holdExpiresAt <= new Date())) { for (const t of tickets) await releaseTicket(t, { onlyExpired: true }); return bad(res, 410, 'Your hold ran out and the seats were released. Please pick again.'); }
  const r = await confirmTickets(tickets, req.user._id, req.body.card);
  if (r.error) return bad(res, r.error.status, r.error.message);
  res.json({ message: r.total > 0 ? `Payment of ${money(r.total)} received (simulated). Your tickets are confirmed.` : 'Your tickets are confirmed.', total: r.total, paymentRef: r.ref, tickets: r.tickets });
}));
// Group booking: the link of one held ticket. Anyone with the link can see it and, when logged in, pay for it.
router.get('/pay/:token', asyncHandler(async (req, res) => {
  const t = await Ticket.findOne({ payToken: String(req.params.token) }).populate('eventId', eventBrief).populate('ownerId', 'name');
  if (!t) return bad(res, 404, 'This payment link is not valid.');
  if (t.status === 'held' && t.holdExpiresAt <= new Date()) { await releaseTicket(t, { onlyExpired: true }); return bad(res, 410, 'This payment link has expired. The seat was released.'); }
  res.json({ status: t.status, tierName: t.tierName, price: t.price, seat: t.seat, holdExpiresAt: t.holdExpiresAt, event: t.eventId && { _id: t.eventId._id, title: t.eventId.title, venue: t.eventId.venue, startsAt: t.eventId.startsAt, endsAt: t.eventId.endsAt }, requestedBy: t.status === 'held' ? t.ownerId?.name : undefined });
}));
router.post('/pay/:token', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const t = await Ticket.findOne({ payToken: String(req.params.token) });
  if (!t) return bad(res, 404, 'This payment link is not valid.');
  if (t.status === 'confirmed') return bad(res, 409, 'This ticket has already been paid.');
  if (t.status !== 'held') return bad(res, 410, 'This payment link is no longer valid.');
  if (t.holdExpiresAt <= new Date()) { await releaseTicket(t, { onlyExpired: true }); return bad(res, 410, 'This payment link has expired. The seat was released.'); }
  const event = await Event.findOne({ _id: t.eventId, status: 'published' }).select('title');
  if (!event) return bad(res, 404, 'This event is unavailable.');
  const booker = t.ownerId;
  const r = await confirmTickets([t], req.user._id, req.body.card);
  if (r.error) return bad(res, r.error.status, r.error.message);
  if (String(booker) !== String(req.user._id)) await notify(booker, `${req.user.name} paid for their ${t.tierName} ticket${t.seat ? ' (seat ' + t.seat + ')' : ''} to "${event.title}".`, '/my-bookings');
  res.json({ message: r.total > 0 ? `Payment of ${money(r.total)} received (simulated). The ticket is yours.` : 'The ticket is yours.', ticket: r.tickets[0] });
}));

// ---------- transfer to a friend (by the email of their account) ----------
router.post('/:id/transfer', protect, allow('attendee'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Ticket not found.');
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) return bad(res, 400, 'Enter your friend\u2019s email.');
  if (email === req.user.email) return bad(res, 400, 'You cannot send a ticket to yourself.');
  const friend = await User.findOne({ email, role: 'attendee' });
  if (!friend) return bad(res, 404, 'No attendee account uses that email. Your friend needs to sign up first.');
  const t = await Ticket.findOne({ _id: req.params.id, ownerId: req.user._id, status: 'confirmed' }).populate('eventId', 'title startsAt status');
  if (!t || t.eventId?.status !== 'published') return bad(res, 404, 'Ticket not found.');
  if (t.checkedInAt) return bad(res, 400, 'This ticket was already used.');
  if (t.eventId.startsAt <= new Date()) return bad(res, 400, 'This event has already started.');
  // One atomic update, so a ticket cannot be sent twice. A new code makes the old QR code useless.
  const moved = await Ticket.findOneAndUpdate({ _id: t._id, ownerId: req.user._id, status: 'confirmed', checkedInAt: null }, { ownerId: friend._id, code: ticketCode(), transferredFrom: req.user._id }, { new: true });
  if (!moved) return bad(res, 409, 'This ticket can no longer be sent.');
  await notify(friend._id, `${req.user.name} sent you a ticket to "${t.eventId.title}"${t.seat ? ' (seat ' + t.seat + ')' : ''}.`, '/my-bookings');
  await notify(req.user._id, `You sent your ticket to "${t.eventId.title}" to ${friend.name}.`, '/my-bookings');
  res.json({ message: `Ticket sent to ${friend.name}.`, ticket: moved });
}));

// ---------- cancel a paid ticket (refund is recorded, nothing real is refunded) ----------
router.patch('/:id/cancel', protect, allow('attendee'), asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return bad(res, 404, 'Ticket not found.');
  const t = await Ticket.findOne({ _id: req.params.id, ownerId: req.user._id, status: 'confirmed' }).populate('eventId', 'startsAt status');
  if (!t || t.eventId?.status !== 'published') return bad(res, 404, 'Ticket not found.');
  if (t.checkedInAt) return bad(res, 400, 'This ticket was already used.');
  if (t.eventId.startsAt <= new Date()) return bad(res, 400, 'This event has already started.');
  const gone = await Ticket.findOneAndUpdate({ _id: t._id, ownerId: req.user._id, status: 'confirmed', checkedInAt: null }, { status: 'cancelled', active: false, refunded: t.paidAmount > 0 });
  if (!gone) return bad(res, 409, 'This ticket can no longer be cancelled.');
  await Event.updateOne({ _id: t.eventId._id, 'tiers._id': t.tierId }, { $inc: { 'tiers.$.left': 1, seatsBooked: -1 } });
  res.json({ message: t.paidAmount > 0 ? `Ticket cancelled. ${money(t.paidAmount)} will be refunded (simulated).` : 'Ticket cancelled.' });
}));
export default router;
