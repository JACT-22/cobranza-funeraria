import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const app = express();

// habilita CORS solo para el frontend local
app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z'
});

const signToken = (user) => {
  return jwt.sign({ sub: user.uuid, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: '2h' });
};

const authMiddleware = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing token' }});
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' }});
  }
};

const loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(3)
});

const paymentSchema = z.object({
  client_uuid: z.string().uuid(),
  amount: z.number().positive(),
  notes: z.string().optional(),
  device_local_ts: z.string()
});

app.post('/api/v1/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid credentials payload' }});
  const { username, password } = parsed.data;
  const [rows] = await pool.query('SELECT * FROM users WHERE username=? AND active=1 LIMIT 1', [username]);
  if (!rows.length) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' }});
  const u = rows[0];
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' }});
  const token = signToken(u);
  return res.json({ access_token: token, user: { uuid: u.uuid, role: u.role, name: u.name } });
});

app.get('/api/v1/clients', authMiddleware, async (req, res) => {
  const mine = req.query.mine === 'true';
  let sql = 'SELECT c.* FROM clients c';
  let params = [];
  if (mine) {
    sql += ' JOIN users u ON u.id = c.collector_id WHERE u.uuid = ?';
    params.push(req.user.sub);
  }
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

app.post('/api/v1/payments', authMiddleware, async (req, res) => {
  const idk = req.headers['idempotency-key'];
  if (!idk) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Missing Idempotency-Key header' }});
  const parse = paymentSchema.safeParse({
    ...req.body,
    amount: typeof req.body.amount === 'number' ? req.body.amount : Number(req.body.amount)
  });
  if (!parse.success) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid payment payload' }});

  const { client_uuid, amount, notes, device_local_ts } = parse.data;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Ensure series 'A'
    const [cfgRows] = await conn.query('SELECT * FROM tickets_config WHERE series = ? FOR UPDATE', ['A']);
    if (!cfgRows.length) {
      await conn.query('INSERT INTO tickets_config (uuid, series, current_number, header_name, created_at, updated_at) VALUES (?,?,?,?,NOW(6),NOW(6))',
        [uuidv4(), 'A', 0, 'Tu Funeraria']);
    }
    const [cfgRows2] = await conn.query('SELECT * FROM tickets_config WHERE series = ? FOR UPDATE', ['A']);
    const cfg = cfgRows2[0];
    const nextNumber = Number(cfg.current_number) + 1;
    await conn.query('UPDATE tickets_config SET current_number = ?, updated_at=NOW(6) WHERE id=?', [nextNumber, cfg.id]);

    const [cRows] = await conn.query('SELECT c.*, u.id as collector_user_id FROM clients c JOIN users u ON u.id=c.collector_id WHERE c.uuid=? LIMIT 1', [client_uuid]);
    if (!cRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Client not found' }});
    }
    const client = cRows[0];

    // try to insert payment with unique idempotency_key
    const payment_uuid = uuidv4();
    await conn.query(
      'INSERT INTO payments (uuid, client_id, collector_id, amount, notes, device_local_ts, server_ts, ticket_series, ticket_number, sync_state, origin, idempotency_key, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NOW(6),NOW(6))',
      [payment_uuid, client.id, client.collector_id, amount, notes || null, new Date(device_local_ts), new Date(), 'A', nextNumber, 'SYNCED', 'APP', idk]
    );
    await conn.commit();
    return res.json({ payment_uuid, ticket_folio: `A-${nextNumber}` });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      await conn.rollback();
      // Retrieve existing payment by idempotency_key
      const [pRows] = await pool.query('SELECT uuid, ticket_series, ticket_number FROM payments WHERE idempotency_key=? LIMIT 1', [idk]);
      if (pRows.length) {
        const p = pRows[0];
        return res.status(200).json({ payment_uuid: p.uuid, ticket_folio: `${p.ticket_series}-${p.ticket_number}` });
      }
      return res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate request' }});
    }
    try { await conn.rollback(); } catch {}
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected error' }});
  } finally {
    conn.release();
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
