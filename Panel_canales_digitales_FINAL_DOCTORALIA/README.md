# Panel canales digitales + integración Doctoralia / Docplanner

Estructura aplicada según el informe técnico adjunto:

```txt
Panel_canales_digitales_FINAL_DOCTORALIA/
  frontend/
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
  backend/
    server.js
    package.json
    .env.example
    .env.sandbox.example
    .env.production.example
    README_DOCTORALIA.md
    doctoralia.postman_collection.json
```

## Arranque local

Backend:

```bash
cd backend
npm install
cp .env.sandbox.example .env
npm run dev
```

Frontend:

```bash
cd frontend
python3 -m http.server 3000
```

Abrir:

```txt
http://localhost:3000/crm.html
```

## Aplicado

- Separación frontend/backend.
- Backend Node.js + Express.
- OAuth2 `client_credentials` preparado.
- Variables `.env.example`, `.env.sandbox.example` y `.env.production.example` preparadas.
- Endpoints internos de Doctoralia creados.
- Bootstrap ampliado para validar `facilities`, `doctors`, `addresses` y `services`.
- Base de datos SQLite local creada desde backend.
- Caché de reservas.
- Registro de eventos webhook.
- `crm.html` mantiene `localStorage` como apoyo temporal.
- `crm.html` añade carga real desde backend para reservas y pacientes Doctoralia.
- Pacientes obtenidos desde reservas con `with=booking.patient`.
- Colección Postman incluida.

## No incluido por alcance

No se ha tocado finanzas, chat, reputación, campañas, DPphone, Noa ni documentación médica avanzada.
