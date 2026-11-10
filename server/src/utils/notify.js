import Notification from '../models/Notification.js';

// Sends an in-app notification to one user or a list of users. A failure here must never break the real action.
export async function notify(users, message, link = '') {
  try {
    const ids = [...new Set((Array.isArray(users) ? users : [users]).filter(Boolean).map(String))];
    if (!ids.length) return;
    await Notification.insertMany(ids.map(userId => ({ userId, message, link })));
  } catch (e) { console.error('Notification failed:', e.message); }
}
