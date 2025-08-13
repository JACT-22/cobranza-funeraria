# MVP Cobranza Backend (Day 1)
1) Copia `.env.sample` a `.env` y ajusta credenciales MySQL.
2) Crea la base de datos `cobranza` y ejecuta `sql/ddl.sql`.
3) Instala dependencias: `npm install`.
4) Arranca: `npm run dev` (por defecto en puerto 8080).

Endpoints básicos (v1):
- POST /api/v1/auth/login
- GET  /api/v1/clients?mine=true
- POST /api/v1/payments  (requiere header `Idempotency-Key`)

Notas:
- Timestamps en UTC.
- Folios con serie 'A' para MVP.
- Validación con Zod.
