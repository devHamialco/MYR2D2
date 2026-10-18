# Plan de Manejo de Proyecto (PMP)

**Proyecto:** Bot Personal Asistente/Secretaria de WhatsApp ("R2D2")

**Autor:** Desarrollador

**Versión:** 2.0

**Fecha:** Octubre 2026

## 1. Introducción y Alcance del Proyecto

### 1.1 Propósito

Desarrollar un asistente virtual interactivo en Node.js nombrado **R2D2** a través de WhatsApp. El bot funcionará como una secretaria personal automatizada encargada de gestionar alertas de hidratación, un flujo de trabajo enfocado con la Técnica Pomodoro, avisos/recordatorios programados ad-hoc y gestión de listas de tareas (*To-Do*) enviadas aleatoriamente a lo largo del día.

### 1.2 Alcance Incluido (*In-Scope*)

* **Identidad e Interacción:** Integración con la librería `whatsapp-web.js` operando bajo la identidad de R2D2 con persistencia de sesión (`LocalAuth`).
* **Módulo de Hidratación:**
  * Alerta inicial diaria a las 06:30 AM ("Ya bebiste agua?").
  * Bucle de insistencia cada 10 minutos ("Bebe agua we") mientras no exista respuesta afirmativa.
  * Reinicio de ciclo de hidratación programado a las 2 horas posteriores a la confirmación del usuario.
* **Módulo Pomodoro Adaptativo:**
  * Activación mediante el mensaje de activación: *"Voy a estudiar/trabajar"*.
  * Ciclo de trabajo estándar: 25 min trabajo / 5 min descanso corto (4 repeticiones).
  * Descanso largo: 15 min al finalizar el 4.º intervalo de trabajo.
  * Cierre o reinicio interactivo del ciclo completo (130 min totales) al finalizar el descanso largo.
  * Generación dinámica/aleatoria de respuestas interactivas ("Te toca un break", "Regresa al trabajo", etc.).
* **Módulo de Recordatorios Dinámicos (Ad-hoc):**
  * Procesamiento de comandos para programar alertas temporales en lenguaje natural (Ej: *"recuérdame hacer [X] dentro de [Y] minutos"*).
* **Módulo de Gestión de Tareas (To-Do List) y Disparos Aleatorios:**
  * Reconocimiento e inclusión de tareas mediante el comando *"añade [tarea] a las tareas"*.
  * Almacenamiento dinámico de la lista de pendientes.
  * Mecanismo de envío aleatorio (*random trigger*) de la lista a lo largo del día para sugerir actividades.

### 1.3 Alcance Excluido (*Out-of-Scope*)

* Creación de interfaces web o aplicaciones móviles independientes (todo opera 100% dentro del chat de WhatsApp).
* Integración con APIs pagadas de Inteligencia Artificial (LLMs) para esta versión base (el procesamiento se realiza con reglas y expresiones regulares / *regex*).
* Despliegue en entornos multi-usuario o comerciales.

---

## 2. Requisitos del Sistema y Entorno

* **Node.js:** v18.x o superior.
* **Control de Versiones:** Git y repositorio en GitHub.
* **Persistencia:** Archivos JSON locales o base de datos ligera (SQLite/NeDB) para guardar la lista de tareas y estados del ciclo sin perder la información al reiniciar el script.
* **Procesamiento de Tareas / Tiempos:** Uso de `node-cron` para cronogramas fijos y temporizadores en memoria / agendas persistentes para cuentas regresivas dinámicas (`setTimeout` / `agenda`).

---

## 3. Arquitectura del Proyecto

```
whatsapp-reminder-bot/
├── .wwebjs_auth/        # Datos de sesión local de WhatsApp (Ignorado en Git)
├── .gitignore           # Exclusión de credenciales y node_modules
├── package.json         # Dependencias del proyecto
├── README.md            # Documentación del proyecto
├── data/
│   └── tasks.json       # Persistencia local de la lista de tareas pendientes
└── src/
    ├── index.js          # Punto de entrada y manejo de eventos de WhatsApp
    ├── parsers.js        # Análisis de texto e intenciones (regex para comandos)
    ├── modules/
    │   ├── hydration.js  # Lógica del ciclo de agua y reintentos
    │   ├── pomodoro.js   # Máquina de estados para la técnica Pomodoro
    │   ├── reminders.js  # Temporizadores dinámicos para recordatorios específicos
    │   └── tasks.js      # Gestión de lista de tareas y disparador aleatorio
    └── utils/
        └── logger.js     # Registros de actividad en consola
```

