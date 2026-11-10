import crypto from 'crypto';
import Event from '../models/Event.js';
import Ticket from '../models/Ticket.js';
import { notify } from './notify.js';

export const MAX_TICKETS_PER_PERSON = 8;
export const holdMinutes = () => { const n = Number(process.env.HOLD_MINUTES); return n > 0 ? n : 10; };
export const token = () => crypto.randomBytes(16).toString('hex');
export const ticketCode = () => 'T-' + crypto.randomBytes(6).toString('hex').toUpperCase();
export const rowLetter = i => String.fromCharCode(65 + i);

// "C7" -> { row: 2, num: 7 }, or null when the label is not a seat label.
export function parseSeat(label) {
  const m = /^([A-Z])(\d{1,2})$/.exec(String(label || ''));
  return m ? { row: m[1].charCodeAt(0) - 65, num: Number(m[2]) } : null;
}
// With a seat map, tiers own consecutive blocks of rows (first tier = front rows).
export function tierForRow(event, rowIndex) {
  let start = 0;
  for (const t of event.tiers) { if (rowIndex >= start && rowIndex < start + t.rows) return t; start += t.rows; }
  return null;
}
export const onSale = (tier, now = new Date()) => !tier.saleEndsAt || tier.saleEndsAt > now;
export const isTiered = e => Array.isArray(e.tiers) && e.tiers.length > 0;

// Checks the tiers / seat map sent by an organiser. Returns { tiers, seating } or { error }.
export function cleanTicketing(body, startsAt) {
  const input = body.tiers;
  const seatingIn = body.seating || {};
  if (input === undefined || input === null || (Array.isArray(input) && input.length === 0)) {
    if (seatingIn.enabled === true || seatingIn.enabled === 'true') return { error: 'A seat map needs at least one ticket tier.' };
    return { tiers: [], seating: { enabled: false, rows: 0, seatsPerRow: 0 } };
  }
  if (!Array.isArray(input) || input.length > 6) return { error: 'Use between 1 and 6 ticket tiers.' };
  const seated = seatingIn.enabled === true || seatingIn.enabled === 'true';
  let rows = 0, seatsPerRow = 0;
  if (seated) {
    rows = Number(seatingIn.rows); seatsPerRow = Number(seatingIn.seatsPerRow);
    if (!Number.isInteger(rows) || rows < 1 || rows > 26 || !Number.isInteger(seatsPerRow) || seatsPerRow < 1 || seatsPerRow > 30) return { error: 'A seat map needs 1 to 26 rows and 1 to 30 seats per row.' };
  }
  const seen = new Set(); const tiers = []; let rowTotal = 0;
  for (const t of input) {
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    if (!name || name.length > 40) return { error: 'Every ticket tier needs a name of up to 40 characters.' };
    if (seen.has(name.toLowerCase())) return { error: 'Ticket tier names must be different.' };
    seen.add(name.toLowerCase());
    const price = Number(t.price);
    if (t.price === '' || t.price === null || t.price === undefined || !Number.isFinite(price) || price < 0 || price > 100000) return { error: `"${name}" needs a price of 0 or more.` };
    let limit, trows = 0;
    if (seated) {
      trows = Number(t.rows);
      if (!Number.isInteger(trows) || trows < 1) return { error: `"${name}" needs at least one row of the seat map.` };
      rowTotal += trows; limit = trows * seatsPerRow;
    } else {
      limit = Number(t.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100000) return { error: `"${name}" needs a ticket limit of at least 1.` };
    }
    let saleEndsAt = null;
    if (t.saleEndsAt !== undefined && t.saleEndsAt !== null && t.saleEndsAt !== '') {
      saleEndsAt = new Date(t.saleEndsAt);
      if (Number.isNaN(saleEndsAt.getTime())) return { error: `"${name}" has an invalid sale end date.` };
      if (startsAt && saleEndsAt > new Date(startsAt)) return { error: `"${name}" must stop selling before the event starts.` };
    }
    const clean = { name, price: Math.round(price * 100) / 100, limit, rows: trows, saleEndsAt };
    if (t._id) clean._id = t._id;
    tiers.push(clean);
  }
  if (seated && rowTotal !== rows) return { error: `The tiers must cover all ${rows} rows of the seat map (they cover ${rowTotal}).` };
  return { tiers, seating: { enabled: seated, rows, seatsPerRow } };
}

// Gives a held ticket's place back to its tier. Returns true when this call released it.
export async function releaseTicket(ticket, { onlyExpired = false } = {}) {
  const filter = { _id: ticket._id, status: 'held' };
  if (onlyExpired) filter.holdExpiresAt = { $lte: new Date() };
  const gone = await Ticket.findOneAndDelete(filter);
  if (!gone) return false;
  await Event.updateOne({ _id: gone.eventId, 'tiers._id': gone.tierId }, { $inc: { 'tiers.$.left': 1, seatsBooked: -1 } });
  return true;
}
// Releases every hold that ran out of time (for one event, or for all events).
export async function releaseExpiredHolds(eventId) {
  const filter = { status: 'held', holdExpiresAt: { $lte: new Date() } };
  if (eventId) filter.eventId = eventId;
  const list = await Ticket.find(filter).select('_id');
  let n = 0;
  for (const t of list) if (await releaseTicket(t, { onlyExpired: true })) n++;
  return n;
}

const luhn = num => { let sum = 0, alt = false; for (let i = num.length - 1; i >= 0; i--) { let d = Number(num[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; };
// Simulated card payment. No real money moves. 4242 4242 4242 4242 works; a card ending 0002 is declined.
export function simulateCharge(card, amount) {
  const number = String((card && card.number) || '').replace(/[\s-]/g, '');
  const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(String((card && card.expiry) || '').trim());
  if (!/^\d{12,19}$/.test(number) || !luhn(number)) return { ok: false, status: 400, message: 'That card number is not valid.' };
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 12) return { ok: false, status: 400, message: 'Enter the card expiry as MM/YY.' };
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  const now = new Date();
  if (year < now.getFullYear() || (year === now.getFullYear() && Number(m[1]) < now.getMonth() + 1)) return { ok: false, status: 400, message: 'That card has expired.' };
  if (!/^\d{3,4}$/.test(String((card && card.cvc) || ''))) return { ok: false, status: 400, message: 'Enter the 3 or 4 digit security code.' };
  if (number.endsWith('0002')) return { ok: false, status: 402, message: 'The card was declined. Try another card.' };
  return { ok: true, ref: 'SIM-' + crypto.randomBytes(5).toString('hex').toUpperCase(), amount };
}

// Background clean-up so held seats come back even when nobody is looking at the event.
export function startHoldCleaner() {
  const timer = setInterval(() => { releaseExpiredHolds().catch(e => console.error('Hold cleanup failed:', e.message)); }, 15000);
  timer.unref?.();
  return timer;
}
export { notify };
