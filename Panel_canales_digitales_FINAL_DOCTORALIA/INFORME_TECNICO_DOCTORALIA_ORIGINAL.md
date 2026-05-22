Te dejo el informe listo para enviar al técnico.

---

# Informe técnico — Integración app CRM con Doctoralia / Docplanner

## 1. Objetivo

Conectar la app actual con Doctoralia/Docplanner **solo para dos bloques iniciales**:

1. **Calendario / visitas**
2. **Pacientes / documentación básica asociada a reservas**

Quedan fuera de esta fase:

```txt
perfil/servicios
reservas avanzadas
finanzas
reputación
chat con pacientes
campañas
DPphone
Noa
integraciones generales
```

La integración debe hacerse mediante una **capa backend intermedia**, nunca directamente desde el HTML/frontend.

---

## 2. Estado actual de la app

He revisado el ZIP entregado. La app actual es:

```txt
Panel_canales_digitales_FINAL/
  index.html
  integraciones.html
  crm.html
  canal-google-ads.html
  canal-meta-ads.html
  canal-seo.html
  canal-whatsapp.html
  canal-email.html
  canal-web.html
  canal-linkedin.html
  canal-tiktok.html
```

La app es una **multipágina HTML estática**, sin backend, sin base de datos y con JavaScript embebido.

En `crm.html` actualmente los leads se guardan en navegador mediante:

```js
localStorage
```

Claves detectadas:

```txt
crm-v3-leads
crm-v3-contacted
```

Esto sirve para simulación local, pero no para conectar con Doctoralia, porque Doctoralia usa OAuth2, tokens Bearer y datos sensibles. Las credenciales no pueden ir en el navegador.

---

## 3. Fuente oficial de integración

La integración correcta es mediante **Docplanner Integrations API**, que es la API usada para Doctoralia. La documentación oficial indica que todos los recursos se consumen bajo este patrón:

```txt
https://www.{domain}/api/v3/integration/{resource}
```

Para España, el dominio oficial listado es:

```txt
doctoralia.es
```

Por tanto, la base para España será:

```txt
https://www.doctoralia.es/api/v3/integration
```

Docplanner exige HTTPS y OAuth2 para todas las llamadas. ([Integrations Docplanner][1])

---

## 4. Acceso necesario

Antes de programar producción hay que pedir a Doctoralia/Docplanner:

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

La documentación oficial indica que la integración debe coordinarse con un especialista de Docplanner, primero con sandbox y después con validación/acceptance tests antes de producción. ([Integrations Docplanner][2])

---

## 5. Arquitectura obligatoria

No conectar el frontend directamente a Doctoralia.

Arquitectura correcta:

```txt
Frontend HTML actual
        ↓
Backend propio
        ↓
Docplanner / Doctoralia API
```

Estructura propuesta:

```txt
proyecto/
  frontend/
    index.html
    crm.html
    integraciones.html
    ...
  backend/
    server.js
    package.json
    .env
```

Stack recomendado:

```txt
Node.js 20+
Express
Axios
Dotenv
Cors
```

También se podría hacer en PHP o .NET porque Docplanner tiene SDK oficial para ambos, pero si no hay backend existente, Node.js + Express es más rápido para esta app. Docplanner documenta SDKs oficiales para PHP y .NET. ([Integrations Docplanner][3])

---

## 6. Autenticación

Docplanner usa OAuth2 con `client_credentials`.

Endpoint de token:

```txt
https://www.doctoralia.es/oauth/v2/token
```

Payload:

```txt
grant_type=client_credentials
scope=integration
```

Autorización:

```txt
Basic Auth con client_id y client_secret
```

La respuesta devuelve:

```json
{
  "access_token": "TOKEN",
  "expires_in": 3600,
  "token_type": "bearer"
}
```

La documentación indica que el token Bearer debe incluirse en cada request y que las credenciales nunca deben exponerse en cliente/frontend. ([Integrations Docplanner][4])

---

## 7. Variables de entorno

Crear `.env` en backend:

