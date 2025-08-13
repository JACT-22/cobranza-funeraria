import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../services_api.js';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    try {
      const data = await login(username, password);
      localStorage.setItem('token', data.access_token);
      navigate('/clients');
    } catch (e) {
      setError('Credenciales inválidas');
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h2>Iniciar sesión</h2>
      <form onSubmit={handleSubmit}>
        <label>Usuario</label>
        <input value={username} onChange={e=>setUsername(e.target.value)} required />
        <label>Contraseña</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button type="submit">Entrar</button>
      </form>
      {error && <p style={{color:'red'}}>{error}</p>}
    </div>
  );
}
