import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import QRCode from "qrcode";
import api from "./api";

const money = n => Number(n || 0).toFixed(2);
const msg = (err, fallback) => err.response?.data?.message || fallback;
const rowName = i => String.fromCharCode(65 + i);

function useCountdown(until) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setTick(n => n + 1), 500);
    return () => clearInterval(t);
  }, [until]);

  return until ? Math.max(0, new Date(until) - Date.now()) : 0;
}
const clock = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export function ConflictWarning({ eventId, user }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    if (user?.role !== "attendee") return;
    api.get(`/tickets/conflicts/${eventId}`).then(r => setList(r.data.conflicts)).catch(() => setList([]));
  }, [eventId, user?.role]);
  if (!list.length) return null;
  return (
    <div className="conflict-warning" role="alert">
      <strong>⚠ Schedule clash</strong>
      <p>You already have {list.length === 1 ? "another event" : "other events"} at this time:</p>
      <ul>
        {list.map(e => (
          <li key={e._id}>
            <Link to={`/events/${e._id}`}>{e.title}</Link>{" "}
            <small>{new Date(e.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardForm({ total, busy, onPay, label }) {
  const [card, setCard] = useState({ number: "4242 4242 4242 4242", expiry: "12/39", cvc: "123" });
  const set = k => e => setCard({ ...card, [k]: e.target.value });
  return (
    <div className="card-form">
      <div className="sim-note">Test checkout: no real money moves. Use 4242 4242 4242 4242, or a card ending 0002 to see a declined payment.</div>
      <label>Card number<input value={card.number} onChange={set("number")} inputMode="numeric" autoComplete="off" /></label>
      <div className="form-two">
        <label>Expiry (MM/YY)<input value={card.expiry} onChange={set("expiry")} placeholder="MM/YY" autoComplete="off" /></label>
        <label>Security code<input value={card.cvc} onChange={set("cvc")} inputMode="numeric" autoComplete="off" /></label>
      </div>
      <button type="button" className="btn btn-primary full" disabled={busy} onClick={() => onPay(card)}>
        {busy ? "Processing..." : label || (total > 0 ? `Pay now · ${money(total)}` : "Confirm")}
      </button>
    </div>
  );
}

function SeatMap({ avail, picked, onToggle, disabled }) {
  const { seating, tiers, taken } = avail;
  const takenSet = new Set(taken);
  const rowTier = [];
  tiers.forEach((t, ti) => { for (let i = 0; i < t.rows; i++) rowTier.push({ tier: t, ti }); });
  return (
    <div className="seatmap" role="group" aria-label="Seat map">
      <div className="stage">STAGE</div>
      {Array.from({ length: seating.rows }, (_, r) => {
        const { tier, ti } = rowTier[r] || {};
        return (
          <div className="seat-row" key={r}>
            <span className="row-label">{rowName(r)}</span>
            {Array.from({ length: seating.seatsPerRow }, (_, c) => {
              const label = `${rowName(r)}${c + 1}`;
              const isTaken = takenSet.has(label);
              const isPicked = picked.includes(label);
              const off = !tier?.onSale;
              return (
                <button
                  type="button" key={label}
                  className={`seat tier-${ti % 6} ${isTaken ? "taken" : ""} ${isPicked ? "picked" : ""} ${off && !isTaken ? "off" : ""}`}
                  disabled={disabled || isTaken || off}
                  aria-pressed={isPicked}
                  aria-label={`Seat ${label}, ${tier?.name}, ${isTaken ? "taken" : off ? "not on sale" : money(tier?.price)}`}
                  title={`${label} · ${tier?.name} · ${isTaken ? "taken" : money(tier?.price)}`}
                  onClick={() => onToggle(label)}
                >{c + 1}</button>
              );
            })}
            <span className="row-label">{rowName(r)}</span>
          </div>
        );
      })}
      <div className="seat-legend">
        {tiers.map((t, i) => <span key={t._id}><i className={`seat-dot tier-${i % 6}`} /> {t.name} · {money(t.price)}{!t.onSale ? " (ended)" : ""}</span>)}
        <span><i className="seat-dot picked" /> Your pick</span>
        <span><i className="seat-dot taken" /> Taken</span>
      </div>
    </div>
  );
}

export function BuyTickets({ event, user, onDone }) {
  const navigate = useNavigate();
  const [avail, setAvail] = useState(null);
  const [picked, setPicked] = useState([]);
  const [qty, setQty] = useState({});
  const [held, setHeld] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paidMsg, setPaidMsg] = useState("");
  const [copied, setCopied] = useState("");
  const [conflicts, setConflicts] = useState([]);
  const left = useCountdown(held?.expiresAt);
  const expiredHandled = useRef(false);
  const id = event._id;
  const started = new Date(event.startsAt) <= new Date();
  const isAttendee = user?.role === "attendee";

  async function loadAvail() {
    try { setAvail((await api.get(`/tickets/event/${id}/availability`)).data); } catch (e) { setError(msg(e, "Could not load tickets.")); }
  }
  useEffect(() => {
    loadAvail();
    const t = setInterval(loadAvail, 3000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    if (!isAttendee) return;
    api.get("/tickets/mine").then(r => {
      const mine = r.data.filter(t => t.status === "held" && (t.eventId?._id || t.eventId) === id);
      if (mine.length) setHeld({ tickets: mine, expiresAt: mine.map(t => t.holdExpiresAt).sort()[0] });
    }).catch(() => {});
  }, [id, isAttendee]);

  useEffect(() => {
    if (held && left === 0 && !expiredHandled.current) {
      expiredHandled.current = true;
      setHeld(null); setPicked([]);
      setError("Your hold ran out and the seats were released. You can pick again.");
      loadAvail();
    }
  }, [left, held]);

  const tiers = avail?.tiers || [];
  const seated = avail?.seating?.enabled;
  const seatTier = label => {
    const row = label.charCodeAt(0) - 65; let start = 0;
    for (const t of tiers) { if (row >= start && row < start + t.rows) return t; start += t.rows; }
    return null;
  };
  const wantedTotal = seated
    ? picked.reduce((s, l) => s + (seatTier(l)?.price || 0), 0)
    : tiers.reduce((s, t) => s + (qty[t._id] || 0) * t.price, 0);
  const wantedCount = seated ? picked.length : Object.values(qty).reduce((s, n) => s + n, 0);

  function needLogin() {
    navigate("/login", { state: { from: { pathname: `/events/${id}` }, message: "Please log in as an attendee to buy tickets." } });
  }
  function toggleSeat(label) {
    setError("");
    setPicked(p => p.includes(label) ? p.filter(x => x !== label) : p.length >= 8 ? (setError("You can pick up to 8 seats at a time."), p) : [...p, label]);
  }
  function setQuantity(tierId, n, max) { setError(""); setQty(q => ({ ...q, [tierId]: Math.max(0, Math.min(n, max, 8)) })); }

  async function checkConflictsThenHold() {
    if (!user) return needLogin();
    if (!isAttendee) return setError("Only attendee accounts can buy tickets.");
    setError(""); setPaidMsg(""); setBusy(true);
    try {
      const c = (await api.get(`/tickets/conflicts/${id}`)).data.conflicts;
      setConflicts(c);
      if (c.length && !window.confirm(`Schedule clash: you already have "${c[0].title}"${c.length > 1 ? ` and ${c.length - 1} more` : ""} at the same time.\n\nHold these tickets anyway?`)) { setBusy(false); return; }
      expiredHandled.current = false;
      let body;
      if (seated) body = { seats: picked };
      else {
        const entries = Object.entries(qty).filter(([, n]) => n > 0);
        if (entries.length !== 1) { setBusy(false); return setError("Choose one ticket type at a time."); }
        body = { tierId: entries[0][0], quantity: entries[0][1] };
      }
      const r = await api.post(`/tickets/event/${id}/hold`, body);
      setHeld({ tickets: r.data.tickets, expiresAt: r.data.expiresAt });
      setPicked([]); setQty({});
    } catch (e) { setError(msg(e, "Could not hold those tickets.")); loadAvail(); }
    setBusy(false);
  }

  async function pay(card) {
    setBusy(true); setError("");
    try {
      const mineTickets = held.tickets.filter(t => !t.paidByFriend);
      const r = await api.post("/tickets/pay", { ticketIds: mineTickets.map(t => t._id), card });
      setPaidMsg(r.data.message); setHeld(null); onDone?.(); loadAvail();
    } catch (e) { setError(msg(e, "Payment failed.")); if (e.response?.status === 410 || e.response?.status === 404) { setHeld(null); loadAvail(); } }
    setBusy(false);
  }
  async function release() {
    setBusy(true);
    try { for (const t of held.tickets) await api.delete(`/tickets/${t._id}/hold`).catch(() => {}); } finally { setHeld(null); setBusy(false); loadAvail(); }
  }
  async function refreshHeld() {
    try {
      const r = await api.get("/tickets/mine");
      const mine = r.data.filter(t => t.status === "held" && (t.eventId?._id || t.eventId) === id);
      const paidByFriends = held.tickets.length - mine.length;
      if (paidByFriends > 0) setPaidMsg(`${paidByFriends} ticket${paidByFriends > 1 ? "s were" : " was"} paid by friends.`);
      setHeld(mine.length ? { tickets: mine, expiresAt: held.expiresAt } : null);
      if (!mine.length) onDone?.();
    } catch {}
  }
  useEffect(() => {
    if (!held || held.tickets.length < 2) return;
    const t = setInterval(refreshHeld, 4000);
    return () => clearInterval(t);
  }, [held?.tickets?.length, held?.expiresAt]);

  function link(t) { return `${window.location.origin}/pay/${t.payToken}`; }
  async function copy(t) {
    try { await navigator.clipboard.writeText(link(t)); setCopied(t._id); setTimeout(() => setCopied(""), 1800); }
    catch { window.prompt("Copy this payment link:", link(t)); }
  }

  if (!avail) return <div className="loading">Loading tickets...</div>;

  if (held) {
    const total = held.tickets.reduce((s, t) => s + t.price, 0);
    const group = held.tickets.length > 1;
    return (
      <div className="checkout">
        <div className={`hold-timer ${left < 60000 ? "urgent" : ""}`} role="timer">
          <span>Seats held for you</span><strong>{clock(left)}</strong>
        </div>
        <ul className="held-list">
          {held.tickets.map(t => (
            <li key={t._id}>
              <span><strong>{t.seat ? `Seat ${t.seat}` : "Ticket"}</strong> · {t.tierName}</span><span>{money(t.price)}</span>
              {group && (
                <button type="button" className="link-btn" onClick={() => copy(t)}>{copied === t._id ? "Link copied ✓" : "Copy pay link for a friend"}</button>
              )}
            </li>
          ))}
        </ul>
        {group && <p className="small-note">Send each friend their own link. They pay for their seat, and the seat becomes theirs. Anything not paid in time is released.</p>}
        <div className="checkout-total"><span>Total to pay</span><strong>{money(total)}</strong></div>
        {conflicts.length > 0 && <div className="conflict-warning"><strong>⚠ Schedule clash</strong> with {conflicts.map(c => c.title).join(", ")}</div>}
        {error && <div className="alert">{error}</div>}
        <CardForm total={total} busy={busy} onPay={pay} label={`Pay now · ${money(total)}${group ? " (all seats)" : ""}`} />
        <button type="button" className="btn btn-light full" style={{ marginTop: 10 }} disabled={busy} onClick={release}>Release seats</button>
      </div>
    );
  }

  return (
    <div className="buy-tickets">
      {paidMsg && <div className="success">{paidMsg} <Link to="/my-bookings" className="text-link">See my tickets →</Link></div>}
      {error && <div className="alert">{error}</div>}

      {seated ? (
        <>
          <p className="small-note">Click a seat to pick it. Gray seats are taken.</p>
          <SeatMap avail={avail} picked={picked} onToggle={toggleSeat} disabled={started || (user && !isAttendee)} />
          {picked.length > 0 && (
            <ul className="picked-list">
              {picked.map(l => <li key={l}><span>Seat {l} · {seatTier(l)?.name}</span><span>{money(seatTier(l)?.price)}</span></li>)}
            </ul>
          )}
        </>
      ) : (
        <ul className="tier-list">
          {tiers.map(t => {
            const soldOut = t.left === 0;
            const q = qty[t._id] || 0;
            return (
              <li key={t._id} className={`tier ${!t.onSale || soldOut ? "off" : ""}`}>
                <div>
                  <strong>{t.name}</strong> <span className="tier-price">{money(t.price) === "0.00" ? "Free" : money(t.price)}</span>
                  <small>
                    {!t.onSale ? "Sale ended" : soldOut ? "Sold out" : `${t.left} left`}
                    {t.onSale && t.saleEndsAt ? ` · sale ends ${new Date(t.saleEndsAt).toLocaleDateString([], { dateStyle: "medium" })}` : ""}
                  </small>
                </div>
                {t.onSale && !soldOut && !started && (
                  <div className="qty">
                    <button type="button" aria-label={`Fewer ${t.name}`} onClick={() => setQuantity(t._id, q - 1, t.left)} disabled={q === 0}>−</button>
                    <span>{q}</span>
                    <button type="button" aria-label={`More ${t.name}`} onClick={() => setQuantity(t._id, q + 1, t.left)} disabled={q >= Math.min(t.left, 8)}>+</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button type="button" className="btn btn-primary full" disabled={started || busy || (user && !isAttendee) || (user && wantedCount === 0)} onClick={checkConflictsThenHold}>
        {started ? "Event has started"
          : user && !isAttendee ? "Only attendees can buy tickets"
          : !user ? "Log in to buy tickets"
          : wantedCount === 0 ? (seated ? "Pick your seats" : "Choose tickets")
          : `Hold ${wantedCount} ticket${wantedCount > 1 ? "s" : ""} · ${money(wantedTotal)}`}
      </button>
      {user && isAttendee && wantedCount > 0 && <p className="small-note">Your tickets are held for {avail.holdMinutes} minutes while you pay. Booking for friends? Hold several and share a pay link for each.</p>}
    </div>
  );
}

export function PayLinkPage({ user }) {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const left = useCountdown(info?.holdExpiresAt);

  useEffect(() => {
    api.get(`/tickets/pay/${token}`).then(r => setInfo(r.data)).catch(e => setError(msg(e, "This payment link is not valid.")));
  }, [token]);

  async function pay(card) {
    setBusy(true); setError("");
    try { const r = await api.post(`/tickets/pay/${token}`, { card }); setDone(r.data.message); }
    catch (e) { setError(msg(e, "Payment failed.")); }
    setBusy(false);
  }
  if (error && !info) return <div className="pay-page"><div className="alert">{error}</div><Link className="btn btn-light" to="/">Explore events</Link></div>;
  if (!info) return <div className="loading">Loading...</div>;
  const ev = info.event;
  return (
    <div className="pay-page">
      <div className="panel checkout">
        <div className="eyebrow">PAY FOR YOUR TICKET</div>
        <h2>{ev?.title}</h2>
        <p className="muted">{ev && new Date(ev.startsAt).toLocaleString()} · {ev?.venue}</p>
        {info.requestedBy && <p className="small-note">{info.requestedBy} is booking for a group and sent you this link.</p>}
        <ul className="held-list">
          <li><span><strong>{info.seat ? `Seat ${info.seat}` : "Ticket"}</strong> · {info.tierName}</span><span>{money(info.price)}</span></li>
        </ul>
        {done ? (
          <>
            <div className="success">{done}</div>
            <Link className="btn btn-primary full" to="/my-bookings">See my tickets</Link>
          </>
        ) : info.status !== "held" ? (
          <div className="alert">This ticket has already been paid.</div>
        ) : !user ? (
          <Link className="btn btn-primary full" to="/login" state={{ from: { pathname: `/pay/${token}` }, message: "Log in as an attendee to pay for your ticket. No account yet? Sign up first." }}>Log in to pay</Link>
        ) : user.role !== "attendee" ? (
          <div className="alert">Only attendee accounts can pay for tickets.</div>
        ) : left === 0 ? (
          <div className="alert">The hold ran out and the seat was released.</div>
        ) : (
          <>
            <div className={`hold-timer ${left < 60000 ? "urgent" : ""}`} role="timer"><span>Seat held for</span><strong>{clock(left)}</strong></div>
            {error && <div className="alert">{error}</div>}
            <CardForm total={info.price} busy={busy} onPay={pay} />
          </>
        )}
      </div>
    </div>
  );
}

function TicketQRSmall({ code }) {
  const [src, setSrc] = useState("");
  useEffect(() => { QRCode.toDataURL(`EVT:${code}`, { width: 220, margin: 1 }).then(setSrc).catch(() => setSrc("")); }, [code]);
  return <div className="ticket">{src && <img src={src} alt="Ticket QR code" width="160" height="160" />}<small>Ticket code</small><code>{code}</code></div>;
}
export async function downloadCertificate(kind, id, setError, saveFile) {
  try {
    const r = await api.get(`/certificates/${kind}/${id}`, { responseType: "blob" });
    saveFile(r.data, "certificate.pdf");
  } catch (e) {
    let text = "Could not download the certificate.";
    try { text = JSON.parse(await e.response.data.text()).message || text; } catch {}
    setError(text);
  }
}
export function MyTickets({ saveFile }) {
  const [tickets, setTickets] = useState([]);
  const [open, setOpen] = useState(null);
  const [sendOpen, setSendOpen] = useState(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() { try { setTickets((await api.get("/tickets/mine")).data); } catch {} }
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);

  async function send(t) {
    setError(""); setMessage("");
    try { const r = await api.post(`/tickets/${t._id}/transfer`, { email }); setMessage(r.data.message); setSendOpen(null); setEmail(""); load(); }
    catch (e) { setError(msg(e, "Could not send the ticket.")); }
  }
  async function cancel(t) {
    if (!window.confirm("Cancel this ticket? It will be refunded.")) return;
    setError(""); setMessage("");
    try { const r = await api.patch(`/tickets/${t._id}/cancel`); setMessage(r.data.message); load(); }
    catch (e) { setError(msg(e, "Could not cancel the ticket.")); }
  }
  const list = tickets.filter(t => t.status !== "held");
  if (!list.length) return null;
  const upcoming = t => t.eventId && new Date(t.eventId.startsAt) > new Date() && t.eventId.status === "published";
  return (
    <div className="my-tickets">
      <h3>My tickets</h3>
      {message && <div className="success">{message}</div>}
      {error && <div className="alert">{error}</div>}
      <div className="booking-list">
        {list.map(t => (
          <div className="booking-item panel" key={t._id}>
            <div>
              <span className={`status ${t.status}`}>{t.status === "cancelled" && t.refunded ? "refunded" : t.status}</span>
              <h3>{t.eventId?.title || "Event unavailable"}</h3>
              <p className="muted">{t.tierName}{t.seat ? ` · Seat ${t.seat}` : ""} · {money(t.price) === "0.00" ? "Free" : money(t.paidAmount || t.price)} · {t.eventId && new Date(t.eventId.startsAt).toLocaleDateString()}</p>
              {t.checkedInAt && <p className="muted">✓ Checked in</p>}
              {t.eventId?.status === "published" && <p style={{ marginTop: 8 }}><Link className="text-link" to={`/events/${t.eventId._id}`}>View event →</Link></p>}
              {t.status === "confirmed" && (
                <div className="ticket-actions">
                  <button type="button" className="btn btn-light" onClick={() => setOpen(open === t._id ? null : t._id)}>{open === t._id ? "Hide ticket" : "Show ticket"}</button>
                  {!t.checkedInAt && upcoming(t) && <button type="button" className="btn btn-light" onClick={() => { setSendOpen(sendOpen === t._id ? null : t._id); setError(""); }}>Send to a friend</button>}
                  {t.canCertificate && <button type="button" className="btn btn-light" onClick={() => downloadCertificate("ticket", t._id, setError, saveFile)}>🎓 Certificate</button>}
                </div>
              )}
              {open === t._id && <TicketQRSmall code={t.code} />}
              {sendOpen === t._id && (
                <form className="inline-form" style={{ marginTop: 10 }} onSubmit={e => { e.preventDefault(); send(t); }}>
                  <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Friend's account email" aria-label="Friend's email" />
                  <button className="btn btn-primary">Send</button>
                </form>
              )}
            </div>
            {t.status === "confirmed" && !t.checkedInAt && upcoming(t) && <button className="btn btn-danger-outline" onClick={() => cancel(t)}>Cancel ticket</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TierEditor({ value, onChange, locked }) {
  const { enabled, seating, tiers, offersCertificate } = value;
  const setTier = (i, k, v) => onChange({ ...value, tiers: tiers.map((t, j) => j === i ? { ...t, [k]: v } : t) });
  const add = () => onChange({ ...value, tiers: [...tiers, { name: "", price: 0, limit: 50, rows: 1, saleEndsAt: "" }] });
  const remove = i => onChange({ ...value, tiers: tiers.filter((_, j) => j !== i) });
  const rowSum = tiers.reduce((s, t) => s + (Number(t.rows) || 0), 0);
  return (
    <div className="tier-editor">
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={e => onChange({ ...value, enabled: e.target.checked, tiers: e.target.checked && !tiers.length ? [{ name: "Regular", price: 10, limit: 50, rows: seating.rows, saleEndsAt: "" }] : tiers })} />
        <span>Sell tickets with prices (Regular, VIP, Early Bird...)</span>
      </label>
      {enabled && (
        <>
          <p className="small-note">Attendees pay in a simulated checkout, and their seats are held for 10 minutes while they pay.</p>
          <label className="check">
            <input type="checkbox" checked={seating.enabled} disabled={locked} onChange={e => onChange({ ...value, seating: { ...seating, enabled: e.target.checked }, tiers: tiers.map((t, i) => ({ ...t, rows: i === 0 ? seating.rows : 0 })) })} />
            <span>Attendees pick exact seats on a seat map</span>
          </label>
          {seating.enabled && (
            <div className="form-two">
              <label>Rows (1 to 26)<input type="number" min="1" max="26" disabled={locked} value={seating.rows} onChange={e => onChange({ ...value, seating: { ...seating, rows: Number(e.target.value) } })} /></label>
              <label>Seats per row (1 to 30)<input type="number" min="1" max="30" disabled={locked} value={seating.seatsPerRow} onChange={e => onChange({ ...value, seating: { ...seating, seatsPerRow: Number(e.target.value) } })} /></label>
            </div>
          )}
          {tiers.map((t, i) => (
            <div className="tier-row" key={t._id || i}>
              <label>Name<input value={t.name} maxLength={40} onChange={e => setTier(i, "name", e.target.value)} placeholder="Early Bird" required /></label>
              <label>Price<input type="number" min="0" step="0.01" value={t.price} onChange={e => setTier(i, "price", e.target.value)} required /></label>
              {seating.enabled
                ? <label>Rows (front first)<input type="number" min="1" disabled={locked} value={t.rows} onChange={e => setTier(i, "rows", e.target.value)} required /></label>
                : <label>Ticket limit<input type="number" min="1" value={t.limit} onChange={e => setTier(i, "limit", e.target.value)} required /></label>}
              <label>Stops selling on (optional)<input type="datetime-local" value={t.saleEndsAt || ""} onChange={e => setTier(i, "saleEndsAt", e.target.value)} /></label>
              {!locked && tiers.length > 1 && <button type="button" className="link-danger" onClick={() => remove(i)}>Remove</button>}
            </div>
          ))}
          {seating.enabled && <p className={`small-note ${rowSum !== seating.rows ? "warn" : ""}`}>The tiers use {rowSum} of {seating.rows} rows{rowSum !== seating.rows ? ": they must add up to the total" : " ✓"}.</p>}
          {!locked && tiers.length < 6 && <button type="button" className="btn btn-light" onClick={add}>+ Add a tier</button>}
          {locked && <p className="small-note">Tickets are already held or sold, so tiers cannot be added or removed. You can still change names, prices, dates and limits.</p>}
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={offersCertificate} onChange={e => onChange({ ...value, offersCertificate: e.target.checked })} />
        <span>Give attendees a certificate after the event (for checked-in attendees)</span>
      </label>
    </div>
  );
}

export function LiveCounter({ eventId }) { 
  const [live, setLive] = useState(null);
  useEffect(() => {
    let stop = false;
    const load = () => api.get(`/events/${eventId}/live`).then(r => { if (!stop) setLive(r.data); }).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [eventId]);
  if (!live) return null;
  const pct = live.total ? Math.round((live.checkedIn / live.total) * 100) : 0;
  return (
    <div className="live-counter panel" aria-live="polite">
      <div><span className="live-dot" /> LIVE CHECK-IN</div>
      <strong>{live.checkedIn} of {live.total} checked in</strong>
      <div className="seat-track"><div style={{ width: `${pct}%` }} /></div>
      <small>{pct}% of confirmed attendees · updates every few seconds</small>
    </div>
  );
}