```env
PORT=3001
NODE_ENV=development

DOCTORALIA_DOMAIN=doctoralia.es
DOCTORALIA_BASE_URL=https://www.doctoralia.es/api/v3/integration
DOCTORALIA_TOKEN_URL=https://www.doctoralia.es/oauth/v2/token

DOCTORALIA_CLIENT_ID=xxx
DOCTORALIA_CLIENT_SECRET=xxx

FACILITY_ID=xxx
DOCTOR_ID=xxx
ADDRESS_ID=xxx
ADDRESS_SERVICE_ID=xxx

FRONTEND_ORIGIN=http://localhost:3000
WEBHOOK_SECRET=generar_un_secreto_largo
```

En producción:

```env
FRONTEND_ORIGIN=https://dominio-real.com
```

---

## 8. Recursos Doctoralia necesarios

Para esta primera fase hay que usar estos objetos:

```txt
Facility
Doctor
Address
Address Service
Slots
Bookings
Booking Patient
```

El calendario en Docplanner está vinculado al `address_id`. La documentación indica que los calendarios de los doctores están estrechamente ligados a sus direcciones y que cada dirección premium puede tener calendario activo. ([Integrations Docplanner][5])

---

## 9. Endpoints externos necesarios

### 9.1. Mapeo inicial

```txt
GET /facilities
GET /facilities/{facility_id}/doctors
GET /facilities/{facility_id}/doctors/{doctor_id}/addresses
GET /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/services
```

Objetivo: obtener y validar los IDs reales que luego se guardarán en `.env`.

---

### 9.2. Calendario / huecos

```txt
GET /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/slots
PUT /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/slots
DELETE /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/slots/{date}
```

Docplanner documenta `getSlots`, `replaceSlots`, `bookSlot` y `deleteSlots` dentro de Slots. ([Integrations Docplanner][1])

---

### 9.3. Reservas / visitas

```txt
GET /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/bookings
GET /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/bookings/{booking_id}
DELETE /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/bookings/{booking_id}
POST /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/bookings/{booking_id}/move
PUT /facilities/{facility_id}/doctors/{doctor_id}/addresses/{address_id}/bookings/{booking_id}/confirm
```

El endpoint `getBookings` requiere `start` y `end`, permite paginación y acepta extensiones mediante `with`, incluyendo `booking.patient`, `booking.address_service` y `booking.presence`. ([Integrations Docplanner][6])

---

### 9.4. Pacientes

No usar un endpoint genérico inventado tipo:

```txt
GET /patients
```

Para esta fase, los pacientes deben obtenerse desde reservas:

```txt
GET /bookings?start=...&end=...&with=booking.patient
```

`booking.patient` devuelve los datos del paciente asociados a cada reserva. ([Integrations Docplanner][6])

---

## 10. Endpoints internos que debe crear el técnico

Crear estos endpoints propios:

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

---

## 11. Backend base recomendado

Instalación:

```bash
mkdir backend
cd backend
npm init -y
npm i express axios cors dotenv helmet express-rate-limit
npm i -D nodemon
```

`package.json`:

```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js"
  }
}
```

`server.js` mínimo:

```js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();

app.use(helmet());
app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || true
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120
}));

const {
  PORT,
  DOCTORALIA_CLIENT_ID,
  DOCTORALIA_CLIENT_SECRET,
  DOCTORALIA_BASE_URL,
  DOCTORALIA_TOKEN_URL,
  FACILITY_ID,
  DOCTOR_ID,
  ADDRESS_ID,
  ADDRESS_SERVICE_ID
} = process.env;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getToken() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("scope", "integration");

  const response = await axios.post(DOCTORALIA_TOKEN_URL, body, {
    auth: {
      username: DOCTORALIA_CLIENT_ID,
      password: DOCTORALIA_CLIENT_SECRET
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 15000
  });

  cachedToken = response.data.access_token;

  const expiresIn = response.data.expires_in || 86400;
  tokenExpiresAt = now + (expiresIn - 300) * 1000;

  return cachedToken;
}

function basePath() {
  return `/facilities/${FACILITY_ID}/doctors/${DOCTOR_ID}/addresses/${ADDRESS_ID}`;
}

async function doctoraliaRequest(method, path, options = {}) {
  const token = await getToken();

  const response = await axios({
    method,
    url: `${DOCTORALIA_BASE_URL}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.docplanner+json"
    },
    timeout: 20000,
    ...options
  });

  return response.data;
}

