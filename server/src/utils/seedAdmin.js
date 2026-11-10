import bcrypt from 'bcryptjs';
import User from '../models/User.js';

// Creates the one static admin account from ADMIN_EMAIL / ADMIN_PASSWORD in .env.
// The .env file is the source of truth: if the password there changes, the admin's password is updated on the next start.
export async function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) { console.log('No ADMIN_EMAIL / ADMIN_PASSWORD in .env, so no admin account was created.'); return; }
  if (password.length < 8) { console.log('ADMIN_PASSWORD must be at least 8 characters. Admin account not created.'); return; }
  const existing = await User.findOne({ email });
  if (existing && existing.role !== 'admin') { console.log('ADMIN_EMAIL belongs to a normal account. Use a different email for the admin.'); return; }
  if (existing) {
    if (!(await bcrypt.compare(password, existing.passwordHash))) {
      existing.passwordHash = await bcrypt.hash(password, 12);
      await existing.save();
      console.log('Admin password updated from .env.');
    }
    return;
  }
  const wanted = (process.env.ADMIN_NAME || 'Admin').trim();
  // Names must be unique, so fall back to a different name if "Admin" is already taken by a normal user.
  const taken = await User.findOne({ name: wanted }).collation({ locale: 'en', strength: 2 });
  await User.create({ name: taken ? 'Site Admin' : wanted, email, passwordHash: await bcrypt.hash(password, 12), role: 'admin', accountStatus: 'approved' });
  console.log('Admin account created: ' + email);
}
