import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation
} from "react-router-dom";
import QRCode from "qrcode";
import api from "./api";
import { BuyTickets, ConflictWarning, LiveCounter, MyTickets, PayLinkPage, TierEditor, downloadCertificate } from "./tickets";

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("user"));
  } catch {
    return null;
  }
}

function downloadCalendar(event) {
  const stamp = d =>
    new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = t =>
    String(t || "")
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/([,;])/g, "\\$1");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Evently//Event Booking//EN",
    "BEGIN:VEVENT",
    `UID:${event._id}@evently`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(event.startsAt)}`,
    `DTEND:${stamp(event.endsAt)}`,
    `SUMMARY:${esc(event.title)}`,
    `LOCATION:${esc(event.venue)}`,
    `DESCRIPTION:${esc(event.description)}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ];

  saveFile(
    new Blob([lines.join("\r\n")], { type: "text/calendar" }),
    `${event.title.replace(/[^\w-]+/g, "_") || "event"}.ics`
  );
}

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function TicketQR({ code }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    QRCode.toDataURL(`EVT:${code}`, { width: 220, margin: 1 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [code]);

  return (
    <div className="ticket">
      {src && <img src={src} alt="Ticket QR code" width="160" height="160" />}
      <small>Ticket code</small>
      <code>{code}</code>
    </div>
  );
}

function Stars({ value }) {
  const n = Math.round(value);
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {"★".repeat(n)}
      <span className="stars-off">{"★".repeat(5 - n)}</span>
    </span>
  );
}

