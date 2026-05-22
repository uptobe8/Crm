# Backend Doctoralia / Docplanner

Backend intermedio para conectar la app CRM con Doctoralia/Docplanner sin exponer credenciales en el frontend.

## Alcance de esta fase

Incluido:

- Calendario / visitas.
- Reservas.
- Paciente asociado a reserva mediante `with=booking.patient`.
- Notas internas propias del CRM.
- Caché local de reservas.
- Registro de eventos webhook.

Fuera de esta fase:

- perfil/servicios
- reservas avanzadas
- finanzas
- reputación
- chat con pacientes
- campañas
- DPphone
- Noa
- integraciones generales
- documentación médica avanzada

## Instalación

```bash
cd backend
npm install
cp .env.sandbox.example .env
npm run dev
```

Backend local:

```txt
http://localhost:3001
```

Frontend local recomendado:

```bash
cd frontend
python3 -m http.server 3000
```

Abrir:

```txt
http://localhost:3000/crm.html
```

## Configuración sandbox / producción

Incluye:

```txt
.env.example
.env.sandbox.example
.env.production.example
```

Usar sandbox antes de producción. En producción, cambiar `FRONTEND_ORIGIN` al dominio real y no subir `.env` al repositorio.

## Variables necesarias

Pedir a Doctoralia/Docplanner:

```txt
client_id
client_secret
sandbox access
production access
facility_id
doctor_id
address_id
address_service_id
permisos para bookings
permisos para slots
permisos para booking.patient
URL de callbacks/webhook
```

## Endpoints internos creados

```txt
GET  /api/doctoralia/health
GET  /api/doctoralia/bootstrap
GET  /api/doctoralia/calendar/slots?start=&end=
GET  /api/doctoralia/calendar/bookings?start=&end=
GET  /api/doctoralia/patients?start=&end=
POST /api/doctoralia/calendar/book
POST /api/doctoralia/calendar/move
POST /api/doctoralia/calendar/confirm
DELETE /api/doctoralia/calendar/cancel/:bookingId
POST /api/doctoralia/webhook
```

## Base de datos

Se crea automáticamente en:

```txt
backend/data/doctoralia-crm.sqlite
```

Tablas:

```txt
doctoralia_bookings_cache
crm_patient_notes
doctoralia_webhook_events
```

## Flujo de trabajo técnico

1. Configurar `.env` con credenciales sandbox.
2. Probar `GET /api/doctoralia/health`.
3. Probar OAuth2 mediante `GET /api/doctoralia/bootstrap`.
4. Confirmar que `/bootstrap` devuelve mapping de facilities, doctors, addresses y services.
4. Validar `facility_id`, `doctor_id`, `address_id` y `address_service_id`.
5. Probar `GET /api/doctoralia/calendar/slots`.
6. Probar `GET /api/doctoralia/calendar/bookings`.
7. Probar `GET /api/doctoralia/patients`.
8. Configurar webhook público HTTPS en Doctoralia.
9. Pasar acceptance tests con Docplanner.
10. Cambiar variables sandbox por producción.

## Seguridad

- No poner `client_id` ni `client_secret` en HTML.
- No subir `.env` a GitHub.
- Usar HTTPS en producción.
- Cerrar CORS al dominio real.
- Mantener rate limit.
- No loguear datos médicos sensibles.
- Cumplir RGPD.

## Correcciones funcionales aplicadas

### Bootstrap

`GET /api/doctoralia/bootstrap` solo exige configuración OAuth:

```txt
DOCTORALIA_CLIENT_ID
DOCTORALIA_CLIENT_SECRET
DOCTORALIA_BASE_URL
DOCTORALIA_TOKEN_URL
```

Funciona aunque estén vacíos:

```txt
FACILITY_ID
DOCTOR_ID
ADDRESS_ID
ADDRESS_SERVICE_ID
```

Comportamiento:

```txt
Siempre carga /facilities
Si existe FACILITY_ID, carga doctors
Si existe FACILITY_ID + DOCTOR_ID, carga addresses
Si existe FACILITY_ID + DOCTOR_ID + ADDRESS_ID, carga services
```

### Notas internas CRM

Endpoints añadidos:

```txt
GET    /api/crm/patient-notes?booking_id=xxx
POST   /api/crm/patient-notes
PUT    /api/crm/patient-notes/:id
DELETE /api/crm/patient-notes/:id
```

Payload mínimo:

```json
{
  "booking_id": "xxx",
  "patient_key": "xxx",
  "note": "texto de la nota",
  "contact_method": "llamada | whatsapp | email | otro",
  "contacted_at": "ISO_DATE",
  "owner": "usuario/responsable"
}
```

### Webhook y caché

El webhook ya no solo guarda el evento. Ahora:

```txt
Recibe evento
Guarda raw_json
Extrae booking_id
Si no hay booking_id, marca processed_no_booking_id
Si hay booking_id y es cancelación, marca caché como cancelled
Si hay booking_id y es reserva/movimiento/confirmación/present/absent, consulta booking completo y actualiza caché
Marca doctoralia_webhook_events.status como processed o failed
Rellena processed_at
```

Eventos contemplados:

```txt
slot-booked
booking-cancelled
booking-moved
booking-confirmed
patient-present
patient-absent
```

### Caché actualizada desde todos los flujos

```txt
calendar/bookings
patients
webhook
book
move
confirm
cancel
```
