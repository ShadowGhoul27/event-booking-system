import mongoose from "mongoose";

// Connect the project to MongoDB.
export async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("MongoDB connected successfully.");
}
