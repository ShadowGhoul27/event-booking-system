import mongoose from 'mongoose';
const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  message: { type: String, required: true },
  link: { type: String, default: '' },
  readAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});
export default mongoose.model('Notification', notificationSchema);