---

## 4. Plan de Trabajo por Fases (WBS / EDT)

### Fase 1: Estructuración y Configuración Base

1. Actualización del repositorio e instalación de librerías (`whatsapp-web.js`, `qrcode-terminal`, `node-cron`).
2. Configuración de la persistencia de autenticación (`LocalAuth`) y reglas de `.gitignore`.
3. Diseño de la arquitectura modular de código para procesar mensajes entrantes y programar eventos salientes.

### Fase 2: Módulo de Hidratación y Temporización Fija

1. Implementación de tarea programada con `node-cron` a las 06:30 AM.
2. Programación de la lógica de reintentos acumulativos (bucle de 10 minutos) si no hay confirmación.
3. Evaluación de respuestas afirmativas (reconocimiento de palabras como "sí", "ya", "listo", "seep") y programación del temporizador de 2 horas.

### Fase 3: Módulo Pomodoro y Parser de Mensajes

1. Creación del reconocedor de comandos iniciales (*"Voy a estudiar/trabajar"*).
2. Construcción de la máquina de estados del Pomodoro:
   * 4 ciclos de 25 min de trabajo + 5 min descanso.
   * 1 ciclo de 15 min de descanso largo al completar 100 min acumulados de trabajo.
3. Implementación de menú interactivo al finalizar el descanso largo para confirmar continuación o cierre del flujo.
4. Generación del banco de frases dinámicas para las alertas de R2D2.

### Fase 4: Recordatorios Ad-hoc y Lista de Tareas Aleatoria

1. Implementación del extractor de parámetros para instrucciones del tipo: *"recuérdame [tarea] dentro de [N] minutos"*.
2. Creación del módulo de registro e inserción de tareas (*"añade [tarea] a las tareas"*).
3. Configuración de un algoritmo de probabilidad/aleatoriedad con `node-cron` para consultar la lista de tareas y enviarla en horarios imprevistos durante el día.

### Fase 5: Pruebas Integrales y Documentación

1. Realización de pruebas con tiempos acelerados (ej. minutos en lugar de horas) para validar transiciones de estado.
2. Manejo de excepciones (reinicio del bot durante un temporizador activo).
3. Documentación final de uso en `README.md` y actualización en GitHub.

---

## 5. Gestión de Riesgos

| Riesgo | Impacto | Mitigación |
| ----- | ----- | ----- |
| **Pérdida de temporizadores al reiniciar el servidor** | Alto | Guardar los estados activos del Pomodoro y recordatorios en un archivo de estado local (`state.json`). |
| **Reconocimiento fallido de afirmación del usuario** | Medio | Utilizar expresiones regulares flexibles que detecten variaciones afirmativas ("si", "sí", "listo", "ya tome", "check"). |
| **Fuga de datos de sesión en GitHub** | Alto | Mantener `.wwebjs_auth/` e historias de mensajes excluidos mediante `.gitignore`. |
| **Bloqueo por envíos automatizados frecuentes** | Bajo | Dado que es un chat consigo mismo o con su propio número, el flujo no infringe patrones de spam masivo. |

---

## 6. Criterios de Aceptación del Proyecto

1. **R2D2** envía la pregunta inicial a las 06:30 AM y repite la insistencia cada 10 min si se ignora, reseteando a 2 horas al recibir un "sí".
2. La instrucción *"Voy a estudiar/trabajar"* detona la secuencia Pomodoro exacta (25m/5m x4 -> 15m) con opción de reinicio/finalización al concluir los 130 minutos.
3. La sintaxis de recordatorio dinámico crea una alerta efectiva tras transcurrir los minutos solicitados.
4. La adición de tareas guarda los elementos en almacenamiento local y se envían sugerencias aleatorias durante el transcurso de la jornada.
5. El código fuente completo está debidamente modularizado y publicado en el repositorio de GitHub.