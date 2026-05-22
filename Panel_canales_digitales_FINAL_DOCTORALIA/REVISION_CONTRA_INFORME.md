# Revisión final contra informe técnico Doctoralia / Docplanner

Correcciones funcionales aplicadas:

1. `/api/doctoralia/bootstrap` ya no exige `FACILITY_ID`, `DOCTOR_ID` ni `ADDRESS_ID`.
2. Se han separado validaciones:
   - `requireOAuthConfig()` para OAuth/base URL/token URL.
   - `requireFullConfig()` para calendario/reservas/pacientes/book/move/confirm/cancel.
3. Bootstrap carga siempre `/facilities` y, solo si hay IDs configurados, carga doctors, addresses y services.
4. `/api/doctoralia/webhook` procesa eventos y actualiza `doctoralia_bookings_cache`.
5. Webhook marca eventos como `processed`, `processed_no_booking_id`, `processed_unknown_event` o `failed` y rellena `processed_at`.
6. Cancelaciones marcan la reserva como `cancelled` en caché local.
7. `calendar/bookings` y `patients` actualizan caché.
8. `book`, `move`, `confirm` y `cancel` actualizan caché.
9. Se han creado endpoints reales de notas internas:
   - `GET /api/crm/patient-notes?booking_id=xxx`
   - `POST /api/crm/patient-notes`
   - `PUT /api/crm/patient-notes/:id`
   - `DELETE /api/crm/patient-notes/:id`
10. `crm.html` ya no hace solo merge. Ahora hace upsert de reservas Doctoralia.
11. Si una reserva ya existe, actualiza estado, fecha/hora, teléfono, email, nombre, valor, servicio, visita y `rawDoctoralia`.
12. Si una reserva llega cancelada, queda con estado `Cancelada` y no se muestra como lead activo normal.

Pendiente solo de credenciales reales sandbox/producción para pruebas externas.
