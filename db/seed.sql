-- VIDA v2.0 — Datos demo.
-- Salón con un solo profesional (no se pide/maneja staff en MVP).

INSERT INTO tenants (id, name, timezone, whatsapp_phone, address)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'Salón Demo v2',
  'America/Hermosillo',
  '+526620000000',
  'Av. Siempre Viva 123, Hermosillo, Sonora'
);

INSERT INTO services (id, tenant_id, name, duration_minutes, price, active)
VALUES
('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', 'Corte', 45, 250.00, true),
('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111111', 'Manicure', 60, 350.00, true),
('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Pedicure', 45, 300.00, true),
('33333333-3333-3333-3333-333333333334', '11111111-1111-1111-1111-111111111111', 'Pestañas', 90, 600.00, true);

INSERT INTO customers (id, tenant_id, phone, name)
VALUES
('44444444-4444-4444-4444-444444444441', '11111111-1111-1111-1111-111111111111', '+5216621234567', 'Cliente Demo');

INSERT INTO business_hours (tenant_id, day_of_week, start_time, end_time)
VALUES
('11111111-1111-1111-1111-111111111111', 1, '09:00', '18:00'),
('11111111-1111-1111-1111-111111111111', 2, '09:00', '18:00'),
('11111111-1111-1111-1111-111111111111', 3, '09:00', '18:00'),
('11111111-1111-1111-1111-111111111111', 4, '09:00', '18:00'),
('11111111-1111-1111-1111-111111111111', 5, '09:00', '18:00'),
('11111111-1111-1111-1111-111111111111', 6, '10:00', '15:00');

-- Cita existente para probar conflictos: 2026-06-08 (lunes) 16:00-17:00 UTC
-- = 09:00-10:00 local Hermosillo (Manicure).
INSERT INTO appointments (id, tenant_id, customer_id, service_id, starts_at, ends_at, status)
VALUES
('55555555-5555-5555-5555-555555555551',
 '11111111-1111-1111-1111-111111111111',
 '44444444-4444-4444-4444-444444444441',
 '33333333-3333-3333-3333-333333333332',
 '2026-06-08T16:00:00Z',
 '2026-06-08T17:00:00Z',
 'CONFIRMED');
