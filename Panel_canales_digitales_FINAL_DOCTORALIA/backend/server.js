const express = require("express");
const axios = require("axios");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
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

const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, "doctoralia-crm.sqlite"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS doctoralia_bookings_cache (
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
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS crm_patient_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id TEXT,
    patient_key TEXT,
    note TEXT,
    contact_method TEXT,
    contacted_at TEXT,
    owner TEXT,
    created_at TEXT,
    updated_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS doctoralia_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT,
    booking_id TEXT,
    raw_json TEXT,
    received_at TEXT,
    processed_at TEXT,
    status TEXT
  )`);
});

let cachedToken = null;
let tokenExpiresAt = 0;

function env() {
  return {
    PORT: process.env.PORT || 3001,
    DOCTORALIA_CLIENT_ID: process.env.DOCTORALIA_CLIENT_ID,
    DOCTORALIA_CLIENT_SECRET: process.env.DOCTORALIA_CLIENT_SECRET,
    DOCTORALIA_BASE_URL: process.env.DOCTORALIA_BASE_URL,
    DOCTORALIA_TOKEN_URL: process.env.DOCTORALIA_TOKEN_URL,
    FACILITY_ID: process.env.FACILITY_ID,
    DOCTOR_ID: process.env.DOCTOR_ID,
    ADDRESS_ID: process.env.ADDRESS_ID,
    ADDRESS_SERVICE_ID: process.env.ADDRESS_SERVICE_ID,
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET
  };
}

function missingKeys(keys) {
  const cfg = env();
  return keys.filter(key => !cfg[key]);
}

function requireOAuthConfig(res) {
  const missing = missingKeys([
    "DOCTORALIA_CLIENT_ID",
    "DOCTORALIA_CLIENT_SECRET",
    "DOCTORALIA_BASE_URL",
    "DOCTORALIA_TOKEN_URL"
  ]);

  if (missing.length) {
    res.status(500).json({
      error: "Faltan variables OAuth Doctoralia",
      missing
    });
    return false;
  }

  return true;
}

function requireFullConfig(res) {
  const missing = missingKeys([
    "DOCTORALIA_CLIENT_ID",
    "DOCTORALIA_CLIENT_SECRET",
    "DOCTORALIA_BASE_URL",
    "DOCTORALIA_TOKEN_URL",
    "FACILITY_ID",
    "DOCTOR_ID",
    "ADDRESS_ID"
  ]);

  if (missing.length) {
    res.status(500).json({
      error: "Faltan variables de entorno Doctoralia para operar calendario/reservas",
      missing
    });
    return false;
  }

  return true;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

async function getToken() {
  const cfg = env();
  const now = Date.now();

  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const body = new URLSearchParams();
  body.append("grant_type", "client_credentials");
  body.append("scope", "integration");

  const response = await axios.post(cfg.DOCTORALIA_TOKEN_URL, body, {
    auth: {
      username: cfg.DOCTORALIA_CLIENT_ID,
      password: cfg.DOCTORALIA_CLIENT_SECRET
    },
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    timeout: 15000
  });

  cachedToken = response.data.access_token;

  const expiresIn = response.data.expires_in || 3600;
  tokenExpiresAt = now + Math.max(expiresIn - 300, 60) * 1000;

  return cachedToken;
}

function basePath() {
  const cfg = env();
  return `/facilities/${cfg.FACILITY_ID}/doctors/${cfg.DOCTOR_ID}/addresses/${cfg.ADDRESS_ID}`;
}

async function doctoraliaRequest(method, pathValue, options = {}) {
  const cfg = env();
  const token = await getToken();

  const response = await axios({
    method,
    url: `${cfg.DOCTORALIA_BASE_URL}${pathValue}`,
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

function getItems(data) {
  if (Array.isArray(data?._items)) return data._items;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

function pickBooking(item) {
  return item?.booking || item || {};
}

function pickPatient(item) {
  return item?.patient || item?.booking?.patient || item?._embedded?.patient || item?.patient_data || null;
}

function pickService(item) {
  const booking = pickBooking(item);
  return booking.address_service || item?.address_service || booking._embedded?.address_service || item?._embedded?.address_service || null;
}

function bookingId(item) {
  const booking = pickBooking(item);
  return String(
    booking.id ||
    item?.id ||
    booking.booking_id ||
    item?.booking_id ||
    item?.resource_id ||
    ""
  );
}

function patientKey(patient) {
  if (!patient) return "";
  return String(patient.id || patient.email || patient.phone || patient.phone_number || patient.mobile || "");
}

function bookingStatus(item, fallback = "") {
  const booking = pickBooking(item);
  return String(
    booking.status ||
    item?.status ||
    item?.visit_status ||
    fallback ||
    ""
  );
}

function bookingStart(item) {
  const booking = pickBooking(item);
  return String(booking.start_at || booking.start || item?.start_at || item?.start || item?.visit_start || "");
}

function bookingEnd(item) {
  const booking = pickBooking(item);
  return String(booking.end_at || booking.end || item?.end_at || item?.end || item?.visit_end || "");
}

function normalizeBookingPayload(item, overrides = {}) {
  const booking = pickBooking(item);
  const patient = pickPatient(item);
  const id = String(overrides.booking_id || bookingId(item));

  if (!id) return null;

  return {
    booking_id: id,
    patient_id: String(overrides.patient_id || patientKey(patient)),
    doctor_id: String(overrides.doctor_id || env().DOCTOR_ID || booking.doctor_id || item?.doctor_id || ""),
    facility_id: String(overrides.facility_id || env().FACILITY_ID || booking.facility_id || item?.facility_id || ""),
    address_id: String(overrides.address_id || env().ADDRESS_ID || booking.address_id || item?.address_id || ""),
    status: String(overrides.status || bookingStatus(item)),
    start_at: String(overrides.start_at || bookingStart(item)),
    end_at: String(overrides.end_at || bookingEnd(item)),
    raw_json: JSON.stringify(overrides.raw_json || item || {}),
    synced_at: new Date().toISOString()
  };
}

async function cacheBooking(item, overrides = {}) {
  const row = normalizeBookingPayload(item, overrides);
  if (!row) return null;

  await dbRun(
    `INSERT INTO doctoralia_bookings_cache
      (booking_id, patient_id, doctor_id, facility_id, address_id, status, start_at, end_at, raw_json, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(booking_id) DO UPDATE SET
      patient_id=excluded.patient_id,
      doctor_id=excluded.doctor_id,
      facility_id=excluded.facility_id,
      address_id=excluded.address_id,
      status=excluded.status,
      start_at=excluded.start_at,
      end_at=excluded.end_at,
      raw_json=excluded.raw_json,
      synced_at=excluded.synced_at`,
    [
      row.booking_id,
      row.patient_id,
      row.doctor_id,
      row.facility_id,
      row.address_id,
      row.status,
      row.start_at,
      row.end_at,
      row.raw_json,
      row.synced_at
    ]
  );

  return row;
}

async function cacheBookingsFromResponse(data) {
  const items = getItems(data);
  for (const item of items) {
    await cacheBooking(item);
  }
  return items.length;
}

async function markBookingCancelled(booking_id, raw_json = {}) {
  const existing = await dbGet(
    `SELECT * FROM doctoralia_bookings_cache WHERE booking_id = ?`,
    [String(booking_id)]
  );

  await cacheBooking(
    existing ? JSON.parse(existing.raw_json || "{}") : { id: booking_id },
    {
      booking_id: String(booking_id),
      patient_id: existing?.patient_id || "",
      doctor_id: existing?.doctor_id || env().DOCTOR_ID || "",
      facility_id: existing?.facility_id || env().FACILITY_ID || "",
      address_id: existing?.address_id || env().ADDRESS_ID || "",
      status: "cancelled",
      start_at: existing?.start_at || "",
      end_at: existing?.end_at || "",
      raw_json: {
        ...(existing ? JSON.parse(existing.raw_json || "{}") : {}),
        cancellation_event: raw_json,
        status: "cancelled"
      }
    }
  );
}

async function fetchBookingById(booking_id) {
  return doctoraliaRequest(
    "GET",
    `${basePath()}/bookings/${encodeURIComponent(booking_id)}`,
    {
      params: {
        with: [
          "booking.patient",
          "booking.address_service",
          "booking.presence"
        ]
      }
    }
  );
}

async function fetchAndCacheBooking(booking_id, fallback = null, statusOverride = null) {
  if (!booking_id) return null;

  try {
    const data = await fetchBookingById(booking_id);
    await cacheBooking(data, statusOverride ? { status: statusOverride } : {});
    return data;
  } catch (error) {
    if (fallback) {
      await cacheBooking(fallback, statusOverride ? { booking_id, status: statusOverride } : { booking_id });
      return fallback;
    }
    throw error;
  }
}

function extractBookingId(payload) {
  return String(
    payload?.booking_id ||
    payload?.bookingId ||
    payload?.booking?.id ||
    payload?.data?.booking_id ||
    payload?.data?.booking?.id ||
    payload?.resource_id ||
    payload?.resource?.id ||
    payload?.id ||
    ""
  );
}

function extractEventName(payload) {
  return String(
    payload?.event ||
    payload?.event_name ||
    payload?.type ||
    payload?.notification ||
    payload?.name ||
    "unknown"
  );
}

function isCancellationEvent(eventName) {
  return /cancel/i.test(String(eventName || ""));
}

function shouldRefreshBookingFromWebhook(eventName) {
  const normalized = String(eventName || "").toLowerCase();
  return [
    "slot-booked",
    "booking-moved",
    "booking-confirmed",
    "patient-present",
    "patient-absent"
  ].includes(normalized) || /booked|moved|confirmed|present|absent/.test(normalized);
}

async function updateWebhookEvent(id, status) {
  await dbRun(
    `UPDATE doctoralia_webhook_events
     SET status = ?, processed_at = ?
     WHERE id = ?`,
    [status, new Date().toISOString(), id]
  );
}

app.get("/api/doctoralia/health", (req, res) => {
  res.json({
    ok: true,
    service: "doctoralia-backend",
    database: "doctoralia-crm.sqlite"
  });
});

app.get("/api/doctoralia/bootstrap", async (req, res) => {
  if (!requireOAuthConfig(res)) return;

  try {
    const cfg = env();
    const facilities = await doctoraliaRequest("GET", "/facilities");

    let doctors = null;
    let addresses = null;
    let services = null;

    if (cfg.FACILITY_ID) {
      doctors = await doctoraliaRequest("GET", `/facilities/${cfg.FACILITY_ID}/doctors`);
    }

    if (cfg.FACILITY_ID && cfg.DOCTOR_ID) {
      addresses = await doctoraliaRequest("GET", `/facilities/${cfg.FACILITY_ID}/doctors/${cfg.DOCTOR_ID}/addresses`);
    }

    if (cfg.FACILITY_ID && cfg.DOCTOR_ID && cfg.ADDRESS_ID) {
      services = await doctoraliaRequest("GET", `/facilities/${cfg.FACILITY_ID}/doctors/${cfg.DOCTOR_ID}/addresses/${cfg.ADDRESS_ID}/services`);
    }

    res.json({
      ok: true,
      configured_ids: {
        facility_id: cfg.FACILITY_ID || null,
        doctor_id: cfg.DOCTOR_ID || null,
        address_id: cfg.ADDRESS_ID || null,
        address_service_id: cfg.ADDRESS_SERVICE_ID || null
      },
      mapping: {
        facilities,
        doctors,
        addresses,
        services
      }
    });
  } catch (error) {
    handleError(res, error, "Error cargando configuración inicial");
  }
});

app.get("/api/doctoralia/calendar/slots", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Faltan parámetros start y end" });
    }

    const data = await doctoraliaRequest("GET", `${basePath()}/slots`, {
      params: { start, end }
    });

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error obteniendo slots");
  }
});

app.get("/api/doctoralia/calendar/bookings", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { start, end, page = 1, limit = 100 } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Faltan parámetros start y end" });
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

    await cacheBookingsFromResponse(data);

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error obteniendo reservas");
  }
});

app.get("/api/doctoralia/patients", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { start, end, page = 1, limit = 100 } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "Faltan parámetros start y end" });
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

    const bookings = getItems(data);

    for (const item of bookings) {
      await cacheBooking(item);
    }

    const patients = bookings
      .filter(item => pickPatient(item))
      .map(item => {
        const patient = pickPatient(item);
        return {
          booking_id: bookingId(item),
          visit_status: bookingStatus(item),
          visit_start: bookingStart(item),
          visit_end: bookingEnd(item),
          patient,
          address_service: pickService(item),
          raw_booking: item
        };
      });

    res.json({ _items: patients });
  } catch (error) {
    handleError(res, error, "Error obteniendo pacientes");
  }
});

app.post("/api/doctoralia/calendar/book", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { start, patient, address_service_id, duration, comment } = req.body;

    if (!start || !patient || !duration) {
      return res.status(400).json({ error: "Faltan start, patient o duration" });
    }

    const serviceId = address_service_id || env().ADDRESS_SERVICE_ID;

    if (!serviceId) {
      return res.status(400).json({ error: "Falta address_service_id o ADDRESS_SERVICE_ID" });
    }

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

    const id = extractBookingId(data);
    if (id) {
      await fetchAndCacheBooking(id, data);
    } else {
      await cacheBooking(data);
    }

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error creando reserva");
  }
});

app.post("/api/doctoralia/calendar/move", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { booking_id, start, address_service_id, duration, comment } = req.body;

    if (!booking_id || !start) {
      return res.status(400).json({ error: "Faltan booking_id o start" });
    }

    const payload = {
      start,
      comment: comment || ""
    };

    if (address_service_id || env().ADDRESS_SERVICE_ID) {
      payload.address_service_id = address_service_id || env().ADDRESS_SERVICE_ID;
    }

    if (duration) {
      payload.duration = duration;
    }

    const data = await doctoraliaRequest(
      "POST",
      `${basePath()}/bookings/${encodeURIComponent(booking_id)}/move`,
      { data: payload }
    );

    await fetchAndCacheBooking(booking_id, data);

    res.json(data);
  } catch (error) {
    handleError(res, error, "Error moviendo reserva");
  }
});

app.post("/api/doctoralia/calendar/confirm", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { booking_id } = req.body;

    if (!booking_id) {
      return res.status(400).json({ error: "Falta booking_id" });
    }

    const data = await doctoraliaRequest(
      "PUT",
      `${basePath()}/bookings/${encodeURIComponent(booking_id)}/confirm`
    );

    await fetchAndCacheBooking(booking_id, data || { id: booking_id, status: "confirmed" }, "confirmed");

    res.json(data || { ok: true });
  } catch (error) {
    handleError(res, error, "Error confirmando reserva");
  }
});

app.delete("/api/doctoralia/calendar/cancel/:bookingId", async (req, res) => {
  if (!requireFullConfig(res)) return;

  try {
    const { bookingId } = req.params;

    await doctoraliaRequest(
      "DELETE",
      `${basePath()}/bookings/${encodeURIComponent(bookingId)}`
    );

    await markBookingCancelled(bookingId, { source: "api_cancel" });

    res.json({ ok: true, booking_id: bookingId, status: "cancelled" });
  } catch (error) {
    handleError(res, error, "Error cancelando reserva");
  }
});

app.post("/api/doctoralia/webhook", async (req, res) => {
  let eventRowId = null;

  try {
    const cfg = env();

    if (cfg.WEBHOOK_SECRET) {
      const receivedSecret = req.headers["x-webhook-secret"] || req.query.secret;
      if (receivedSecret !== cfg.WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Webhook no autorizado" });
      }
    }

    const payload = req.body || {};
    const eventName = extractEventName(payload);
    const id = extractBookingId(payload);
    const receivedAt = new Date().toISOString();

    const inserted = await dbRun(
      `INSERT INTO doctoralia_webhook_events
        (event_name, booking_id, raw_json, received_at, processed_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [eventName, id, JSON.stringify(payload), receivedAt, null, "received"]
    );

    eventRowId = inserted.lastID;

    if (!id) {
      await updateWebhookEvent(eventRowId, "processed_no_booking_id");
      return res.status(200).json({
        ok: true,
        status: "processed_no_booking_id",
        event_name: eventName
      });
    }

    if (isCancellationEvent(eventName)) {
      await markBookingCancelled(id, payload);
      await updateWebhookEvent(eventRowId, "processed");
      return res.status(200).json({
        ok: true,
        status: "processed",
        event_name: eventName,
        booking_id: id
      });
    }

    if (shouldRefreshBookingFromWebhook(eventName)) {
      if (!missingKeys(["DOCTORALIA_CLIENT_ID", "DOCTORALIA_CLIENT_SECRET", "DOCTORALIA_BASE_URL", "DOCTORALIA_TOKEN_URL", "FACILITY_ID", "DOCTOR_ID", "ADDRESS_ID"]).length) {
        await fetchAndCacheBooking(id, payload);
      } else {
        await cacheBooking(payload, { booking_id: id });
      }

      await updateWebhookEvent(eventRowId, "processed");
      return res.status(200).json({
        ok: true,
        status: "processed",
        event_name: eventName,
        booking_id: id
      });
    }

    await cacheBooking(payload, { booking_id: id });
    await updateWebhookEvent(eventRowId, "processed_unknown_event");

    res.status(200).json({
      ok: true,
      status: "processed_unknown_event",
      event_name: eventName,
      booking_id: id
    });
  } catch (error) {
    if (eventRowId) {
      try {
        await updateWebhookEvent(eventRowId, "failed");
      } catch (updateError) {
        console.error("Error actualizando estado del webhook:", updateError.message);
      }
    }
    handleError(res, error, "Error procesando webhook");
  }
});

