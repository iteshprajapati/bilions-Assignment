import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = express.Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' });
    }

    const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { sub: user.id, orgId: user.org_id, role: user.role },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, orgId: user.org_id },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/invite/create', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const rows = await query('SELECT id FROM users WHERE id = ? AND org_id = ?', [userId, req.user.orgId]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    const inviteToken = jwt.sign(
      { purpose: 'invite', sub: userId },
      config.jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({ inviteToken });
  } catch (err) {
    next(err);
  }
});

router.post('/invite/accept', async (req, res, next) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: 'token and password are required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired invite token' });
    }

    if (payload.purpose !== 'invite') {
      return res.status(401).json({ error: 'Invalid token purpose' });
    }

    const userId = payload.sub;
    const hash = await bcrypt.hash(password, 12);
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
