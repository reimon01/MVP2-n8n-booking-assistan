-- VIDA v2.0 — Esquema simplificado (Documento 3).
-- 6 tablas: tenants, customers, services, appointments, business_hours, sessions.
-- Sin staff, appointment_services, conversations, messages ni availability_blocks.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- btree_gist habilita la restricción de exclusión por rango de tiempo.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  timezone VARCHAR(100) NOT NULL,
  whatsapp_phone VARCHAR(50),
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  phone VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone)
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (duration_minutes > 0),
  CHECK (price >= 0)
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  service_id UUID NOT NULL REFERENCES services(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (status IN ('CONFIRMED', 'CANCELLED'))
);

-- Anti-overbooking garantizado por la base: dos citas CONFIRMED del mismo
-- tenant no pueden solaparse en el tiempo. Respalda la revalidación de la app
-- frente a concurrencia (Documento 2: "Nunca confiar solo en la
-- disponibilidad mostrada antes"). MVP sin staff => conflicto por tenant.
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    tenant_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'CONFIRMED');

CREATE TABLE business_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (day_of_week BETWEEN 0 AND 6),
  CHECK (end_time > start_time)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, customer_id)
);

-- Índices mínimos (Documento 3 §2).
CREATE INDEX idx_customers_tenant_phone ON customers(tenant_id, phone);
CREATE INDEX idx_appointments_tenant_starts_at ON appointments(tenant_id, starts_at);
CREATE INDEX idx_appointments_customer_status ON appointments(customer_id, status);
CREATE INDEX idx_services_tenant_active ON services(tenant_id, active);
CREATE INDEX idx_business_hours_tenant_day ON business_hours(tenant_id, day_of_week);