app.get("/api/crm/patient-notes", async (req, res) => {
  try {
    const { booking_id } = req.query;

    if (!booking_id) {
      return res.status(400).json({ error: "Falta booking_id" });
    }

    const rows = await dbAll(
      `SELECT * FROM crm_patient_notes
       WHERE booking_id = ?
       ORDER BY COALESCE(contacted_at, created_at) DESC, id DESC`,
      [String(booking_id)]
    );

    res.json({ _items: rows });
  } catch (error) {
    handleError(res, error, "Error obteniendo notas internas");
  }
});

app.post("/api/crm/patient-notes", async (req, res) => {
  try {
    const {
      booking_id,
      patient_key,
      note,
      contact_method,
      contacted_at,
      owner
    } = req.body || {};

    if (!booking_id || !note) {
      return res.status(400).json({ error: "Faltan booking_id o note" });
    }

    const now = new Date().toISOString();

    const inserted = await dbRun(
      `INSERT INTO crm_patient_notes
        (booking_id, patient_key, note, contact_method, contacted_at, owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        String(booking_id),
        patient_key ? String(patient_key) : "",
        String(note),
        contact_method ? String(contact_method) : "otro",
        contacted_at ? String(contacted_at) : now,
        owner ? String(owner) : "",
        now,
        now
      ]
    );

    const row = await dbGet(`SELECT * FROM crm_patient_notes WHERE id = ?`, [inserted.lastID]);
    res.status(201).json(row);
  } catch (error) {
    handleError(res, error, "Error creando nota interna");
  }
});

app.put("/api/crm/patient-notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const current = await dbGet(`SELECT * FROM crm_patient_notes WHERE id = ?`, [id]);

    if (!current) {
      return res.status(404).json({ error: "Nota no encontrada" });
    }

    const next = {
      booking_id: req.body.booking_id ?? current.booking_id,
      patient_key: req.body.patient_key ?? current.patient_key,
      note: req.body.note ?? current.note,
      contact_method: req.body.contact_method ?? current.contact_method,
      contacted_at: req.body.contacted_at ?? current.contacted_at,
      owner: req.body.owner ?? current.owner,
      updated_at: new Date().toISOString()
    };

    await dbRun(
      `UPDATE crm_patient_notes
       SET booking_id = ?, patient_key = ?, note = ?, contact_method = ?, contacted_at = ?, owner = ?, updated_at = ?
       WHERE id = ?`,
      [
        String(next.booking_id || ""),
        String(next.patient_key || ""),
        String(next.note || ""),
        String(next.contact_method || "otro"),
        String(next.contacted_at || ""),
        String(next.owner || ""),
        next.updated_at,
        id
      ]
    );

    const row = await dbGet(`SELECT * FROM crm_patient_notes WHERE id = ?`, [id]);
    res.json(row);
  } catch (error) {
    handleError(res, error, "Error actualizando nota interna");
  }
});

app.delete("/api/crm/patient-notes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await dbRun(`DELETE FROM crm_patient_notes WHERE id = ?`, [id]);

    if (!deleted.changes) {
      return res.status(404).json({ error: "Nota no encontrada" });
    }

    res.json({ ok: true });
  } catch (error) {
    handleError(res, error, "Error eliminando nota interna");
  }
});

app.listen(env().PORT, () => {
  console.log(`Backend activo en puerto ${env().PORT}`);
});