function handleError(res, error, fallbackMessage) {
  const status = error.response?.status || 500;

  return res.status(status).json({
    error: fallbackMessage,
    status,
    detail: error.response?.data || error.message
  });
}

app.get("/api/doctoralia/health", (req, res) => {
  res.json({
    ok: true,
    service: "doctoralia-backend"
  });
});

app.get("/api/doctoralia/bootstrap", async (req, res) => {
  try {
    const facilities = await doctoraliaRequest("GET", "/facilities");

    res.json({
      facility_id: FACILITY_ID,
      doctor_id: DOCTOR_ID,
      address_id: ADDRESS_ID,
      address_service_id: ADDRESS_SERVICE_ID,
      facilities
    });
  } catch (error) {
    handleError(res, error, "Error cargando configuración inicial");
  }
});

app.get("/api/doctoralia/calendar/slots", async (req, res) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "Faltan parámetros start y end"
      });
    }

    const data = await doctoraliaRequest("GET", `${basePath()}/slots`, {
      params: {
        start,
        end
      }
    });

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error obteniendo slots");
  }
});

app.get("/api/doctoralia/calendar/bookings", async (req, res) => {
  try {
    const { start, end, page = 1, limit = 100 } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "Faltan parámetros start y end"
      });
    }

    const data = await doctoraliaRequest("GET", `${basePath()}/bookings`, {
      params: {
        start,
        end,
        page,
        limit,
        with: [
          "booking.patient",
          "booking.address_service",
          "booking.presence"
        ]
      }
    });

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error obteniendo reservas");
  }
});

app.get("/api/doctoralia/patients", async (req, res) => {
  try {
    const { start, end, page = 1, limit = 100 } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: "Faltan parámetros start y end"
      });
    }

    const data = await doctoraliaRequest("GET", `${basePath()}/bookings`, {
      params: {
        start,
        end,
        page,
        limit,
        with: ["booking.patient"]
      }
    });

    const bookings = data._items || data.items || [];

    const patients = bookings
      .filter(item => item.patient || item.booking?.patient)
      .map(item => {
        const patient = item.patient || item.booking?.patient;

        return {
          booking_id: item.id || item.booking?.id,
          visit_status: item.status || item.booking?.status,
          visit_start: item.start_at || item.booking?.start_at,
          visit_end: item.end_at || item.booking?.end_at,
          patient
        };
      });

    res.json({
      _items: patients
    });
  } catch (error) {
    handleError(res, error, "Error obteniendo pacientes");
  }
});

app.post("/api/doctoralia/calendar/book", async (req, res) => {
  try {
    const {
      start,
      patient,
      address_service_id,
      duration,
      comment
    } = req.body;

    if (!start || !patient || !duration) {
      return res.status(400).json({
        error: "Faltan start, patient o duration"
      });
    }

    const serviceId = address_service_id || ADDRESS_SERVICE_ID;
    const encodedStart = encodeURIComponent(start);

    const data = await doctoraliaRequest(
      "POST",
      `${basePath()}/slots/${encodedStart}/book`,
      {
        data: {
          patient,
          address_service_id: serviceId,
          duration,
          comment: comment || ""
        }
      }
    );

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error creando reserva");
  }
});

app.delete("/api/doctoralia/calendar/cancel/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    await doctoraliaRequest(
      "DELETE",
      `${basePath()}/bookings/${bookingId}`
    );

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "Error cancelando reserva");
  }
});

app.post("/api/doctoralia/webhook", async (req, res) => {
  try {
    console.log("Doctoralia webhook recibido:", req.body);

    res.status(200).json({ ok: true });
  } catch (error) {
    handleError(res, error, "Error procesando webhook");
  }
});