function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ unread: 0, items: [] });

  async function load() {
    try {
      const response = await api.get("/notifications");
      setData(response.data);
    } catch {
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  async function openItem(item) {
    setOpen(false);

    if (!item.readAt) {
      await api.patch(`/notifications/${item._id}/read`).catch(() => {});
      load();
    }

    if (item.link) navigate(item.link);
  }

  async function readAll() {
    await api.post("/notifications/read-all").catch(() => {});
    load();
  }

  return (
    <div className="bell-wrap">
      <button
        type="button"
        className="bell"
        aria-label="Notifications"
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        🔔
        {data.unread > 0 && (
          <span className="bell-count">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bell-menu panel">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && (
              <button type="button" onClick={readAll}>
                Mark all read
              </button>
            )}
          </div>

          {data.items.length === 0 && (
            <p className="muted bell-empty">Nothing new yet.</p>
          )}

          {data.items.map(item => (
            <button
              type="button"
              key={item._id}
              className={item.readAt ? "bell-item" : "bell-item unread"}
              onClick={() => openItem(item)}
            >
              <span>{item.message}</span>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewsSection({ eventId, user }) {
  const [data, setData] = useState({ average: 0, count: 0, reviews: [] });
  const [mine, setMine] = useState(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, [eventId, user]);

  async function load() {
    try {
      const response = await api.get(`/reviews/event/${eventId}`);
      setData(response.data);

      if (user?.role === "attendee") {
        const m = await api.get(`/reviews/event/${eventId}/mine`);
        setMine(m.data);

        if (m.data.review) {
          setRating(m.data.review.rating);
          setComment(m.data.review.comment || "");
        }
      }
    } catch {
    }
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!rating) return setError("Please choose a rating from 1 to 5 stars.");

    try {
      await api.post(`/reviews/event/${eventId}`, { rating, comment });
      setMessage("Thanks! Your review has been saved.");
      load();
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not save your review."
      );
    }
  }

  async function remove() {
    try {
      await api.delete(`/reviews/event/${eventId}`);
      setRating(0);
      setComment("");
      setMessage("Your review was deleted.");
      load();
    } catch {
      setError("Could not delete your review.");
    }
  }

  if (data.count === 0 && !mine?.canReview) return null;

  return (
    <section className="panel reviews">
      <h3>
        Reviews{" "}
        {data.count > 0 && (
          <span className="review-summary">
            <Stars value={data.average} /> {data.average} · {data.count}{" "}
            {data.count === 1 ? "review" : "reviews"}
          </span>
        )}
      </h3>

      {mine?.canReview && (
        <form className="review-form" onSubmit={submit}>
          <p className="muted">
            {mine.review ? "Your review (you can change it):" : "How was this event?"}
          </p>

          <div className="star-pick">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                className={n <= rating ? "star on" : "star"}
                aria-label={`${n} star${n > 1 ? "s" : ""}`}
                onClick={() => setRating(n)}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            rows="3"
            maxLength="500"
            placeholder="Tell others what you liked (optional)"
            value={comment}
            onChange={e => setComment(e.target.value)}
          />

          <div className="review-actions">
            <button className="btn btn-primary">
              {mine.review ? "Update review" : "Post review"}
            </button>

            {mine.review && (
              <button
                type="button"
                className="btn btn-light"
                onClick={remove}
              >
                Delete my review
              </button>
            )}
          </div>

          {message && <div className="success">{message}</div>}
          {error && <div className="alert">{error}</div>}
        </form>
      )}

      {data.reviews.map(r => (
        <div className="review" key={r._id}>
          <div>
            <Stars value={r.rating} /> <strong>{r.user.name}</strong>
            <small>{new Date(r.createdAt).toLocaleDateString()}</small>
          </div>
          {r.comment && <p>{r.comment}</p>}
        </div>
      ))}
    </section>
  );
}

function ProfilePage({ user }) {
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: ""
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    if (form.newPassword !== form.confirm) {
      return setError("The new passwords do not match.");
    }

    try {
      const response = await api.put("/auth/password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword
      });

      setMessage(response.data.message);
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      setError(
        err.response?.data?.message || "Could not change the password."
      );
    }
  }

  if (!user) return <LoginPrompt />;

  return (
    <section className="section">
      <div className="eyebrow">YOUR ACCOUNT</div>
      <h2>{user.name}</h2>

      <p className="muted">
        {user.email} · <span style={{ textTransform: "capitalize" }}>{user.role}</span>
      </p>

      <div className="panel manage-box" style={{ maxWidth: 480 }}>
        <h3>Change password</h3>

        {user.role === "admin" ? (
          <p className="muted">
            The admin password is set in <code>server/.env</code>
            {" "}(ADMIN_PASSWORD). Change it there and restart the server.
          </p>
        ) : (
          <form className="event-form profile-form" onSubmit={submit}>
            <label>
              Current password
              <input
                type="password"
                value={form.currentPassword}
                onChange={e =>
                  setForm({ ...form, currentPassword: e.target.value })
                }
                required
              />
            </label>

            <label>
              New password
              <input
                type="password"
                minLength="8"
                placeholder="At least 8 characters"
                value={form.newPassword}
                onChange={e =>
                  setForm({ ...form, newPassword: e.target.value })
                }
                required
              />
            </label>

            <label>
              Confirm new password
              <input
                type="password"
                minLength="8"
                value={form.confirm}
                onChange={e =>
                  setForm({ ...form, confirm: e.target.value })
                }
                required
              />
            </label>

            {message && <div className="success">{message}</div>}
            {error && <div className="alert">{error}</div>}

            <button className="btn btn-primary">Change password</button>
          </form>
        )}
      </div>
    </section>
  );
}

function App() {
  const [user, setUser] = useState(getUser());

  useEffect(() => {
    if (!localStorage.getItem("token")) return;

    api.get("/auth/me")
      .then(response => {
        localStorage.setItem("user", JSON.stringify(response.data.user));
        setUser(response.data.user);
      })
      .catch(() => {});
  }, []);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    window.location.href = "/";
  }

  return (
    <>
      <header className="navbar">
        <Link to="/" className="brand">
          Evently<span>.</span>
        </Link>

        <nav>
          <NavLink to="/">Explore Events</NavLink>

          {user?.role === "attendee" && (
            <NavLink to="/my-bookings">My Bookings</NavLink>
          )}

          {user?.role === "attendee" && (
            <NavLink to="/recommendations">For You</NavLink>
          )}

          {user?.role === "attendee" && (
            <NavLink to="/saved">Saved</NavLink>
          )}

          {user?.role === "organiser" && (
            <NavLink to="/dashboard">Dashboard</NavLink>
          )}

          {user?.role === "admin" && (
            <NavLink to="/admin">Admin</NavLink>
          )}
        </nav>

        <div className="nav-right">
          {user ? (
            <>
              <NotificationBell />
              <Link className="welcome" to="/profile">
                Hi, {user.name}
              </Link>
              <button className="btn btn-light" onClick={logout}>
                Logout
              </button>
            </>
          ) : (
            <>
              <Link className="login-link" to="/login">Login</Link>
              <Link className="btn btn-primary" to="/register">
                Get Started
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="container">
        <Routes>
          <Route path="/" element={<EventsPage user={user} />} />

          <Route
            path="/login"
            element={<AuthPage mode="login" setUser={setUser} />}
          />

          <Route
            path="/register"
            element={<AuthPage mode="register" setUser={setUser} />}
          />

          <Route
            path="/events/:id"
            element={<EventDetails user={user} />}
          />

          <Route
            path="/my-bookings"
            element={<MyBookings user={user} />}
          />

          <Route
            path="/recommendations"
            element={
              <RecommendationsPage user={user} setUser={setUser} />
            }
          />

          <Route
            path="/profile"
            element={<ProfilePage user={user} />}
          />

          <Route
            path="/admin"
            element={<AdminPage user={user} />}
          />

          <Route
            path="/saved"
            element={<SavedPage user={user} />}
          />

          <Route
            path="/dashboard"
            element={<Dashboard user={user} />}
          />

          <Route
            path="/events/new"
            element={<EventForm user={user} />}
          />

          <Route
            path="/events/:id/edit"
            element={<EventForm user={user} />}
          />

          <Route path="/pay/:token" element={<PayLinkPage user={user} />} />

          <Route
            path="/events/:id/attendees"
            element={<AttendeeList user={user} />}
          />
        </Routes>
      </main>

      <footer>
        © 2026 Evently. Discover experiences worth remembering.
      </footer>
    </>
  );
}

function RecommendationsPage({ user, setUser }) {
  const categories = [
    "Technology",
    "Music",
    "Education",
    "Business",
    "Sports",
    "Arts",
    "Other"
  ];

  const [interests, setInterests] = useState(user?.interests || []);
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setInterests(user?.interests || []);
  }, [user]);

  useEffect(() => {
    if (user?.role === "attendee") {
      loadRecommendations();
    }
  }, [user]);

  function toggleInterest(category) {
    setInterests(current =>
      current.includes(category)
        ? current.filter(item => item !== category)
        : [...current, category]
    );
  }

  async function loadRecommendations() {
    setLoading(true);
    setError("");

    try {
      const response = await api.get("/events/recommended");
      setRecommendations(response.data.recommendations || []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load recommendations."
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveInterests() {
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await api.put("/auth/interests", {
        interests
      });

      const updatedUser = {
        ...user,
        interests: response.data.user?.interests || interests
      };

      localStorage.setItem("user", JSON.stringify(updatedUser));
      setUser(updatedUser);

      setMessage(
        "Your interests have been saved. Recommendations updated!"
      );

      await loadRecommendations();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not save your interests."
      );
    } finally {
      setSaving(false);
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role !== "attendee") {
    return <div className="alert">Attendee account required.</div>;
  }

  return (
    <section className="section">
      <div className="eyebrow">PERSONALIZED DISCOVERY</div>

      <h2>Smart Event Recommendations</h2>

      <p className="muted">
        Choose the categories you enjoy. Evently will recommend
        upcoming events that match your interests.
      </p>

      <div
        className="panel"
        style={{ padding: 24, marginTop: 24 }}
      >
        <h3 style={{ margin: "0 0 8px", fontFamily: "Manrope" }}>
          Choose your interests
        </h3>

        <p className="muted">
          Select one or more categories that you are interested in.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            margin: "20px 0"
          }}
        >
          {categories.map(category => {
            const selected = interests.includes(category);

            return (
              <button
                key={category}
                type="button"
                onClick={() => toggleInterest(category)}
                aria-pressed={selected}
                style={{
                  border: selected
                    ? "1px solid #6555dc"
                    : "1px solid #e7e6f0",
                  background: selected ? "#eeeaff" : "#fff",
                  color: selected ? "#5142c6" : "#66647a",
                  borderRadius: 22,
                  padding: "10px 16px",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer"
                }}
              >
                {selected ? "✓ " : "+ "}
                {category}
              </button>
            );
          })}
        </div>

        <button
          className="btn btn-primary"
          onClick={saveInterests}
          disabled={saving}
        >
          {saving
            ? "Saving..."
            : "Save Interests & Update Recommendations"}
        </button>
      </div>

      {message && <div className="success">{message}</div>}
      {error && <div className="alert">{error}</div>}

      <div
        className="section-heading"
        style={{ marginTop: 38 }}
      >
        <div>
          <div className="eyebrow">PICKED FOR YOU</div>
          <h2>Recommended events</h2>
          <p className="muted">
            Events matching your selected interests appear first.
          </p>
        </div>

        <button
          className="btn btn-light"
          onClick={loadRecommendations}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {loading && (
        <div className="loading">Finding events for you...</div>
      )}

      {!loading && recommendations.length > 0 && (
        <div className="event-grid">
          {recommendations.map(event => (
            <div
              key={event._id}
              style={{ position: "relative" }}
            >
              <EventCard event={event} />

              <div
                style={{
                  padding: "9px 12px",
                  background: "#f1efff",
                  color: "#5142c6",
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: "0 0 12px 12px"
                }}
              >
                {event.matchScore > 0
                  ? `✓ ${event.matchReason}`
                  : event.matchReason}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading &&
        recommendations.length === 0 &&
        !error && (
          <div className="empty">
            <div className="empty-icon">✦</div>
            <h3>No recommendations available yet</h3>
            <p>
              Choose your interests and check again when more
              upcoming events are published.
            </p>
            <Link className="btn btn-primary" to="/">
              Explore all events
            </Link>
          </div>
        )}
    </section>
  );
}

function AuthPage({ mode, setUser }) {
  const navigate = useNavigate();
  const location = useLocation();

  const returnTo = location.state?.from?.pathname || "/";
  const loginMessage =
    location.state?.message ||
    (new URLSearchParams(location.search).get("expired")
      ? "Your session has ended. Please log in again."
      : "");

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "attendee"
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isRegister = mode === "register";

  function change(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const endpoint = isRegister
        ? "/auth/register"
        : "/auth/login";

      const response = await api.post(endpoint, form);

      localStorage.setItem("token", response.data.token);
      localStorage.setItem(
        "user",
        JSON.stringify(response.data.user)
      );

      setUser(response.data.user);

      if (response.data.user.role === "admin") {
        navigate("/admin", { replace: true });
      } else if (response.data.user.role === "organiser") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate(returnTo, { replace: true });
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Unable to continue. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form
        className="panel auth-card"
        onSubmit={submit}
      >
        <div className="eyebrow">WELCOME TO EVENTLY</div>

        <h1>
          {isRegister
            ? "Create your account"
            : "Welcome back"}
        </h1>

        <p className="muted">
          {isRegister
            ? "Join events or start organising your own."
            : "Log in to continue to your events."}
        </p>

        {loginMessage && (
          <div className="alert" role="alert">
            {loginMessage}
          </div>
        )}

        {isRegister && (
          <label>
            Full name
            <input
              name="name"
              value={form.name}
              onChange={change}
              required
              placeholder="Your full name"
            />
          </label>
        )}

        <label>
          Email address
          <input
            type="email"
            name="email"
            value={form.email}
            onChange={change}
            required
            placeholder="you@example.com"
          />
        </label>

        <label>
          Password
          <div style={{ position: "relative", width: "100%" }}>
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              value={form.password}
              onChange={change}
              required
              minLength="8"
              placeholder="At least 8 characters"
              style={{
                paddingRight: "75px",
                width: "100%"
              }}
            />

            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: "absolute",
                right: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "transparent",
                color: "#6554e8",
                cursor: "pointer",
                fontWeight: "600",
                padding: "5px"
              }}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        {isRegister && (
          <label>
            Account type
            <select
              name="role"
              value={form.role}
              onChange={change}
            >
              <option value="attendee">Attendee</option>
              <option value="organiser">Organiser</option>
            </select>
          </label>
        )}

        {isRegister && form.role === "organiser" && (
          <p className="small-note">
            Organiser accounts must be approved by an admin before you
            can create events.
          </p>
        )}

        {error && <div className="alert">{error}</div>}

        <button
          className="btn btn-primary full"
          disabled={loading}
        >
          {loading
            ? "Please wait..."
            : isRegister
              ? "Create Account"
              : "Login"}
        </button>

        <p className="auth-switch">
          {isRegister
            ? "Already have an account?"
            : "New to Evently?"}{" "}
          <Link
            to={isRegister ? "/login" : "/register"}
            state={location.state}
          >
            {isRegister ? "Login" : "Register"}
          </Link>
        </p>
      </form>
    </div>
  );
}

function EventsPage({ user }) {
  const [events, setEvents] = useState([]);
  const [category, setCategory] = useState("All");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("soonest");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadEvents();
  }, [category, date, showPast]);

  async function loadEvents() {
    try {
      const params = { category };
      if (showPast) params.past = "1";
      if (date) {
        params.from = new Date(`${date}T00:00:00`).toISOString();
        params.to = new Date(`${date}T23:59:59.999`).toISOString();
      }

      const response = await api.get("/events", { params });

      setEvents(response.data);
      setError("");
    } catch {
      setError(
        "Could not load events. Please check that the backend is running."
      );
    }
  }

  const shown = events
    .filter(event =>
      event.title.toLowerCase().includes(search.toLowerCase()) ||
      event.venue.toLowerCase().includes(search.toLowerCase())
    )
    .filter(event => !onlyOpen || event.seatsBooked < event.capacity)
    .sort((a, b) => {
      if (sortBy === "popular") return b.seatsBooked - a.seatsBooked;
      if (sortBy === "seats") {
        return (
          b.capacity - b.seatsBooked - (a.capacity - a.seatsBooked)
        );
      }
      if (sortBy === "newest") {
        return new Date(b.createdAt) - new Date(a.createdAt);
      }
      return new Date(a.startsAt) - new Date(b.startsAt);
    });

  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow light">
            MAKE EVERY MOMENT COUNT
          </div>

          <h1>
            Find your next<br />
            <span>great experience.</span>
          </h1>

          <p>
            Discover local events, meet people, and make memories
            that last.
          </p>

          <a href="#events" className="btn btn-white">
            Explore events <span>→</span>
          </a>
        </div>

        <div className="hero-shape">
          <div className="shape-card">
            <span>✦</span>
            <strong>
              Something<br />
              amazing awaits.
            </strong>
            <small>Discover • Connect • Experience</small>
          </div>
        </div>
      </section>

      <section id="events" className="section">
        <div className="section-heading">
          <div>
            <div className="eyebrow">EXPLORE</div>
            <h2>Upcoming events</h2>
            <p className="muted">
              Find something you will love.
            </p>
          </div>

          {user?.role === "organiser" &&
            user.accountStatus === "approved" && (
            <Link
              className="btn btn-primary"
              to="/events/new"
            >
              + Create event
            </Link>
          )}
        </div>

        <div className="filters">
          <input
            className="search-input"
            placeholder="Search events or venues..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
          >
            <option>All</option>
            <option>Technology</option>
            <option>Music</option>
            <option>Education</option>
            <option>Business</option>
            <option>Sports</option>
            <option>Arts</option>
            <option>Other</option>
          </select>

          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />

          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            aria-label="Sort events"
          >
            <option value="soonest">Soonest first</option>
            <option value="popular">Most booked</option>
            <option value="seats">Most seats left</option>
            <option value="newest">Recently added</option>
          </select>
        </div>

        <div className="filter-options">
          <label>
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={e => setOnlyOpen(e.target.checked)}
            />
            Only events with free seats
          </label>

          <label>
            <input
              type="checkbox"
              checked={showPast}
              onChange={e => setShowPast(e.target.checked)}
            />
            Include past events
          </label>
        </div>

        {error && <div className="alert">{error}</div>}

        {!error && shown.length === 0 && (
          <div className="empty">
            <div className="empty-icon">✦</div>
            <h3>No events found</h3>
            <p>Try another search or filter.</p>
          </div>
        )}

        <div className="event-grid">
          {shown.map(event => (
            <EventCard
              key={event._id}
              event={event}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function EventCard({ event }) {
  const date = new Date(event.startsAt);

  const remaining = Math.max(
    0,
    event.capacity - event.seatsBooked
  );

  return (
    <Link
      to={`/events/${event._id}`}
      className="event-card"
    >
      <div
        className="event-image"
        style={
          event.imageUrl
            ? {
                backgroundImage:
                  `linear-gradient(0deg,rgba(20,20,40,.2),transparent),url(${event.imageUrl})`
              }
            : {}
        }
      >
        {!event.imageUrl && (
          <span className="image-symbol">✦</span>
        )}

        <span className="category-tag">
          {event.category}
        </span>
      </div>

      <div className="event-card-body">
        <div className="event-date">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric"
          })}

          {" · "}

          {date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
          })}
        </div>

        <h3>{event.title}</h3>

        <p className="muted">
          ⌖ {event.venue}
        </p>

        <div className="card-bottom">
          <span>{remaining > 0 ? `${remaining} seats left` : "Full · waitlist open"}</span>
          <strong>View event →</strong>
        </div>
      </div>
    </Link>
  );
}

