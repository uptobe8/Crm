# Panel de canales digitales FINAL

Abrir `index.html`.

App local multipágina, sin dependencias externas, con CSS y JS embebidos por página.

Incluye:
- Panel general.
- Una página real por canal.
- Enlaces HTML reales entre páginas.
- Botones con onclick directo para máxima compatibilidad local/móvil.
- Simulación de leads, cualificados, presupuestos, ventas, inversión, fuga y lead desde API.
- Página de integraciones API.
- Validación de enlaces y botones incluida en `VALIDACION.json`.


## Cambios v2
- Botón "Ver panel completo" debajo de cada cuadro del panel general.
- Inversión visible en cada cuadro general.
- Resumen ejecutivo con mapa de calor.
- Cuadros superiores de resultado en cada canal coloreados según rendimiento.


## CRM v3

Nueva zona independiente: `crm.html`.

Funcionalidad:
- Crear leads con datos completos.
- Asignar responsable de llamada.
- Registrar canal de entrada.
- Registrar día y hora de entrada automáticamente.
- Tres opciones de contacto: WhatsApp, llamar y mail.
- Al contactar, el lead se duplica en un segundo panel CRM con:
  - mismos datos del lead,
  - método de contacto,
  - día y hora de contacto,
  - responsable,
  - campo editable de notas.
