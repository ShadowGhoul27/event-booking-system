import mongoose from 'mongoose';
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['attendee', 'organiser', 'admin'], required: true },
  // Organisers start as 'pending' until an admin approves them. Older accounts without this field count as approved.
  accountStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
  // Categories an attendee likes (used for the "For You" recommendations).
  // Events the attendee saved for later.
  savedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
  interests: { type: [String], enum: ['Technology','Music','Education','Business','Sports','Arts','Other'], default: [] }
}, { timestamps: true });
// One account per name, ignoring upper/lower case.
userSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export default mongoose.model('User', userSchema);