function EventDetails({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [myStatus, setMyStatus] = useState(null);
  const [saved, setSaved] = useState(false);
  const [myPosition, setMyPosition] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadEvent();
  }, [id]);

  async function loadEvent() {
    try {
      const response = await api.get(`/events/${id}`);
      setEvent(response.data);

      if (user?.role === "attendee") {
        const bookings = await api.get("/bookings/mine");

        const mine = bookings.data.find(
          b =>
            b.eventId?._id === id &&
            (b.status === "confirmed" || b.status === "waitlisted")
        );

        setMyStatus(mine ? mine.status : null);
        setMyPosition(mine?.waitlistPosition || 0);

        const savedList = await api.get("/saved");
        setSaved(savedList.data.some(e => e._id === id));
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load event."
      );
    }
  }

  async function book() {
    if (!user) {
      return navigate("/login", {
        state: {
          from: {
            pathname: `/events/${id}`
          },
          message: "Please log in as an attendee before booking this event."
        }
      });
    }
    
    if (user.role !== "attendee") {
      return setError(
        "Only attendee accounts can book events."
      );
    }

    try {      
      const clash = await api.get(`/tickets/conflicts/${id}`);
      const c = clash.data.conflicts;

      if (c.length && !window.confirm(`Schedule clash: you already have "${c[0].title}"${c.length > 1 ? ` and ${c.length - 1} more` : ""} at the same time.\n\nBook this event anyway?`)) {
        return;
      }

      const response = await api.post(`/bookings/${id}`);

      setError("");
      setMessage(response.data.message);
      loadEvent();
    } catch (err) {
      setMessage("");
      setError(
        err.response?.data?.message ||
        "Booking failed."
      );
    }
  }

  async function toggleSave() {
    try {
      if (saved) {
        await api.delete(`/saved/${id}`);
      } else {
        await api.put(`/saved/${id}`);
      }

      setSaved(!saved);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not update your saved events."
      );
    }
  }

  if (error && !event) {
    return <div className="alert">{error}</div>;
  }

  if (!event) {
    return <div className="loading">Loading event...</div>;
  }

  const remaining = Math.max(
    0,
    event.capacity - event.seatsBooked
  );

  const isFull = remaining === 0;
  const started = new Date(event.startsAt) <= new Date();

  return (
    <>
    <div className="detail-layout">
      <div>
        <div
          className="detail-banner"
          style={
            event.imageUrl
              ? {
                  backgroundImage:
                    `linear-gradient(0deg,rgba(20,20,40,.25),transparent),url(${event.imageUrl})`
                }
              : {}
          }
        >
          <span>✦</span>
        </div>

        <div className="detail-content">
          <span className="category-tag inline-tag">
            {event.category}
          </span>

          <h1>{event.title}</h1>

          <p className="muted">
            Organised by {
              event.organiserId?.name || "Event organiser"
            }
          </p>

          <h3>About this event</h3>

          <p className="description">
            {event.description}
          </p>

          {event.announcements?.length > 0 && (
            <div className="announcements">
              <h3>Updates from the organiser</h3>

              {[...event.announcements].reverse().map(a => (
                <div className="announcement" key={a._id}>
                  <p>{a.message}</p>
                  <small>{new Date(a.createdAt).toLocaleString()}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <aside className="panel booking-panel">
        <div className="eyebrow">EVENT INFORMATION</div>

        <div className="info-row">
          <span>📅 Date & time</span>
          <strong>
            {new Date(event.startsAt).toLocaleString()}
          </strong>
        </div>

        <div className="info-row">
          <span>📍 Venue</span>
          <strong>{event.venue}</strong>
        </div>

        <div className="info-row">
          <span>🎟 Available seats</span>
          <strong>
            {remaining} / {event.capacity}
          </strong>
        </div>

        <div className="seat-track">
          <div
            style={{
              width:
                `${Math.min(
                  100,
                  event.seatsBooked / event.capacity * 100
                )}%`
            }}
          />
        </div>

        {event.tiers?.length > 0 ? (
          <>
            <div className="eyebrow" style={{ marginTop: 16 }}>TICKETS</div>
            <BuyTickets event={event} user={user} onDone={loadEvent} />
          </>
        ) : (
          <>
            <ConflictWarning eventId={id} user={user} />

        {message && (
          <div className="success">{message}</div>
        )}

        {error && (
          <div className="alert">{error}</div>
        )}

        <button
          className="btn btn-primary full"
          onClick={book}
          disabled={
            started ||
            Boolean(myStatus) ||
            (user && user.role !== "attendee")
          }
        >
          {user && user.role !== "attendee"
            ? "Only attendees can book"
            : myStatus === "confirmed"
              ? "Booked"
              : myStatus === "waitlisted"
                ? "On the waitlist"
                : started
                  ? "Event has started"
                  : isFull
                    ? "Join waitlist"
                    : "Book your seat"}
        </button>
          </>
        )}

        <button
          type="button"
          className="btn btn-light full"
          style={{ marginTop: 10 }}
          onClick={() => downloadCalendar(event)}
        >
          📅 Add to calendar
        </button>

        {user?.role === "attendee" && (
          <button
            type="button"
            className="btn btn-light full"
            style={{ marginTop: 10 }}
            onClick={toggleSave}
          >
            {saved ? "♥ Saved" : "♡ Save for later"}
          </button>
        )}

        {myStatus === "waitlisted" && myPosition > 0 && (
          <p className="small-note">
            You are number {myPosition} in line for a seat.
          </p>
        )}

        {isFull && !myStatus && !started && (!user || user.role === "attendee") && (
          <p className="small-note">
            This event is full. Join the waitlist and you will get a seat
            automatically if one opens up.
          </p>
        )}

        {!user && (
          <p className="small-note">
            Please log in as an attendee to book.
          </p>
        )}

        {user && user.role !== "attendee" && (
          <p className="small-note">
            Only attendee accounts can book events.
          </p>
        )}
      </aside>
    </div>

    <div className="reviews-wrap">
      <ReviewsSection eventId={id} user={user} />
    </div>
    </>
  );
}

function MyBookings({ user }) {
  const [bookings, setBookings] = useState([]);
  const [ticketOpen, setTicketOpen] = useState(null);
  const [hasTickets, setHasTickets] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      api.get("/tickets/mine").then(r => setHasTickets(r.data.some(t => t.status !== "held"))).catch(() => {});
      const response = await api.get("/bookings/mine");
      setBookings(response.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Please log in to view bookings."
      );
    }
  }

  async function cancel(id) {
    if (!window.confirm("Cancel this booking?")) {
      return;
    }

    try {
      const response = await api.patch(
        `/bookings/${id}/cancel`
      );

      setError("");
      setMessage(response.data.message);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not cancel booking."
      );
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role !== "attendee") {
    return (
      <div className="empty">
        <h3>Attendee page</h3>
        <p>
          Log in with an attendee account to view bookings.
        </p>
      </div>
    );
  }

  return (
    <section className="section">
      <div className="eyebrow">YOUR ACTIVITY</div>

      <h2>My bookings</h2>

      <p className="muted">
        Keep track of the events you have joined.
      </p>

      {message && (
        <div className="success">{message}</div>
      )}

      {error && (
        <div className="alert">{error}</div>
      )}

      <MyTickets saveFile={saveFile} />

      {bookings.length > 0 && <h3 style={{ marginTop: 30 }}>Free event bookings</h3>}

      <div className="booking-list">
        {bookings.map(booking => (
          <div
            className="booking-item panel"
            key={booking._id}
          >
            <div>
              <span className={`status ${booking.status}`}>
                {booking.status}
              </span>

              <h3>
                {booking.eventId?.title || "Event unavailable"}
              </h3>

              <p className="muted">
                {booking.eventId?.venue} ·{" "}

                {booking.eventId &&
                  new Date(
                    booking.eventId.startsAt
                  ).toLocaleDateString()}
              </p>

              {booking.checkedInAt && (
                <p className="muted">✓ Checked in</p>
              )}

              {booking.status === "waitlisted" &&
                booking.waitlistPosition > 0 && (
                <p className="muted">
                  You are number {booking.waitlistPosition} in line.
                </p>
              )}

              {booking.eventId?.status === "published" && (
                <p style={{ marginTop: 8 }}>
                  <Link className="text-link" to={`/events/${booking.eventId._id}`}>
                    {booking.status === "confirmed" &&
                    new Date(booking.eventId.endsAt) < new Date()
                      ? "Rate this event →"
                      : "View event →"}
                  </Link>
                </p>
              )}

              {booking.status === "confirmed" &&
                booking.checkedInAt &&
                booking.eventId?.offersCertificate &&
                new Date(booking.eventId.endsAt) < new Date() && (
                <button
                  type="button"
                  className="btn btn-light"
                  style={{ marginTop: 10, marginRight: 8 }}
                  onClick={() => downloadCertificate("booking", booking._id, setError, saveFile)}
                >
                  🎓 Download certificate
                </button>
              )}

              {booking.status === "confirmed" && (
                <>
                  <button
                    type="button"
                    className="btn btn-light"
                    style={{ marginTop: 10 }}
                    onClick={() =>
                      setTicketOpen(
                        ticketOpen === booking._id ? null : booking._id
                      )
                    }
                  >
                    {ticketOpen === booking._id
                      ? "Hide ticket"
                      : "Show ticket"}
                  </button>

                  {ticketOpen === booking._id && (
                    <TicketQR code={booking._id} />
                  )}
                </>
              )}
            </div>

            {(booking.status === "confirmed" ||
              booking.status === "waitlisted") && (
              <button
                className="btn btn-danger-outline"
                onClick={() => cancel(booking._id)}
              >
                {booking.status === "waitlisted"
                  ? "Leave waitlist"
                  : "Cancel booking"}
              </button>
            )}
          </div>
        ))}
      </div>

      {bookings.length === 0 && !hasTickets && (
        <div className="empty">
          <h3>No bookings yet</h3>
          <p>
            Explore events and reserve your first seat.
          </p>

          <Link className="btn btn-primary" to="/">
            Explore events
          </Link>
        </div>
      )}
    </section>
  );
}

function Dashboard({ user }) {
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    load();
  }, []);

  async function load() {
    if (user?.accountStatus === "pending") return;

    try {
      const response = await api.get("/events/mine");
      setEvents(response.data);

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const statsResponse = await api.get("/events/mine/stats", {
        params: { tz }
      });
      setStats(statsResponse.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load dashboard."
      );
    }
  }

  async function cancelEvent(id) {
    if (
      !window.confirm(
        "Cancel this event? All bookings and waitlist entries will also be cancelled."
      )
    ) {
      return;
    }

    try {
      await api.patch(`/events/${id}/cancel`);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not cancel event."
      );
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role === "organiser" && user.accountStatus === "pending") {
    return <PendingNotice />;
  }

  if (user.role !== "organiser") {
    return (
      <div className="alert">
        Organiser account required.
      </div>
    );
  }

  const totalSeats = events.reduce(
    (sum, event) => sum + event.seatsBooked,
    0
  );

  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <div className="eyebrow">ORGANISER SPACE</div>
          <h2>Your dashboard</h2>
          <p className="muted">
            Manage your events and attendees.
          </p>
        </div>

        <Link
          className="btn btn-primary"
          to="/events/new"
        >
          + Create event
        </Link>
      </div>

      {error && <div className="alert">{error}</div>}

      <div className="stats-grid">
        <div className="stat panel">
          <span>Total events</span>
          <strong>{events.length}</strong>
        </div>

        <div className="stat panel">
          <span>Seats booked</span>
          <strong>{totalSeats}</strong>
        </div>

        <div className="stat panel">
          <span>Published events</span>
          <strong>
            {events.filter(e => e.status === "published").length}
          </strong>
        </div>
      </div>

      {stats && (
        <>
          <div className="stats-grid four">
            <div className="stat panel">
              <span>Confirmed</span>
              <strong>{stats.totals.confirmed}</strong>
            </div>

            <div className="stat panel">
              <span>Waitlisted</span>
              <strong>{stats.totals.waitlisted}</strong>
            </div>

            <div className="stat panel">
              <span>Checked in</span>
              <strong>{stats.totals.checkedIn}</strong>
            </div>

            <div className="stat panel">
              <span>Fill rate</span>
              <strong>{stats.totals.fillRate}%</strong>
            </div>

            {stats.totals.revenue > 0 && (
              <div className="stat panel">
                <span>Ticket revenue</span>
                <strong>{Number(stats.totals.revenue).toFixed(2)}</strong>
              </div>
            )}
          </div>

          <div className="panel chart-panel">
            <h3>New bookings · last 14 days</h3>

            <div className="bars">
              {stats.daily.map(day => {
                const max = Math.max(
                  1,
                  ...stats.daily.map(d => d.count)
                );

                return (
                  <div
                    className="bar-col"
                    key={day.date}
                    title={`${day.date}: ${day.count}`}
                  >
                    <span className="bar-num">{day.count || ""}</span>
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max(3, (day.count / max) * 100)}%`
                      }}
                    />
                    <small>{day.date.slice(8)}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      <h3 className="subheading">Your events</h3>

      <div className="table-wrap panel">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Date</th>
              <th>Bookings</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {events.map(event => (
              <tr key={event._id}>
                <td>
                  <strong>{event.title}</strong>
                  <small>{event.venue}</small>
                </td>

                <td>
                  {new Date(event.startsAt).toLocaleDateString()}
                </td>

                <td>
                  {event.seatsBooked} / {event.capacity}

                  {stats?.perEvent[event._id]?.waitlisted > 0 && (
                    <small>
                      {stats.perEvent[event._id].waitlisted} waitlisted
                    </small>
                  )}

                  {stats?.perEvent[event._id]?.checkedIn > 0 && (
                    <small>
                      {stats.perEvent[event._id].checkedIn} checked in
                    </small>
                  )}
                </td>

                <td>
                  <span className={`status ${event.status}`}>
                    {event.status}
                  </span>
                </td>

                <td>
                  <div className="table-actions">
                    {event.status === "published" && (
                      <button
                        onClick={() =>
                          navigate(`/events/${event._id}/edit`)
                        }
                      >
                        Edit
                      </button>
                    )}

                    <button
                      onClick={() =>
                        navigate("/events/new", { state: { copy: event } })
                      }
                    >
                      Duplicate
                    </button>

                    <button
                      onClick={() =>
                        navigate(`/events/${event._id}/attendees`)
                      }
                    >
                      Attendees & check-in
                    </button>

                    {event.status === "published" && (
                      <button
                        className="danger-text"
                        onClick={() => cancelEvent(event._id)}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {events.length === 0 && (
          <div className="empty">
            <p>You have not created any events yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function EventForm({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const editing = Boolean(id);
  const location = useLocation();

  const copy = !editing ? location.state?.copy : null;

  const [form, setForm] = useState({
    title: copy?.title || "",
    description: copy?.description || "",
    venue: copy?.venue || "",
    startsAt: "",
    endsAt: "",
    capacity: copy?.capacity || 50,
    category: copy?.category || "Technology",
    imageUrl: copy?.imageUrl || "",
    repeatWeeks: 0
  });

  const [ticketing, setTicketing] = useState({
    enabled: false,
    seating: { enabled: false, rows: 5, seatsPerRow: 10 },
    tiers: [],
    offersCertificate: Boolean(copy?.offersCertificate)
  });
  const [tiersLocked, setTiersLocked] = useState(false);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (editing) {
      api.get(`/events/${id}`)
        .then(response => {
          const event = response.data;

          setForm({
            title: event.title,
            description: event.description,
            venue: event.venue,
            startsAt: toLocalInput(event.startsAt),
            endsAt: toLocalInput(event.endsAt),
            capacity: event.capacity,
            category: event.category,
            imageUrl: event.imageUrl || ""
          });

          const tiers = event.tiers || [];

          setTicketing({
            enabled: tiers.length > 0,
            seating: event.seating?.enabled
              ? { enabled: true, rows: event.seating.rows, seatsPerRow: event.seating.seatsPerRow }
              : { enabled: false, rows: 5, seatsPerRow: 10 },
            tiers: tiers.map(t => ({
              _id: t._id,
              name: t.name,
              price: t.price,
              limit: t.limit,
              rows: t.rows,
              saleEndsAt: t.saleEndsAt ? toLocalInput(t.saleEndsAt) : ""
            })),
            offersCertificate: Boolean(event.offersCertificate)
          });

          setTiersLocked(tiers.some(t => t.left < t.limit));
        })
        .catch(err =>
          setError(
            err.response?.data?.message ||
            "Could not load event."
          )
        );
    }
  }, [id]);

  function toLocalInput(value) {
    const date = new Date(value);
    const offset = date.getTimezoneOffset();

    return new Date(
      date.getTime() - offset * 60000
    ).toISOString().slice(0, 16);
  }

  function change(e) {
    setForm({
      ...form,
      [e.target.name]: e.target.value
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const start = new Date(form.startsAt);
      const end = new Date(form.endsAt);

      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        setError("Please enter a valid start and end date.");
        setLoading(false);
        return;
      }

      const payload = {
        ...form,
        startsAt: start.toISOString(),
        endsAt: end.toISOString()
      };

      if (editing) delete payload.repeatWeeks;

      payload.offersCertificate = ticketing.offersCertificate;

      if (ticketing.enabled) {
        payload.seating = ticketing.seating;
        payload.tiers = ticketing.tiers.map(t => ({
          ...(t._id ? { _id: t._id } : {}),
          name: t.name,
          price: Number(t.price),
          limit: Number(t.limit),
          rows: Number(t.rows) || 0,
          saleEndsAt: t.saleEndsAt ? new Date(t.saleEndsAt).toISOString() : null
        }));
      } else if (editing) {
        payload.tiers = [];
        payload.seating = { enabled: false, rows: 0, seatsPerRow: 0 };
      }

      if (editing) {
        await api.put(`/events/${id}`, payload);
      } else {
        await api.post("/events", payload);
      }

      navigate(user.role === "admin" ? "/admin" : "/dashboard");
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not save event."
      );
    } finally {
      setLoading(false);
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role === "organiser" && user.accountStatus === "pending") {
    return <PendingNotice />;
  }

  if (user.role !== "organiser" && user.role !== "admin") {
    return (
      <div className="alert">
        Organiser account required.
      </div>
    );
  }

  return (
    <div className="form-page">
      <form
        className="panel event-form"
        onSubmit={submit}
      >
        <div className="eyebrow">EVENT MANAGEMENT</div>

        <h2>
          {editing ? "Edit event" : "Create an event"}
        </h2>

        <p className="muted">
          Fill in the details below to publish your event.
        </p>

        <label>
          Event title
          <input
            name="title"
            value={form.title}
            onChange={change}
            required
          />
        </label>

        <label>
          Description
          <textarea
            name="description"
            value={form.description}
            onChange={change}
            rows="4"
            required
          />
        </label>

        <label>
          Venue
          <input
            name="venue"
            value={form.venue}
            onChange={change}
            required
          />
        </label>

        <div className="form-two">
          <label>
            Start date & time
            <input
              type="datetime-local"
              name="startsAt"
              value={form.startsAt}
              onChange={change}
              required
            />
          </label>

          <label>
            End date & time
            <input
              type="datetime-local"
              name="endsAt"
              value={form.endsAt}
              onChange={change}
              required
            />
          </label>
        </div>

        <TierEditor value={ticketing} onChange={setTicketing} locked={tiersLocked} />

        <div className="form-two">
          {!ticketing.enabled && (
            <label>
              Seat capacity
              <input
                type="number"
                min="1"
                name="capacity"
                value={form.capacity}
                onChange={change}
                required
              />
            </label>
          )}

          {!editing && (
            <label>
              Repeat every week for extra weeks
              <input
                type="number"
                min="0"
                max="12"
                name="repeatWeeks"
                value={form.repeatWeeks}
                onChange={change}
              />
            </label>
          )}

          <label>
            Category
            <select
              name="category"
              value={form.category}
              onChange={change}
            >
              <option>Technology</option>
              <option>Music</option>
              <option>Education</option>
              <option>Business</option>
              <option>Sports</option>
              <option>Arts</option>
              <option>Other</option>
            </select>
          </label>
        </div>

        <label>
          Image URL (optional)
          <input
            name="imageUrl"
            value={form.imageUrl}
            onChange={change}
            placeholder="https://example.com/image.jpg"
          />
        </label>

        {error && <div className="alert">{error}</div>}

        <div className="form-actions">
          <Link
            to={user.role === "admin" ? "/admin" : "/dashboard"}
            className="btn btn-light"
          >
            Back
          </Link>

          <button
            className="btn btn-primary"
            disabled={loading}
          >
            {loading
              ? "Saving..."
              : editing
                ? "Save changes"
                : "Create event"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AttendeeList({ user }) {
  const { id } = useParams();

  const [attendees, setAttendees] = useState([]);
  const [event, setEvent] = useState(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadAll();
  }, [id]);

  async function loadAll() {
    try {
      const response = await api.get(`/events/${id}/attendees`);
      setAttendees(response.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load attendees."
      );
    }

    api.get(`/events/${id}`)
      .then(response => setEvent(response.data))
      .catch(() => setEvent(null));
  }

  async function checkIn(bookingId, checkedIn = true) {
    setError("");
    setMessage("");

    try {
      const response = await api.patch(
        `/events/${id}/checkin/${bookingId}`,
        { checkedIn }
      );

      setMessage(response.data.message);

      const refreshed = await api.get(`/events/${id}/attendees`);
      setAttendees(refreshed.data);
      return true;
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not update check-in."
      );
      return false;
    }
  }

  async function submitCode(e) {
    e.preventDefault();

    const clean = code.trim().replace(/^EVT:/i, "");
    if (!clean) return;

    if (await checkIn(clean)) setCode("");
  }

  async function exportCsv() {
    try {
      const response = await api.get(`/events/${id}/attendees.csv`, {
        responseType: "blob"
      });

      saveFile(response.data, "attendees.csv");
    } catch (err) {
      setError("Could not export the attendee list.");
    }
  }

  async function postAnnouncement(e) {
    e.preventDefault();
    setError("");

    try {
      await api.post(`/events/${id}/announcements`, {
        message: announcement
      });

      setAnnouncement("");
      setNote("Announcement posted.");
      const response = await api.get(`/events/${id}`);
      setEvent(response.data);
    } catch (err) {
      setNote("");
      setError(
        err.response?.data?.message ||
        "Could not post the announcement."
      );
    }
  }

  async function removeAnnouncement(announcementId) {
    try {
      await api.delete(
        `/events/${id}/announcements/${announcementId}`
      );

      const response = await api.get(`/events/${id}`);
      setEvent(response.data);
    } catch (err) {
      setError("Could not remove the announcement.");
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role !== "organiser" && user.role !== "admin") {
    return (
      <div className="alert">
        Organiser account required.
      </div>
    );
  }

  const confirmed = attendees.filter(a => a.status === "confirmed");
  const checkedInCount = confirmed.filter(a => a.checkedInAt).length;
  const waiting = attendees.filter(a => a.status === "waitlisted").length;

  return (
    <section className="section">
      <div className="eyebrow">EVENT MANAGEMENT</div>

      <h2>{event ? event.title : "Attendees & check-in"}</h2>

      <p className="muted">
        {confirmed.length} confirmed · {checkedInCount} checked in ·{" "}
        {waiting} on the waitlist
      </p>

      {message && <div className="success">{message}</div>}
      {note && <div className="success">{note}</div>}
      {error && <div className="alert">{error}</div>}

      <LiveCounter eventId={id} />

      <div className="panel manage-box">
        <h3>Check in at the door</h3>

        <p className="muted">
          Scan the attendee's QR ticket with a scanner or paste the
          ticket code, then press Check in.
        </p>

        <form className="inline-form" onSubmit={submitCode}>
          <input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Ticket code"
            aria-label="Ticket code"
          />

          <button className="btn btn-primary">Check in</button>
        </form>
      </div>

      <div className="panel table-wrap" style={{ marginTop: 24 }}>
        <div className="table-head">
          <h3>Attendees</h3>

          <button
            type="button"
            className="btn btn-light"
            onClick={exportCsv}
          >
            Export CSV
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Ticket</th>
              <th>Booked</th>
              <th>Status</th>
              <th>Check-in</th>
            </tr>
          </thead>

          <tbody>
            {attendees.map(item => (
              <tr key={item._id}>
                <td>{item.userId?.name}</td>
                <td>{item.userId?.email}</td>
                <td>
                  {item.ticket
                    ? `${item.tierName}${item.seat ? " · " + item.seat : ""}`
                    : "—"}
                </td>
                <td>
                  {new Date(item.createdAt).toLocaleDateString()}
                </td>
                <td>
                  <span className={`status ${item.status}`}>
                    {item.status}
                  </span>
                </td>
                <td>
                  {item.status === "confirmed" && (
                    item.checkedInAt ? (
                      <div className="table-actions">
                        <span className="status confirmed">
                          ✓ {new Date(item.checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <button
                          onClick={() => checkIn(item._id, false)}
                        >
                          Undo
                        </button>
                      </div>
                    ) : (
                      <div className="table-actions">
                        <button onClick={() => checkIn(item._id)}>
                          Check in
                        </button>
                      </div>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {attendees.length === 0 && (
          <div className="empty">
            <p>No bookings yet.</p>
          </div>
        )}
      </div>

      {event && (
        <div className="panel manage-box" style={{ marginTop: 24 }}>
          <h3>Announcements</h3>

          <p className="muted">
            Everyone who opens the event page will see these updates.
          </p>

          <form onSubmit={postAnnouncement}>
            <textarea
              value={announcement}
              onChange={e => setAnnouncement(e.target.value)}
              rows="3"
              maxLength="500"
              placeholder="For example: Doors open at 6 PM."
              required
            />

            <button
              className="btn btn-primary"
              style={{ marginTop: 10 }}
            >
              Post announcement
            </button>
          </form>

          {[...(event.announcements || [])].reverse().map(a => (
            <div className="announcement" key={a._id}>
              <p>{a.message}</p>
              <small>{new Date(a.createdAt).toLocaleString()}</small>
              <button
                type="button"
                className="link-danger"
                onClick={() => removeAnnouncement(a._id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <Link
        className="btn btn-light"
        to={user.role === "admin" ? "/admin" : "/dashboard"}
        style={{ marginTop: 20 }}
      >
        {user.role === "admin" ? "Back to admin panel" : "Back to dashboard"}
      </Link>
    </section>
  );
}

function SavedPage({ user }) {
  const [events, setEvents] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.role === "attendee") load();
  }, [user]);

  async function load() {
    try {
      const response = await api.get("/saved");
      setEvents(response.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load your saved events."
      );
    } finally {
      setLoaded(true);
    }
  }

  async function remove(eventId) {
    try {
      await api.delete(`/saved/${eventId}`);
      setEvents(current => current.filter(e => e._id !== eventId));
    } catch (err) {
      setError("Could not remove the event.");
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role !== "attendee") {
    return <div className="alert">Attendee account required.</div>;
  }

  return (
    <section className="section">
      <div className="eyebrow">YOUR LIST</div>
      <h2>Saved events</h2>
      <p className="muted">Events you want to come back to.</p>

      {error && <div className="alert">{error}</div>}

      <div className="event-grid">
        {events.map(event => (
          <div key={event._id}>
            <EventCard event={event} />

            <button
              type="button"
              className="btn btn-light"
              style={{ marginTop: 8 }}
              onClick={() => remove(event._id)}
            >
              ♥ Remove from saved
            </button>
          </div>
        ))}
      </div>

      {loaded && events.length === 0 && !error && (
        <div className="empty">
          <div className="empty-icon">♡</div>
          <h3>Nothing saved yet</h3>
          <p>Open an event and press "Save for later".</p>

          <Link className="btn btn-primary" to="/">
            Explore events
          </Link>
        </div>
      )}
    </section>
  );
}

function PendingNotice() {
  return (
    <div className="empty">
      <div className="empty-icon">⏳</div>
      <h3>Waiting for admin approval</h3>
      <p>
        Your organiser account has been created. An admin needs to
        approve it before you can create events. Please check back soon.
      </p>

      <Link className="btn btn-primary" to="/">
        Explore events
      </Link>
    </div>
  );
}

function AdminPage({ user }) {
  const [tab, setTab] = useState("organisers");
  const [overview, setOverview] = useState(null);
  const [organisers, setOrganisers] = useState([]);
  const [events, setEvents] = useState([]);
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user]);

  async function load() {
    try {
      const [o, org, ev, us] = await Promise.all([
        api.get("/admin/overview"),
        api.get("/admin/organisers"),
        api.get("/admin/events"),
        api.get("/admin/users")
      ]);

      setOverview(o.data);
      setOrganisers(org.data);
      setEvents(ev.data);
      setUsers(us.data);
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not load the admin data."
      );
    }
  }

  async function setStatus(organiser, status) {
    if (
      status === "rejected" &&
      !window.confirm(
        `Reject ${organiser.name}? Their events and all bookings on them will be cancelled.`
      )
    ) {
      return;
    }

    try {
      await api.patch(`/admin/organisers/${organiser._id}`, { status });
      setError("");
      setMessage(`${organiser.name} is now ${status}.`);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not update the organiser."
      );
    }
  }

  async function cancelEvent(event) {
    if (
      !window.confirm(
        `Cancel "${event.title}"? All bookings on it will be cancelled.`
      )
    ) {
      return;
    }

    try {
      await api.patch(`/admin/events/${event._id}/cancel`);
      setError("");
      setMessage(`"${event.title}" was cancelled.`);
      load();
    } catch (err) {
      setError(
        err.response?.data?.message ||
        "Could not cancel the event."
      );
    }
  }

  if (!user) return <LoginPrompt />;

  if (user.role !== "admin") {
    return <div className="alert">Admin account required.</div>;
  }

  const pending = organisers.filter(o => o.accountStatus === "pending");

  return (
    <section className="section">
      <div className="eyebrow">ADMINISTRATION</div>
      <h2>Admin panel</h2>
      <p className="muted">
        Approve organisers and keep an eye on events and accounts.
      </p>

      {message && <div className="success">{message}</div>}
      {error && <div className="alert">{error}</div>}

      {overview && (
        <div className="stats-grid four">
          <div className="stat panel">
            <span>Pending organisers</span>
            <strong>{overview.pendingOrganisers}</strong>
          </div>

          <div className="stat panel">
            <span>Organisers</span>
            <strong>{overview.organisers}</strong>
          </div>

          <div className="stat panel">
            <span>Attendees</span>
            <strong>{overview.attendees}</strong>
          </div>

          <div className="stat panel">
            <span>Active events</span>
            <strong>{overview.publishedEvents}</strong>
          </div>
        </div>
      )}

      <div className="tabs">
        {[
          ["organisers", `Organisers${pending.length ? ` (${pending.length} pending)` : ""}`],
          ["events", "Events"],
          ["users", "All users"]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "tab active" : "tab"}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="panel table-wrap">
        {tab === "organisers" && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Events</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {[...organisers]
                .sort(
                  (a, b) =>
                    (b.accountStatus === "pending") -
                    (a.accountStatus === "pending")
                )
                .map(o => (
                  <tr key={o._id}>
                    <td>{o.name}</td>
                    <td>{o.email}</td>
                    <td>{o.eventCount}</td>
                    <td>
                      <span className={`status ${o.accountStatus}`}>
                        {o.accountStatus}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        {o.accountStatus !== "approved" && (
                          <button onClick={() => setStatus(o, "approved")}>
                            Approve
                          </button>
                        )}

                        {o.accountStatus !== "rejected" && (
                          <button
                            className="danger-text"
                            onClick={() => setStatus(o, "rejected")}
                          >
                            Reject
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}

        {tab === "events" && (
          <>
          <div style={{ marginBottom: 14 }}>
            <Link className="btn btn-primary" to="/events/new">+ Create event</Link>
          </div>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Organiser</th>
                <th>Date</th>
                <th>Seats</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {events.map(event => (
                <tr key={event._id}>
                  <td>
                    <strong>{event.title}</strong>
                    <small>{event.venue}</small>
                  </td>
                  <td>{event.organiserId?.name}</td>
                  <td>{new Date(event.startsAt).toLocaleDateString()}</td>
                  <td>{event.seatsBooked} / {event.capacity}</td>
                  <td>
                    <span className={`status ${event.status}`}>
                      {event.status}
                    </span>
                  </td>
                  <td>
                    {event.status === "published" && (
                      <div className="table-actions">
                        <Link className="text-link" to={`/events/${event._id}/edit`}>Edit</Link>
                        <Link className="text-link" to={`/events/${event._id}/attendees`}>Attendees</Link>
                        <button
                          className="danger-text"
                          onClick={() => cancelEvent(event)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}

        {tab === "users" && (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>

            <tbody>
              {users.map(u => (
                <tr key={u._id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td style={{ textTransform: "capitalize" }}>{u.role}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "organisers" && organisers.length === 0 && (
          <div className="empty"><p>No organisers yet.</p></div>
        )}
      </div>
    </section>
  );
}

function LoginPrompt() {
  return (
    <div className="empty">
      <h3>Please log in first</h3>

      <p>
        You need an account to access this page.
      </p>

      <Link
        className="btn btn-primary"
        to="/login"
      >
        Go to login
      </Link>
    </div>
  );
}

export default App;