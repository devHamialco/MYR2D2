# R2D2 — Asistente personal de WhatsApp

Bot de WhatsApp que funciona como secretaria personal automatizada: te recuerda beber agua, gestiona tus sesiones Pomodoro, crea recordatorios temporales y te sugiere tareas pendientes. Corre 100% en local con Node.js, sin APIs de IA — todo el procesamiento es por expresiones regulares.

## Ruta rápida

1. `npm install` (instala dependencias; para usar el bot real, revisa `PUPPETEER_SKIP_DOWNLOAD` abajo).
2. Copia `.env.example` a `.env` y ajusta `TARGET_CHAT_ID` (déjalo en `me` para chatear contigo mismo).
3. `npm start` y escanea el código QR con tu WhatsApp (Primario → Dispositivos vinculados → Vincular dispositivo).
4. Escribe `ayuda` en el chat: R2D2 debe responder con la lista de comandos.

## Comandos

| Escribes | R2D2 hace |
| --- | --- |
| `sí` / `ya` / `listo` (cuando tomas agua) | Confirma hidratación; siguiente pregunta en 2 h |
| `voy a estudiar` o `voy a trabajar` | Inicia Pomodoro: 25/5 ×4 + 15 min + pregunta final |
| `recuérdame [acción] dentro de [N] minutos` | Agenda y confirma el recordatorio |
| `añade [tarea] a las tareas` | Guarda la tarea en `data/tasks.json` |
| `elimina [tarea]` o `tarea completada [id]` | Quita la tarea de la lista |
| `ayuda` | Muestra este resumen |

Además, de forma automática:

- **Hidratación:** pregunta diaria a las 06:30; insiste cada 10 min hasta que confirmes; al confirmar, siguiente pregunta en 2 h.
- **Tareas aleatorias:** entre **08:00 y 22:00** sugiere pendientes con probabilidad configurable, **suspendido durante los 25 min de trabajo del Pomodoro** (los descansos sí reciben sugerencias).

## Variables de entorno (`.env`)

| Variable | Default | Descripción |
| --- | --- | --- |
| `TARGET_CHAT_ID` | `me` | Chat objetivo: `me` (tú mismo) o un JID completo `521...@c.us` |
| `PUPPETEER_SKIP_DOWNLOAD` | `true` en el ejemplo | Ponla en `false` si necesitas que se descargue Chromium para el login real |
| `HYDRATION_CRON` | `30 6 * * *` | Horario de la pregunta diaria de agua |
| `POMODORO_WORK_MS` / `POMODORO_SHORT_BREAK_MS` / `POMODORO_LONG_BREAK_MS` | 25/5/15 min | Duraciones del Pomodoro (sobreescribibles para pruebas aceleradas) |
| `TASKS_CRON` | `*/30 8-21 * * *` | Frecuencia del chequeo aleatorio de tareas |
| `TASKS_TIME_FROM` / `TASKS_TIME_TO` | `08:00` / `22:00` | Ventana activa de sugerencias (regla del usuario) |
| `TASKS_SEND_PROBABILITY` | `0.3` | Probabilidad de enviar la lista en cada chequeo |
| `DATA_DIR` | `./data` | Carpeta de persistencia (`state.json`, `tasks.json`) |

## Tests

```bash
npm test
```

Suite completa (94 tests) con Jest y timers simulados: parsers, hidratación (bucle, confirmación, recuperación al arranque), Pomodoro (ciclo completo de 130 min), recordatorios, tareas (ventana 8–22 y supresión durante trabajo) y enrutamiento del orquestador. **No requiere conexión a WhatsApp.**

## Arquitectura

Orquestador event-driven con máquinas de estados y persistencia JSON — ver `docs/SAD.md` (diseño), `docs/SRS.md` (requisitos) y `docs/PMP.md` (plan). Estructura:

```
src/
├── index.js          # Cliente WhatsApp, QR, enrutamiento de intenciones
├── parsers.js        # Intento + payload desde regex (puro)
├── modules/
│   ├── hydration.js  # Bucle de agua 06:30 + insistencia 10 min
│   ├── pomodoro.js   # Máquina de estados 25/5 ×4 + 15
│   ├── reminders.js  # Temporizadores ad-hoc persistentes
│   └── tasks.js      # Lista + disparo aleatorio con gate de concentración
└── utils/            # storage.json-atómico y logger
```

## Checklist de aceptación

- [ ] Pregunta de agua a las 06:30, insiste cada 10 min, reset de 2 h tras `sí`.
- [ ] `voy a estudiar` corre el ciclo exacto 25/5 ×4 → 15 → pregunta de continuación.
- [ ] `recuérdame X dentro de N minutos` dispara exactamente a los N minutos.
- [ ] Las tareas se persisten, se sugieren 08:00–22:00 y **no** durante el trabajo del Pomodoro.
- [ ] El estado sobrevive reinicios (`data/state.json` se restaura al arrancar).

## Próximo paso

`npm start`, escanea el QR y manda `ayuda`. Si algo falla, revisa los logs con prefijo de timestamp en consola.
