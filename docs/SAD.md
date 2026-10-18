# Documento de Arquitectura de Software (SAD)

**Proyecto:** Bot Personal Asistente/Secretaria de WhatsApp ("R2D2")  
**Versión:** 1.0  
**Fecha:** Octubre 2026  
**Autor:** Desarrollador  

---

## 1. Introducción

### 1.1 Propósito
Este documento proporciona una visión general completa de la arquitectura de software del asistente virtual **R2D2**. Presenta las decisiones de diseño arquitectónico, patrones, estructura de componentes y modelo de datos implementados para cumplir con las especificaciones del SRS.

### 1.2 Alcance
Aplica a todo el código fuente, componentes del backend en Node.js, capa de integración con WhatsApp Web, motores de persistencia local y lógica de temporizadores.

---

## 2. Vista General de la Arquitectura

### 2.1 Estilo Arquitectónico
El sistema adopta una **Arquitectura Dirigida por Eventos (Event-Driven Architecture)** combinada con una **Estructura Modular Basada en Componentes**:

1. **Event-Driven (WhatsApp Layer):** Los mensajes entrantes del usuario generan eventos asíncronos (`message_create`) que son capturados y distribuidos por un orquestador central.
2. **State Machines (Lógica de Negocio):** Los módulos de *Pomodoro* e *Hidratación* operan como máquinas de estados finitos dirigidas por contadores de tiempo (*Timers/Cron*) e interacciones de texto.
3. **Persistencia Basada en Archivos (JSON File Storage):** Dado el alcance personal, se utiliza un modelo de persistencia ligero de estado y tareas en disco para garantizar tolerancia a reinicios del proceso.

---

## 3. Diagramas de Contenedores y Componentes

### 3.1 Diagrama de Bloques / Componentes

