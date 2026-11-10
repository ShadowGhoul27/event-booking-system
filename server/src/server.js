import "dotenv/config";
import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import eventRoutes from "./routes/events.js";
import bookingRoutes from "./routes/bookings.js";
import savedRoutes from "./routes/saved.js";
import adminRoutes from "./routes/admin.js";
import notificationRoutes from "./routes/notifications.js";
import reviewRoutes from "./routes/reviews.js";
import ticketRoutes from "./routes/tickets.js";
import certificateRoutes from "./routes/certificates.js";
import { startHoldCleaner } from "./utils/ticketing.js";
import { seedAdmin } from "./utils/seedAdmin.js";

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/saved", savedRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/certificates", certificateRoutes);

app.use((error, req, res, next) => {
  if (error.name === "CastError") return res.status(404).json({ message: "Not found." });
  if (error.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid request." });
  if (error.name === "ValidationError") return res.status(400).json({ message: "Please check the details you entered." });
  console.error(error);
  res.status(500).json({ message: "Server error." });
});

const PORT = process.env.PORT || 5000;

connectDB()
  .then(async () => {
    await seedAdmin();
    startHoldCleaner();
    app.listen(PORT, () => {
      console.log("Server is running on http://localhost:" + PORT);
    });
  })
  .catch((error) => {
    console.log("MongoDB connection failed:", error.message);
    process.exit(1);
  });
