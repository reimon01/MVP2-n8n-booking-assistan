# Guía de nodos n8n — VIDA v2.0

El workflow `workflows/inbound-whatsapp.json` es el esqueleto. La lógica
determinística vive en `src/lib/` (fuente de verdad, con tests). Hay dos formas
de desplegarla en n8n; elige según tu comodidad operativa.

## Opción A — Microservicio mínimo (recomendada)

Envuelve `processInbound()` en un endpoint HTTP y haz que n8n lo llame con un
nodo **HTTP Request**. Mantiene toda la lógica testeada en un solo lugar.

```js
// server.js (Node 20+)
import http from "node:http";
import pg from "pg";
import { processInbound } from "./src/lib/orchestrator.js";
import { OpenAiLlm } from "./src/lib/llmClient.js"; // tu cliente LLM

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const llm = new OpenAiLlm();

http.createServer(async (req, res) => {
  if (req.method !== "POST") return res.writeHead(405).end();
  let body = "";
  for await (const c of req) body += c;
  try {
    const msg = JSON.parse(body);
    const out = await processInbound(pool, msg, { llm });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: String(e) }));
  }
}).listen(3001);
```

Flujo n8n: **Webhook → Code (normalizar) → HTTP Request (POST /process) →
Respond**. El LLM y Postgres quedan dentro del servicio.

## Opción B — Nodos nativos de n8n (sin backend)

Construye el grafo con nodos Postgres + Code + el nodo del LLM. SQL exacto de
cada paso (derivado de `src/lib/dbOps.js`):

### Idempotencia + sesión

```sql
-- Cargar sesión (crea si no existe lo maneja el upsert al guardar)
SELECT * FROM sessions WHERE tenant_id = $1 AND customer_id = $2;
```
En un Code node, revisa `context.processedMessageIds.includes(messageId)`; si
está, termina. Si no, añádelo (cap 50).

### Cliente

```sql
SELECT * FROM customers WHERE tenant_id = $1 AND phone = $2;
INSERT INTO customers (tenant_id, phone, name) VALUES ($1, $2, $3) RETURNING *;
```

### Catálogo / FAQ

```sql
SELECT * FROM services WHERE tenant_id = $1 AND active = true ORDER BY name;
SELECT * FROM business_hours WHERE tenant_id = $1;
```

### getAvailability

```sql
-- 1) duración del servicio
SELECT * FROM services WHERE tenant_id = $1 AND id = $2 AND active = true;
-- 2) horario del día (day_of_week 0=Dom..6=Sáb)
SELECT * FROM business_hours WHERE tenant_id = $1 AND day_of_week = $2;
-- 3) citas CONFIRMED que cruzan el día
SELECT starts_at, ends_at FROM appointments
 WHERE tenant_id = $1 AND status = 'CONFIRMED'
   AND starts_at < $dayEnd AND ends_at > $dayStart;
```
Genera los slots en un Code node con `generateSlots()` de `src/lib/availability.js`.

### createAppointment (atómico, anti-overbooking)

```sql
INSERT INTO appointments (tenant_id, customer_id, service_id, starts_at, ends_at, status)
SELECT $1, $2, $3, $4, $5, 'CONFIRMED'
WHERE NOT EXISTS (
  SELECT 1 FROM appointments a
   WHERE a.tenant_id = $1 AND a.status = 'CONFIRMED'
     AND a.starts_at < $5 AND a.ends_at > $4
)
RETURNING *;
```
0 filas ⇒ `SLOT_NOT_AVAILABLE`. La restricción `appointments_no_overlap`
(EXCLUDE) respalda la concurrencia: si la consulta devuelve filas pero la
constraint lanza `23P01`, trátalo también como `SLOT_NOT_AVAILABLE`.

### cancelAppointment

```sql
UPDATE appointments SET status = 'CANCELLED', updated_at = now()
 WHERE id = $1 AND tenant_id = $2 AND customer_id = $3 RETURNING *;
```

### rescheduleAppointment (UPDATE de la misma cita)

```sql
UPDATE appointments
   SET starts_at = $2, ends_at = $3, updated_at = now()
 WHERE id = $1 AND status = 'CONFIRMED'
   AND NOT EXISTS (
     SELECT 1 FROM appointments a
      WHERE a.tenant_id = $4 AND a.id <> $1 AND a.status = 'CONFIRMED'
        AND a.starts_at < $3 AND a.ends_at > $2
   )
RETURNING *;
```

### Guardar sesión

```sql
INSERT INTO sessions (tenant_id, customer_id, context, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (tenant_id, customer_id)
DO UPDATE SET context = EXCLUDED.context, updated_at = now();
```

## LLM

System prompt en `llm/system-prompt.md`, JSON Schema en `llm/schema.json`.
El nodo del LLM recibe el input del Documento 3 §7 y devuelve solo JSON. Valida
siempre con `parseLlmOutput()` (`src/lib/llm.js`) antes de usarlo.