```
+-----------------------------------------------------------------------------------------+
|                                    ENTORNO NODE.JS                                      |
|                                                                                         |
|   +---------------------------------------------------------------------------------+   |
|   |                                  index.js                                       |   |
|   |                        (Orquestador de Eventos)                                 |   |
|   +---------------------------------------------------------------------------------+   |
|             |                                   |                             |         |
|             v                                   v                             v         |
|   +-------------------+               +-------------------+         +---------------+   |
|   |    parsers.js     |               |    Storage Engine |         | WhatsApp Client|   |
|   |  (Regex & Intent) |               |  (JSON Manager)   |         |(whatsapp-web)|   |
|   +-------------------+               +-------------------+         +---------------+   |
|             |                                   |                             ^         |
|             +-----------------+-----------------+                             |         |
|                               v                                               v         |
|   +---------------------------------------------------------------------------------+   |
|   |                              MÓDULOS DE NEGOCIO                                 |   |
|   |                                                                                 |   |
|   |  +----------------+   +----------------+   +---------------+   +-------------+  |   |
|   |  |  hydration.js  |   |  pomodoro.js   |   |  reminders.js |   |  tasks.js   |  |   |
|   |  | (Water Loop)   |   | (State Machine)|   | (Ad-hoc Cron) |   | (Task Pool) |  |   |
|   |  +----------------+   +----------------+   +---------------+   +-------------+  |   |
|   +---------------------------------------------------------------------------------+   |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Descripción de Componentes Principales

### 4.1 Client Orchestrator (`src/index.js`)
* **Responsabilidad:** Inicializa la sesión con `LocalAuth`, escucha el evento de mensajes entrantes y redirige el procesamiento al parser. Recibe las directivas de envío de los módulos y las transmite al chat objetivo.

### 4.2 Pattern & Parser Engine (`src/parsers.js`)
* **Responsabilidad:** Evalúa el contenido del texto mediante expresiones regulares para identificar la intención (*Intent*) y extraer variables (ej. minutos, texto de la tarea, palabras afirmativas).
* **Entradas:** Texto del mensaje en minúsculas y limpio.
* **Salidas:** Objeto `{ intent: STRING, payload: OBJECT }`.

### 4.3 Engine Módulos de Negocio

#### A. Hydration Module (`src/modules/hydration.js`)
* **Mecanismo:** Administra dos temporizadores: un `CronJob` diario a las 06:30 AM y un `setInterval` de 10 minutos para la insistencia ("Bebe agua we").
* **Transición:** Al recibir afirmación (`RF2.3`), limpia el intervalo activo y programa un `setTimeout` de 2 horas.

#### B. Pomodoro State Machine (`src/modules/pomodoro.js`)
* **Estados:** `IDLE`, `WORKING`, `SHORT_BREAK`, `LONG_BREAK`, `WAITING_CONTINUATION_RESPONSE`.
* **Secuencia de Ciclo (130 min):**
  1. `WORK_1` (25m) $\rightarrow$ `BREAK_1` (5m)
  2. `WORK_2` (25m) $\rightarrow$ `BREAK_2` (5m)
  3. `WORK_3` (25m) $\rightarrow$ `BREAK_3` (5m)
  4. `WORK_4` (25m) $\rightarrow$ `LONG_BREAK` (15m)
  5. `PROMPT_CONTINUE` $\rightarrow$ Espera respuesta (Sí/No).

#### C. Ad-Hoc Reminders (`src/modules/reminders.js`)
* **Mecanismo:** Registra temporizadores individuales dinámicos en memoria respaldados en `state.json`.

#### D. Task Randomizer (`src/modules/tasks.js`)
* **Mecanismo:** Mantiene un arreglo de tareas. Cuenta con un programador Cron que ejecuta una consulta de probabilidad aleatoria durante un rango de tiempo definido (08:00 - 22:00) para emitir notificaciones con los pendientes. Los envíos se suprimen mientras el Pomodoro está en estado `WORKING` mediante un gate (`canSend`) inyectado por el orquestador, sin que los módulos se importen entre sí.

---

## 5. Estrategia de Persistencia y Tolerancia a Fallos

Para evitar la pérdida de contexto cuando el proceso Node.js finalice o se reinicie, se implementa una persistencia sincronizada en archivos JSON:

### 5.1 Esquema de Archivos

#### `data/tasks.json`
```json
{
  "tasks": [
    {
      "id": 1,
      "text": "cepillar al gato",
      "createdAt": "2026-10-17T18:00:00.000Z"
    }
  ]
}
```

#### `data/state.json`
```json
{
  "hydration": {
    "status": "AWAITING_CONFIRMATION",
    "nextScheduledAt": "2026-10-17T20:30:00.000Z"
  },
  "pomodoro": {
    "currentState": "WORK_2",
    "cycleCount": 2,
    "endsAt": "2026-10-17T18:50:00.000Z"
  },
  "reminders": [
    {
      "id": "rem_102",
      "text": "sacar la basura",
      "triggerAt": "2026-10-17T19:00:00.000Z"
    }
  ]
}
```

### 5.2 Algoritmo de Recuperación al Iniciar (Bootstrapping)
1. Al iniciar `index.js`, el sistema lee `data/state.json`.
2. Calcula la diferencia temporal entre `triggerAt` / `endsAt` y la hora actual (`Date.now()`).
3. Si el tiempo expiró durante el apagado del servidor, ejecuta la alerta inmediatamente y restablece el flujo.
4. Si el tiempo aún no ha transcurrido, reconfigura el temporizador con el remanente en ms.

---

## 6. Atributos de Calidad y Consideraciones de Diseño

* **Modularity (Mantenibilidad):** Cada función del asistente R2D2 está completamente aislada en archivos dentro de `src/modules/`. Ningún módulo depende directamente de la implementación interna de otro.
* **Extensibilidad:** Añadir un nuevo comando implica agregar una nueva expresión regular en `parsers.js` y asociarla a una función en un nuevo archivo de módulo.
* **Consumo de Recursos:** Al funcionar de manera local sobre Node.js, la huella de memoria RAM se mantiene estimada en < 150 MB.