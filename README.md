# Evently – Event Booking System (MERN)

React + Express + MongoDB. Attendees browse and book events, organisers manage them.

## Features
**Everyone**
- Register / log in as attendee or organiser (JWT, hashed passwords, unique names and emails)
- Browse events, search, filter by category and date
- Organiser announcements shown on each event page
- Add to calendar (.ics file)

**Attendees**
- Notifications (bell in the menu): seat from the waitlist, cancelled events, organiser updates
- Waitlist position ("You are number 2 in line")
- Ratings and reviews after an event has ended (one per attendee, only with a confirmed booking)
- Explore: sort (soonest, most booked, most seats left, recently added), "only events with free seats", "include past events"
- Profile page with change password
- Book a seat; if the event is full you join a waitlist and are promoted automatically
- QR ticket for every confirmed booking
- "For You" recommendations based on your interests
- Saved events (favourites)
- Cancel a booking or leave the waitlist

**Organisers**
- Create, edit and cancel events
- Dashboard analytics: confirmed, waitlisted, checked in, fill rate, bookings per day
- Check-in at the door by ticket code (scanner or paste) or one-click button
- Export the attendee list to CSV
- Post and remove announcements (everyone booked or waitlisted gets a notification)
- Repeat an event weekly (up to 12 extra weeks) and duplicate an existing event
- Notified when an attendee reviews an event or the admin approves the account

**Admin**
- One static admin account, created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `server/.env` every time the server starts
  (change the password in `.env`, restart the server, and it is updated). It cannot be created from the sign-up form.
- New organiser accounts are "pending" until the admin approves them; rejecting one cancels their events
- Admin panel: approve / reject organisers, list all users, and manage every event: create new events, edit any event, open its attendee list and check-in page, post announcements, and cancel it

**Ticket tiers, seats and payments (new)**
- **Ticket tiers** per event (Regular, VIP, Early Bird...) with their own price and limit. A tier can stop selling by itself on a set date (for example Early Bird).
- **Interactive seat picker**: organisers can turn on a seat map (rows and seats per row; the front rows belong to the first tier). Attendees click their exact seat. Taken seats turn gray within a few seconds, without reloading. The database refuses a second owner for the same seat.
- **Seat hold timer**: picked seats are held for 10 minutes (`HOLD_MINUTES` in `server/.env`) while the attendee pays. If they do not finish, the seats are released automatically.
- **Simulated checkout**: a card form with a "Pay now" step and a payment record. No real money moves and no keys are needed. Use `4242 4242 4242 4242`; a card ending `0002` is declined. Replace `simulateCharge` in `server/src/utils/ticketing.js` with a real provider (for example Stripe) when you are ready.
- **Group booking**: hold several seats at once and copy a payment link for each one. A friend opens the link, logs in, pays for their own seat, and the seat becomes theirs.
- **Ticket transfer**: send a confirmed ticket to a friend by the email of their attendee account. The owner changes and the QR code changes too, so the old one stops working. (No real email is sent; the friend gets an in-app notification.)
- **Schedule conflict warning**: before booking or holding tickets, the attendee is warned if another event of theirs overlaps.
- **Live attendance counter**: the organiser's check-in page shows "120 of 200 checked in" and updates by itself.
- **Certificates**: organisers can tick "give attendees a certificate". After the event ends, attendees who were checked in can download a PDF with their name filled in.
- Cancelling a paid ticket (or the whole event) records a simulated refund. The dashboard shows ticket revenue.
- Events without tiers keep working exactly as before (free booking and waitlist).

**Safety**
- Two people cannot take the last seat or the same seat, double clicks cannot double book

## Run it
You need Node.js and MongoDB running locally.

1. Server (first terminal)
   ```
   cd server
   npm install
   copy .env.example .env      (then set JWT_SECRET to any long random text)
   npm run dev
   ```
2. Client (second terminal)
   ```
   cd client
   npm install
   npm run dev
   ```
3. Open http://localhost:5173 and log in as admin with the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `server/.env`
   (default `admin@evently.local` / `Admin-ChangeMe-2026`)

After unzipping a fresh copy, always run `npm install` in both folders and create `server/.env`.

## Settings
- `server/.env`: `MONGO_URI`, `JWT_SECRET`, `PORT`, `CLIENT_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`
- `client/.env` (optional): `VITE_API_URL=http://localhost:5000/api`

## Notes
This is a learning project. Before putting it online add rate limiting, email verification,
and keep the login token out of localStorage (use httpOnly cookies).
Organiser accounts need admin approval. Change the admin password in `server/.env` before sharing the project.
