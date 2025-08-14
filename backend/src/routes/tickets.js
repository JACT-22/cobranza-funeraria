
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import dayjs from 'dayjs';
import fs from 'fs';
import path from 'path';

const PAGE_WIDTH = 226.77;   // Aprox 80 mm en puntos
const MARGIN     = 10;
const CONTENT_W  = PAGE_WIDTH - 2 * MARGIN;

// función para separador ancho completo
function hr(doc) {
  const y = doc.y + 2;
  doc.moveTo(MARGIN, y)
     .lineTo(MARGIN + CONTENT_W, y)
     .lineWidth(0.7)
     .stroke();
  doc.moveDown(0.6); // antes estaba en 0.25
}

const router = Router();

/** Utilidad: elige el primer campo existente con valor válido */
function pick(obj, keys, fallback = '') {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k) && obj[k] != null && obj[k] !== '') {
      return obj[k];
    }
  }
  return fallback;
}

/** Convierte "\n" literales a saltos reales y limpia espacios */
function norm(s) {
  return (s || '').toString().replaceAll('\\n', '\n').trim();
}

/**
 * GET /api/v1/tickets/folio/:series/:number/pdf
 */
router.get('/folio/:series/:number/pdf', async (req, res, next) => {
  const t0 = Date.now();
  try {
    const pool = req.app.get('db');
    const { series, number } = req.params;
    const folioNum = Number(number);

    // 1) Pago por serie/folio
    const [payRows] = await pool.query(
      `SELECT * FROM payments WHERE ticket_series = ? AND ticket_number = ? LIMIT 1`,
      [series, folioNum]
    );
    if (!payRows.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ticket no encontrado' }});
    }
    const pay = payRows[0];

    // 2) Cliente y cobrador
    const [[client]] = await pool.query(`SELECT * FROM clients WHERE id = ? LIMIT 1`, [pay.client_id]);
    const [[user]]   = await pool.query(`SELECT * FROM users   WHERE id = ? LIMIT 1`, [pay.collector_id]);

    // 3) Config de encabezado
    const [[cfg]] = await pool.query(
      `SELECT header_name, header_rfc, header_address, header_phone, footer_legend
         FROM tickets_config
        WHERE series = ? LIMIT 1`,
      [pay.ticket_series]
    );

    // 4) Normaliza campos
    const clienteNombre = pick(client, ['name'], '');
    const clienteRFC    = ''; // no existe en clients
    const cobrador      = pick(user, ['name', 'username'], 'cobrador');

    const headerName    = norm(pick(cfg, ['header_name'], 'FUNERALES CÁRDENAS'));
    const headerWeb     = norm(pick(cfg, ['header_rfc'], ''));        // lo usamos como sitio web
    const headerAddress = norm(pick(cfg, ['header_address'], ''));    // puede traer \n
    const headerPhone   = norm(pick(cfg, ['header_phone'], ''));
    const footerLegend  = norm(pick(cfg, ['footer_legend'], 'Gracias por su preferencia'));

    const amount = Number(pay.amount);
    const ticket = {
      serie: pay.ticket_series,
      folio: String(pay.ticket_number).padStart(6, '0'),
      fecha: pay.server_ts,
      cobrador,
      clienteNombre,
      clienteRFC,
      conceptos: [{ concepto: 'Abono', importe: amount }],
      subtotal: amount,
      impuestos: { total: 0 },
      total: amount,
      formaPago: 'Efectivo'
    };

    // 5) Cabeceras PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="ticket-${ticket.serie}-${ticket.folio}.pdf"`);
    res.setHeader('Content-Encoding', 'identity');

    // 6) Documento tamaño ticket (~80mm de ancho)
    const doc = new PDFDocument({ size: [226.77, 600], margin: 10 });
    doc.pipe(res);

    // 6.1) Logo centrado (si existe)
    try {
      const logoPath = path.resolve('assets/logo_ticket.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, {
          fit: [200, 110], // se ve bien con tu 384x192; ajusta si quieres
          align: 'center',
          valign: 'top'
        });
        doc.moveDown(0.2);
      }
    } catch (e) {
      console.warn('[ticket pdf] logo no cargado:', e?.message);
    }

    // 7) Encabezado en varias líneas (web → tel → dirección)
    doc.fontSize(10).text(headerName, { align: 'center' });
    doc.fontSize(8);
    if (headerWeb)   doc.text(headerWeb,   { align: 'center' });
    if (headerPhone) doc.text(`Tel: ${headerPhone}`, { align: 'center' });
    if (headerAddress) {
      // forzamos salto de línea después del teléfono; headerAddress puede tener \n internos
      doc.text(headerAddress, { align: 'center' });
    }

    doc.moveDown(0.3); // menos espacio para optimizar largo

    // 8) Datos del ticket
    doc.text(`Serie/Folio: ${ticket.serie}-${ticket.folio}`);
    doc.text(`Fecha: ${dayjs(ticket.fecha).format('YYYY-MM-DD HH:mm')}`);
    doc.text(`Cobrador: ${ticket.cobrador}`);

    doc.moveDown(0.3);
    if (ticket.clienteNombre) doc.text(`Cliente: ${ticket.clienteNombre}`);
    if (ticket.clienteRFC)    doc.text(`RFC: ${ticket.clienteRFC}`);

    doc.moveDown(0.3);
    hr(doc);

    // 9) Conceptos alineados
    ticket.conceptos.forEach((it) => {
      const izq = (it.concepto || '').toString();
      const der = (it.importe ?? 0).toFixed(2);
      doc.text(izq, { width: 180, continued: true });
      doc.text(der, { align: 'right' });
    });

    hr(doc);
    doc.text(`Subtotal: ${ticket.subtotal.toFixed(2)}`, { align: 'right' });
    doc.text(`Total: ${ticket.total.toFixed(2)}`, { align: 'right' });

    doc.moveDown(0.3);
    doc.text(`Forma de pago: ${ticket.formaPago}`);
    doc.moveDown(0.4);
    doc.text(footerLegend, { align: 'center' });

    doc.end();

    console.log(`[ticket pdf] ${ticket.serie}-${folioNum} OK en ${Date.now() - t0} ms`);
  } catch (err) {
    console.error('[ticket pdf] ERROR:', {
      message: err?.message,
      code: err?.code,
      errno: err?.errno,
      sqlMessage: err?.sqlMessage,
      sql: err?.sql
    });
    next(err);
  }
});

/**
 * GET /api/v1/tickets/folio/:series/:number/print
 */
router.get('/folio/:series/:number/print', (req, res) => {
  const { series, number } = req.params;
  const pdfUrl = `/api/v1/tickets/folio/${series}/${number}/pdf`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Imprimiendo ticket ${series}-${number}</title>
  <style>
    html,body { height:100%; margin:0; }
    iframe { width:100%; height:100%; border:0; }
  </style>
</head>
<body>
  <iframe id="pdf" src="${pdfUrl}" onload="
    setTimeout(() => {
      try { window.frames[0].focus(); } catch(e) {}
      window.print();
      setTimeout(() => { window.close(); }, 1500);
    }, 350);
  "></iframe>
</body>
</html>`);
});

export default router;