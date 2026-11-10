import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function protect(req, res, next) {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Please log in first." });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select("-passwordHash");

    if (!req.user) {
      return res.status(401).json({ message: "Account not found." });
    }

    if (req.user.accountStatus === "rejected") {
      return res.status(401).json({ message: "Your organiser account was not approved." });
    }

    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired session." });
  }
}

export const allow = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "You do not have permission." });
    }

    if (req.user.role === "organiser" && req.user.accountStatus !== "approved") {
      return res.status(403).json({ message: "Your organiser account is waiting for admin approval." });
    }

    next();
  };
};
