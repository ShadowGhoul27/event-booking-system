import { Router } from 'express';
import mongoose from 'mongoose';
import PDFDocument from 'pdfkit';
import { createRequire } from 'module';
import path from 'path';
import Booking from '../models/Booking.js';
import Ticket from '../models/Ticket.js';
import { protect, allow } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const router = Router();
const require = createRequire(import.meta.url);
const fontDir = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const font = n => path.join(fontDir, n);
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// A certificate of attendance is made for attendees who were checked in at an event that offers certificates and has ended.
router.get('/:kind/:id', protect, allow('attendee'), asyncHandler(async (req, res) => {
  const { kind, id } = req.params;
  if (!['booking', 'ticket'].includes(kind) || !mongoose.isValidObjectId(id)) return res.status(404).json({ message: 'Certificate not found.' });
  const pop = { path: 'eventId', populate: { path: 'organiserId', select: 'name' } };
  const item = kind === 'booking'
    ? await Booking.findOne({ _id: id, userId: req.user._id, status: 'confirmed' }).populate(pop)
    : await Ticket.findOne({ _id: id, ownerId: req.user._id, status: 'confirmed' }).populate(pop);
  const event = item?.eventId;
  if (!item || !event || event.status !== 'published') return res.status(404).json({ message: 'Certificate not found.' });
  if (!event.offersCertificate) return res.status(403).json({ message: 'This event does not issue certificates.' });
  if (!item.checkedInAt) return res.status(403).json({ message: 'Certificates are for attendees who were checked in at the event.' });
  if (event.endsAt > new Date()) return res.status(403).json({ message: 'Your certificate will be ready when the event has ended.' });

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0, info: { Title: 'Certificate of attendance', Author: 'Evently' } });
  res.setHeader('Content-Type', 'application/pdf');
  const safe = String(event.title).replace(/[^\w\- ]+/g, '').trim().slice(0, 50) || 'event';
  res.setHeader('Content-Disposition', `attachment; filename="certificate-${safe.replace(/ +/g, '-')}.pdf"`);
  doc.pipe(res);
  const W = doc.page.width, H = doc.page.height, ink = '#1f2a44', gold = '#b08d3c';
  doc.rect(28, 28, W - 56, H - 56).lineWidth(3).stroke(gold);
  doc.rect(40, 40, W - 80, H - 80).lineWidth(1).stroke(ink);
  doc.fillColor(gold).font(font('DejaVuSans-Bold.ttf')).fontSize(14).text('EVENTLY', 0, 80, { width: W, align: 'center', characterSpacing: 6 });
  doc.fillColor(ink).font(font('DejaVuSerif-Bold.ttf')).fontSize(40).text('Certificate of Attendance', 0, 115, { width: W, align: 'center' });
  doc.font(font('DejaVuSerif.ttf')).fontSize(16).fillColor('#555').text('This certifies that', 0, 195, { width: W, align: 'center' });
  doc.font(font('DejaVuSerif-BoldItalic.ttf')).fontSize(38).fillColor(ink).text(req.user.name, 60, 225, { width: W - 120, align: 'center', lineBreak: false, ellipsis: true });
  doc.moveTo(W / 2 - 170, 280).lineTo(W / 2 + 170, 280).lineWidth(1).stroke(gold);
  doc.font(font('DejaVuSerif.ttf')).fontSize(16).fillColor('#555').text('attended', 0, 296, { width: W, align: 'center' });
  doc.font(font('DejaVuSerif-Bold.ttf')).fontSize(26).fillColor(ink).text(event.title, 80, 325, { width: W - 160, align: 'center', height: 70, ellipsis: true });
  doc.font(font('DejaVuSans.ttf')).fontSize(13).fillColor('#555').text(`${fmt(event.startsAt)}  \u2022  ${event.venue}`, 80, 405, { width: W - 160, align: 'center', height: 20, ellipsis: true });
  doc.font(font('DejaVuSans.ttf')).fontSize(11).fillColor('#555');
  doc.text(event.organiserId?.name || 'The organiser', 90, 480, { width: 240, align: 'center' });
  doc.moveTo(110, 475).lineTo(310, 475).lineWidth(0.8).stroke(ink);
  doc.text('Organiser', 90, 495, { width: 240, align: 'center' });
  doc.text(fmt(event.endsAt), W - 330, 480, { width: 240, align: 'center' });
  doc.moveTo(W - 310, 475).lineTo(W - 110, 475).lineWidth(0.8).stroke(ink);
  doc.text('Date', W - 330, 495, { width: 240, align: 'center' });
  doc.fontSize(8).fillColor('#999').text(`Certificate no. ${String(item._id).slice(-10).toUpperCase()}`, 0, H - 62, { width: W, align: 'center' });
  doc.end();
}));
export default router;
