const BASE_URL = import.meta.env.VITE_API_BASE || 'http://localhost:8080';

export async function login(username, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!res.ok) throw new Error('Login failed');
  return res.json();
}

export async function getMyClients(token) {
  const res = await fetch(`${BASE_URL}/clients?mine=true`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error('Fetch clients failed');
  return res.json();
}

export async function createPayment(token, payload) {
  const res = await fetch(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Idempotency-Key': crypto.randomUUID()
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('Create payment failed');
  return res.json();
}
