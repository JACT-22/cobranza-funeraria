// backend/src/routes/payments.js
import { Router } from 'express';
import open from 'open';

const router = Router();

/**
 * POST /api/v1/payments
 * Registra un pago y abre automáticamente la impresión del ticket
 */
router.post('/', async (req, res, next) => {
  const t0 = Date.now();
  try {
    const pool = req.app.get('db');
    const { ticket_series, client_id, collector_id, amount } = req.body;

    // Validar campos requeridos
    if (!ticket_series || !client_id || !collector_id || !amount) {
      return res.status(400).json({ error: 'Faltan campos requeridos' });
    }

    // 1) Obtener el último folio usado en esa serie
    const [[lastFolio]] = await pool.query(
      `SELECT MAX(ticket_number) AS last_num
       FROM payments
       WHERE ticket_series = ?`,
      [ticket_series]
    );
    const nextFolio = (lastFolio?.last_num || 0) + 1;

    // 2) Insertar el pago
    await pool.query(
      `INSERT INTO payments
       (ticket_series, ticket_number, client_id, collector_id, amount, server_ts)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [ticket_series, nextFolio, client_id, collector_id, amount]
    );

    // 3) Generar URL para imprimir
    const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
    const printUrl = `${baseUrl}/api/v1/tickets/folio/${ticket_series}/${nextFolio}/print`;

    // 4) Abrir navegador automáticamente
    await open(printUrl);

    console.log(`[payments] Pago registrado ${ticket_series}-${nextFolio} e impresión enviada en ${Date.now() - t0} ms`);

    res.status(201).json({
      success: true,
      ticket_series,
      ticket_number: nextFolio,
      print_url: printUrl
    });

  } catch (err) {
    console.error('[payments] ERROR:', err);
    next(err);
  }
});

export default router;