app.listen(PORT || 3001, () => {
  console.log(`Backend activo en puerto ${PORT || 3001}`);
});
```

---

## 12. Cambios en el frontend

En `crm.html`, no eliminar todavía el `localStorage`. Primero añadir una capa de carga real.

Crear funciones nuevas:

```js
async function apiGet(path) {
  const response = await fetch("http://localhost:3001" + path);

  if (!response.ok) {
    throw new Error("Error API: " + response.status);
  }

  return response.json();
}
```

Cargar reservas:

```js
async function cargarReservasDoctoralia() {
  const start = encodeURIComponent("2026-05-22T00:00:00+02:00");
  const end = encodeURIComponent("2026-05-29T23:59:59+02:00");

  const data = await apiGet(
    `/api/doctoralia/calendar/bookings?start=${start}&end=${end}`
  );

  console.log("Reservas Doctoralia:", data);
}
```

Cargar pacientes:

```js
async function cargarPacientesDoctoralia() {
  const start = encodeURIComponent("2026-05-22T00:00:00+02:00");
  const end = encodeURIComponent("2026-05-29T23:59:59+02:00");

  const data = await apiGet(
    `/api/doctoralia/patients?start=${start}&end=${end}`
  );

  console.log("Pacientes Doctoralia:", data._items);
}
```

Después, mapear esos datos a las tablas actuales del CRM.

---

## 13. Mapeo recomendado a la tabla CRM actual

Tabla actual de leads pendientes:

```txt
Lead
Teléfono
Email
Canal entrada
Día/hora entrada
Responsable
Valor
Datos del lead
Contacto
Estado
Acción
```

Mapeo desde Doctoralia:

```txt
Lead                → patient.first_name + patient.last_name
Teléfono            → patient.phone
Email               → patient.email
Canal entrada       → Doctoralia
Día/hora entrada    → booking.booked_at
Responsable         → doctor.name o valor interno asignado
Valor               → address_service.price si viene disponible
Datos del lead      → servicio, fecha visita, estado, booking_id
Estado              → booking.status
```

Tabla de contactados:

```txt
Método              → interno: WhatsApp / llamada / mail
Día/hora contacto   → fecha local generada por la app
Notas               → guardar en backend propio, no en Doctoralia salvo que exista endpoint específico autorizado
```

---

## 14. Base de datos propia

Ahora mismo la app no tiene base de datos. Para esta fase mínima, el técnico debe añadir una.

Recomendación rápida:

```txt
SQLite si es MVP local/simple
PostgreSQL si va a producción seria
```

Tablas mínimas:

```sql
CREATE TABLE doctoralia_bookings_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT UNIQUE,
  patient_id TEXT,
  doctor_id TEXT,
  facility_id TEXT,
  address_id TEXT,
  status TEXT,
  start_at TEXT,
  end_at TEXT,
  raw_json TEXT,
  synced_at TEXT
);

