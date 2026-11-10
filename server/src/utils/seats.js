import Booking from '../models/Booking.js';
import Event from '../models/Event.js';
import { notify } from './notify.js';

// Tells an attendee that a waitlist spot turned into a seat.
export async function tellPromoted(booking) {
  const event = await Event.findById(booking.eventId).select('title');
  await notify(booking.userId, `Good news! You now have a seat for "${event?.title || 'your event'}".`, '/my-bookings');
}

// Moves waitlisted attendees (oldest first) into any free seats of a published event.
// Every step is a single atomic database update, so two requests at once can never overfill an event.
export async function promoteWaitlist(eventId) {
  for (;;) {
    // 1. Take a seat first. This only succeeds while there is room.
    const seat = await Event.findOneAndUpdate(
      { _id: eventId, status: 'published', $expr: { $lt: ['$seatsBooked', '$capacity'] } },
      { $inc: { seatsBooked: 1 } }
    );
    if (!seat) return;
    // 2. Give that seat to the oldest waitlisted attendee.
    const next = await Booking.findOneAndUpdate(
      { eventId, status: 'waitlisted' },
      { status: 'confirmed' },
      { sort: { createdAt: 1 } }
    );
    if (!next) {
      // Nobody is waiting, so put the seat back.
      await Event.updateOne({ _id: eventId, seatsBooked: { $gt: 0 } }, { $inc: { seatsBooked: -1 } });
      return;
    }
    await tellPromoted(next);
  }
}
