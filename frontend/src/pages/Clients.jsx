import React, { useEffect, useState } from 'react';
import { getMyClients, createPayment } from '../services_api.js';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('token');

  useEffect(() => {
    async function load() {
      try {
        const data = await getMyClients(token);
        setClients(data);
      } catch(e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  async function pay(c) {
    const amount = Number(prompt(`Monto para ${c.name}`));
    if (!amount || amount <= 0) return;
    const payload = { client_uuid: c.uuid, amount, device_local_ts: new Date().toISOString() };
    try {
      const result = await createPayment(token, payload);
      alert(`Pago registrado. Folio: ${result.ticket_folio}`);
    } catch(e) {
      alert('Error al registrar pago');
    }
  }

  if (loading) return <p>Cargando...</p>;
  return (
    <div style={{ maxWidth: 640, margin: '20px auto', fontFamily: 'system-ui' }}>
      <h2>Mis clientes</h2>
      <ul>
        {clients.map(c => (
          <li key={c.uuid} style={{ display: 'flex', justifyContent: 'space-between', margin: '8px 0' }}>
            <span>{c.name} — Contrato {c.contract_number}</span>
            <button onClick={() => pay(c)}>Registrar pago</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
