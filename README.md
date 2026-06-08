# VIDA v2.0 — Asistente de reservas (n8n)

Versión **simplificada** del asistente de reservas por WhatsApp, pensada para
operar con **5–15 clientes** vía **n8n**, sin backend propio complejo. Reconstruida
desde cero según los documentos v2.0 (Scope Reset, n8n Workflow Spec, Data Model +
LLM Contract).

No es un SaaS: el objetivo es **vender rápido, operar simple y aprender**.

## Qué cambió respecto a la v1

| Eliminado | En su lugar |
|---|---|
| Múltiples servicios por cita, `appointment_services` | 1 cita = 1 servicio (`service_id`) |
| `availability_blocks` | Disponibilidad = `business_hours − appointments CONFIRMED` |
| Conversation Engine, `conversations`, `messages` | Tabla `sessions` (`context JSONB`) |
| Reagendar creando cita nueva | Reagendar = `UPDATE` de la misma cita |
| `COMPLETED`/`NO_SHOW`, timeout 30 min | Solo `CONFIRMED`/`CANCELLED` |
| Backend Node/Drizzle/OpenAPI obligatorio | n8n + lógica JS en `src/lib` |
| `staff` obligatorio | Sin staff (un profesional) |
| 10 tablas | **6 tablas** |

## Estructura

```
MVP2/
├── db/
│   ├── schema.sql        6 tablas + índices + EXCLUDE anti-overbooking
│   └── seed.sql          datos demo (1 salón, 1 profesional)
├── src/lib/              lógica determinística (fuente de verdad, testeable)
│   ├── time.js           UTC ↔ tenant.timezone
│   ├── availability.js   generateSlots() (puro)
│   ├── session.js        contexto + siguiente paso
│   ├── selection.js      "1"/"la primera"/"10:00" → slot
│   ├── confirmation.js   sí/no
│   ├── llm.js            contrato, prompt, validación
│   ├── responses.js      textos en español
│   ├── dbOps.js          operaciones Postgres (atómicas)
│   └── orchestrator.js   pipeline completo (ramas A–D)
├── llm/
│   ├── system-prompt.md  prompt para el nodo del LLM
│   └── schema.json       JSON Schema del output
├── n8n/
│   ├── workflows/inbound-whatsapp.json   workflow importable (esqueleto)
│   └── README-nodes.md   SQL/lógica exacta de cada nodo (2 opciones de deploy)
├── scripts/db-setup.js   aplica schema + seed
└── tests/                unitarios + integración + e2e (PostgreSQL real)
```

## Modelo de datos (6 tablas)

`tenants · customers · services · appointments · business_hours · sessions`

- Todo en **UTC**; se muestra en `tenant.timezone`.
- `appointments` tiene **un** `service_id` y estado `CONFIRMED`/`CANCELLED`.
- Restricción `appointments_no_overlap` (EXCLUDE con `btree_gist`): la base
  impide dos citas CONFIRMED del mismo tenant que se solapen → anti-overbooking.
- `sessions` guarda el contexto conversacional en `context JSONB`
  (incluye `processedMessageIds` para idempotencia).

## Puesta en marcha (lógica + base)

```bash
npm install
cp .env.example .env          # edita DATABASE_URL, OPENAI_API_KEY, WhatsApp...
npm run db:setup              # aplica db/schema.sql + db/seed.sql
```

## Despliegue en n8n

Importa `n8n/workflows/inbound-whatsapp.json` y sigue `n8n/README-nodes.md`,
que documenta **dos opciones**:

- **A (recomendada):** envolver `processInbound()` en un microservicio HTTP
  mínimo y llamarlo desde un nodo HTTP Request. Toda la lógica testeada en un
  solo lugar.
- **B:** construir el grafo con nodos Postgres + Code nativos (incluye el SQL
  exacto de cada paso, derivado de `src/lib/dbOps.js`).

El prompt y el JSON Schema del LLM están en `llm/`.

## Tests

```bash
# Base de pruebas (Docker; reutiliza el contenedor en el puerto 5433)
docker compose -f docker-compose.test.yml up -d

npm test
```

`npm test` carga `.env.test` automáticamente
(`postgres://vida:vida@localhost:5433/vida_v2_test`).

- **Unitarios** (sin DB): tiempo, `generateSlots`, sesión/siguiente paso,
  selección, confirmación, parser del LLM.
- **Integración** (PostgreSQL real):
  - `getAvailability`: horario libre · horario ocupado · fuera de
    `business_hours` · servicio inexistente.
  - `createAppointment`: cita válida · slot ocupado · servicio inexistente ·
    cliente inexistente.
  - `rescheduleAppointment`: actualiza la **misma** cita (no crea otra).
  - `cancelAppointment`.
  - **concurrencia**: dos `createAppointment` simultáneos → **sólo una** cita
    creada (verificado en la base).
- **E2E**: flujo de reserva completo (criterio de éxito del Documento 1),
  idempotencia y cancelación.

Si no hay base alcanzable, integración/E2E se **omiten** automáticamente.

> ⚠️ Los tests hacen `DROP SCHEMA public CASCADE`. Usa una base **dedicada**.

## Reglas que nunca se rompen (Documento 2/3)

- El LLM solo detecta intención y entidades; **nunca** crea/cancela/reagenda ni
  decide disponibilidad. Todo su output se valida.
- Confirmación explícita antes de crear/cancelar/reagendar.
- Revalidación de disponibilidad antes de crear (no confiar en lo mostrado).
- Máximo 3 horarios. Nunca múltiples servicios por cita. Nunca
  `availability_blocks` en esta versión.