CREATE TABLE crm_patient_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id TEXT,
  patient_key TEXT,
  note TEXT,
  contact_method TEXT,
  contacted_at TEXT,
  owner TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE doctoralia_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_name TEXT,
  booking_id TEXT,
  raw_json TEXT,
  received_at TEXT,
  processed_at TEXT,
  status TEXT
);
```

No guardar más datos médicos de los necesarios. Solo lo imprescindible para CRM operativo.

---

## 15. Webhooks / callbacks

Configurar endpoint:

```txt
POST https://tudominio.com/api/doctoralia/webhook
```

Eventos útiles:

```txt
slot-booked
booking-cancelled
booking-moved
booking-confirmed
patient-present
patient-absent
```

Docplanner indica que cuando un paciente reserva, se genera una notificación `slot-booked` que puede entregarse por pull notifications o empujarse a un endpoint configurado. ([Integrations Docplanner][7])

El webhook debe:

```txt
1. Recibir evento
2. Guardar raw_json
3. Identificar booking_id
4. Consultar booking completo si hace falta
5. Actualizar caché local
6. Refrescar CRM/frontend
```

---

## 16. Seguridad obligatoria

El técnico debe cumplir:

```txt
No exponer client_id ni client_secret en HTML
No subir .env a GitHub
Usar HTTPS en producción
Validar CORS por dominio real
Rate limiting
Logs sin datos médicos sensibles
Control de errores 401, 403, 404 y 429
Cifrado o protección de backups
Cumplimiento RGPD
```

Docplanner también indica que para callbacks puede requerirse whitelisting de IPs y publica endpoints para consultar IPs actualizadas. ([Integrations Docplanner][4])

---

## 17. Flujo de trabajo para el técnico

### Fase 1 — Preparación

```txt
1. Separar frontend y backend.
2. Crear backend Node.js.
3. Configurar .env.
4. Montar endpoint health.
5. Probar OAuth2 contra sandbox.
```

### Fase 2 — Mapeo

```txt
1. GET /facilities
2. Elegir facility_id correcto.
3. GET /facilities/{facility_id}/doctors
4. Elegir doctor_id correcto.
5. GET /addresses
6. Elegir address_id correcto.
7. GET /services
8. Elegir address_service_id correcto.
```

### Fase 3 — Calendario

```txt
1. Crear endpoint interno /calendar/slots.
2. Crear endpoint interno /calendar/bookings.
3. Probar rango de fechas.
4. Validar zona horaria Europe/Madrid.
5. Añadir paginación.
6. Pintar reservas en frontend.
```

### Fase 4 — Pacientes

```txt
1. Consumir bookings con with=booking.patient.
2. Normalizar datos de paciente.
3. Pintar pacientes en crm.html.
4. Evitar duplicados por booking_id/patient_id/email/teléfono.
```

### Fase 5 — Webhook

```txt
1. Crear /api/doctoralia/webhook.
2. Guardar eventos recibidos.
3. Procesar slot-booked.
4. Procesar cancelaciones.
5. Actualizar caché local.
```

### Fase 6 — Producción

```txt
1. Deploy backend.
2. Activar HTTPS.
3. Configurar dominio frontend.
4. Configurar CORS cerrado.
5. Configurar variables reales.
6. Pasar acceptance tests con Docplanner.
```

---

## 18. Pruebas mínimas

El técnico debe entregar evidencia de:

```txt
GET /api/doctoralia/health → 200
OAuth token generado correctamente
GET /api/doctoralia/bootstrap → devuelve facility/doctor/address
GET /calendar/slots → devuelve huecos
GET /calendar/bookings → devuelve reservas
GET /patients → devuelve pacientes desde booking.patient
Cancelación controlada con booking_id de prueba
Webhook recibe evento y lo guarda
Frontend muestra datos reales sin romper la UI actual
```

---

## 19. Criterios de aceptación

La integración se considera correcta si:

```txt
1. La app sigue funcionando visualmente igual.
2. Las credenciales no aparecen en frontend.
3. El CRM puede listar reservas de Doctoralia por rango de fechas.
4. El CRM puede listar pacientes asociados a reservas.
5. El sistema distingue datos locales y datos Doctoralia.
6. El backend gestiona errores sin romper la interfaz.
7. Hay logs suficientes para depurar.
8. Hay configuración separada sandbox/producción.
```

---

## 20. Entregables del técnico

```txt
/backend/server.js
/backend/package.json
/backend/.env.example
Documentación de instalación
Documentación de endpoints internos
Colección Postman o Bruno
Instrucciones de despliegue
Listado de variables necesarias
Prueba de conexión sandbox
Prueba de lectura de reservas
Prueba de lectura de pacientes
```

---

## 21. Nota importante

No pedir al técnico que “conecte pacientes” como si hubiera un endpoint independiente. Para esta primera fase, lo correcto es:

```txt
Reservas + with=booking.patient = pacientes visibles en CRM
```

Y no debe tocar todavía:

```txt
finanzas
chat
reputación
campañas
DPphone
Noa
documentación médica avanzada
```

La integración debe quedar limitada a:

```txt
calendario
reservas
paciente asociado a reserva
notas internas propias del CRM
```

[1]: https://integrations.docplanner.com/docs/?utm_source=chatgpt.com "Docplanner Integrations API"
[2]: https://integrations.docplanner.com/guide/integration-process.html "Integration process"
[3]: https://integrations.docplanner.com/guide/tools-and-libraries/sdk-php.html?utm_source=chatgpt.com "SDK for PHP"
[4]: https://integrations.docplanner.com/guide/fundamentals/authorization.html?utm_source=chatgpt.com "Authorization"
[5]: https://integrations.docplanner.com/guide/api-objects/managing-calendars.html "Managing calendars"
[6]: https://integrations.docplanner.com/docs/ "Docplanner Integrations API"
[7]: https://integrations.docplanner.com/guide/api-objects/resources.html "Resources"
