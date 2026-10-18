# Especificación de Requisitos del Sistema (SRS)

**Proyecto:** Bot Personal Asistente/Secretaria de WhatsApp ("R2D2")  
**Versión:** 1.0  
**Fecha:** Octubre 2026  
**Autor:** Desarrollador  

---

## 1. Introducción

### 1.1 Propósito
El propósito de este documento es definir de manera clara, detallada y formal la Especificación de Requisitos del Sistema (SRS) para el desarrollo del asistente virtual **R2D2** en WhatsApp. Este documento describe el comportamiento funcional, los requisitos no funcionales, las interfaces y las restricciones del sistema para servir como guía estricta de implementación.

### 1.2 Alcance del Sistema
R2D2 es un bot ejecutable en un entorno local o de servidor (Node.js) que se conecta a una cuenta de WhatsApp mediante simulación de cliente web (`whatsapp-web.js`). Actúa como una secretaria personal automatizada encargada de:
* Monitoreo e insistencia periódica de hidratación.
* Gestión de flujos de trabajo/estudio mediante la técnica Pomodoro adaptada.
* Creación de recordatorios temporales programados por texto.
* Gestión de una lista de tareas (*To-Do*) y sugerencia de actividades mediante notificaciones aleatorias.

### 1.3 Definiciones, Acrónimos y Abreviaturas
* **PMP:** Plan de Manejo de Proyecto.
* **SRS:** Especificación de Requisitos del Sistema (*System Requirements Specification*).
* **Regex:** Expresiones Regulares (*Regular Expressions*).
* **Cron:** Programador de tareas en sistemas operativos / entorno Node.js.
* **State Machine:** Máquina de estados finitos que controla los flujos del Pomodoro e hidratación.

---

## 2. Descripción General

### 2.1 Perspectiva del Producto
El sistema opera de forma autónoma dentro de un chat privado de WhatsApp (chat personal o grupo dedicado). No requiere la creación de una aplicación externa ni interfaz gráfica propia. Funciona procesando mensajes entrantes (*polling/events*) y disparando temporizadores internos (*timers/cron*) para enviar mensajes de salida.

```
+-------------------------------------------------------------------+
|                        Entorno Node.js                            |
|                                                                   |
|   +-----------------+     +-------------------+                   |
|   |   Parsers /     |<--->|   Controlador     |                   |
|   |  Comandos Regex |     |   de Estados      |                   |
|   +-----------------+     +-------------------+                   |
|                                     ^                             |
|                                     v                             |
|                           +-------------------+                   |
|                           | Temporizadores /  |                   |
|                           |  Cron Schedule    |                   |
|                           +-------------------+                   |
+-------------------------------------^-----------------------------+
                                      | (whatsapp-web.js)
                                      v
                        +---------------------------+
                        |  Chat de WhatsApp (R2D2)  |
                        +---------------------------+
```

### 2.2 Funciones del Producto
1. **Gestión de Hidratación (Water Loop):** Ciclo recurrente con confirmación e insistencia programada.
2. **Ciclo Pomodoro Adaptativo:** Estructura de trabajo continuo de 130 minutos dividida en intervalos con respuestas dinámicas.
3. **Recordatorios Ad-Hoc:** Parser de instrucciones temporales para agendar avisos específicos.
4. **Administración de Tareas Pospuestas (To-Do Randomizer):** Almacenamiento e interrupción aleatoria del usuario con la lista de pendientes.

### 2.3 Características de los Usuarios
* **Usuario Único:** Diseñado específicamente para un usuario en su chat privado de WhatsApp. Requiere interacción mediante respuestas en lenguaje natural simplificado.

### 2.4 Restricciones
* **Restricción de Plataforma:** Dependencia directa de la conexión de WhatsApp Web mediante `whatsapp-web.js`.
* **Persistencia Local:** Los temporizadores de corta duración en memoria (`setTimeout`) deben estar respaldados por un archivo de estado local para tolerar caídas del proceso.

---

## 3. Requisitos Específicos

### 3.1 Requisitos Funcionales (RF)

#### Módulo 1: Identidad e Interacción Base
* **RF1.1 - Autenticación y Persistencia:** El sistema debe autenticar la sesión de WhatsApp mediante escaneo de código QR en la primera ejecución y mantener la sesión persistente (`LocalAuth`).
* **RF1.2 - Personalidad R2D2:** Todas las respuestas emitidas por el bot deben asumir la identidad de un asistente llamado "R2D2", usando respuestas interactivas y ligeramente variadas.

#### Módulo 2: Alertas de Hidratación
* **RF2.1 - Disparo Inicial:** El sistema debe enviar el mensaje `"Ya bebiste agua?"` todos los días exactamente a las `06:30 AM`.
* **RF2.2 - Bucle de Insistencia:** Si el usuario no responde afirmativamente dentro de los siguientes 10 minutos, el bot debe enviar el mensaje `"Bebe agua we"` y repetir esta notificación cada 10 minutos de forma indefinida hasta obtener una confirmación.
* **RF2.3 - Reconocimiento Afirmativo:** El parser del bot debe interpretar como respuesta afirmativa entradas como: *"sí"*, *"si"*, *"ya"*, *"listo"*, *"listo ya"*, *"seep"*, *"sip"*, o *"check"*.
* **RF2.4 - Programación de Siguiente Ciclo:** Al recibir la respuesta afirmativa, el bot debe detener la insistencia y programar la siguiente pregunta (`"Ya bebiste agua?"`) para transcurridas exactamente **2 horas** a partir del momento de la confirmación.

#### Módulo 3: Flujo Pomodoro Adaptativo
* **RF3.1 - Invocación del Pomodoro:** El sistema debe activar el ciclo Pomodoro al detectar el mensaje de entrada: `"Voy a estudiar"` o `"Voy a trabajar"`.
* **RF3.2 - Confirmación de Inicio:** El bot debe responder de inmediato confirmando el inicio de la sesión de trabajo.
* **RF3.3 - Estructura de Intervalos de Trabajo/Descanso:**
  * **Trabajo 1:** 25 min $\rightarrow$ Mensaje de descanso corto (`"Te toca un break"`, `"Descansa 5 minutos"` o `"Puedes descansar"`).
  * **Descanso Corto 1:** 5 min $\rightarrow$ Mensaje de retorno (`"Regresa al trabajo"`, `"Terminó el break"`, etc.).
  * **Trabajo 2:** 25 min $\rightarrow$ Mensaje de descanso corto.
  * **Descanso Corto 2:** 5 min $\rightarrow$ Mensaje de retorno.
  * **Trabajo 3:** 25 min $\rightarrow$ Mensaje de descanso corto.
  * **Descanso Corto 3:** 5 min $\rightarrow$ Mensaje de retorno.
  * **Trabajo 4:** 25 min $\rightarrow$ Mensaje de descanso **largo** (`"Eres libre un rato"`, `"Descansa 15 minutos"`).
  * **Descanso Largo:** 15 min $\rightarrow$ Pregunta de cierre/continuación.
* **RF3.4 - Cierre e Interacción del Ciclo Completo (130 min):** Al finalizar los 15 minutos de descanso largo, el bot debe enviar un mensaje preguntando: `"¿Vas a continuar trabajando?"`.
  * Si el usuario responde **Sí**: Se inicia un nuevo ciclo completo de 130 minutos.
  * Si el usuario responde **No**: Se da por finalizada la sesión Pomodoro.

#### Módulo 4: Recordatorios Ad-hoc (Dinámicos)
* **RF4.1 - Parser de Comandos de Recordatorio:** El sistema debe procesar mensajes con la estructura:  
  `"recuérdame [acción/tarea] dentro de [N] minutos"` (o horas).
* **RF4.2 - Programación Dinámica:** El bot debe extraer la acción y el parámetro numérico del tiempo para agendar un temporizador exacto.
* **RF4.3 - Notificación de Confirmación y Ejecución:**
  * Al recibir la orden, el bot debe responder: `"Entendido, te recordaré [acción] en [N] minutos"`.
  * Al cumplirse el tiempo, debe enviar el mensaje: `"⏰ Recordatorio: [acción]"`.

#### Módulo 5: Gestión de Lista de Tareas y Disparador Aleatorio
* **RF5.1 - Adición de Tareas:** El bot debe reconocer mensajes con la estructura: `"añade [nombre de tarea] a las tareas"`.
* **RF5.2 - Almacenamiento Persistente:** La tarea debe registrarse de inmediato en un archivo JSON local (`data/tasks.json`).
* **RF5.3 - Envío Aleatorio de Tareas:** El sistema debe contar con un programador que, de forma aleatoria durante la jornada activa (entre **08:00 AM y 10:00 PM**), envíe un mensaje con la lista de tareas pendientes acumuladas sugiriendo avanzar en alguna de ellas. **Los envíos quedan suspendidos durante los intervalos de trabajo de 25 minutos del Pomodoro** (estado `WORKING`) para evitar distracciones durante la concentración; durante los descansos el envío está permitido.
* **RF5.4 - Limpieza/Completado de Tareas:** El sistema debe responder al comando `"elimina [tarea]"` o `"tarea completada [número/nombre]"` para remover elementos de la lista.

---

### 3.2 Requisitos No Funcionales (RNF)

#### RNF1 - Fiabilidad y Tolerancia a Fallos
* Si el servidor/script se reinicia por algún corte de energía o error, el estado activo del ciclo de agua, del Pomodoro y las tareas guardadas deben persistir mediante archivos JSON locales (`state.json`, `tasks.json`) para restaurar las cuentas regresivas al reconectarse.

#### RNF2 - Desempeño
* El tiempo de respuesta del bot ante cualquier comando directo enviado por el usuario debe ser menor a **3 segundos**.

#### RNF3 - Mantenibilidad y Arquitectura
* El código debe estar estructurado de forma modular (separando la lógica del cliente de WhatsApp, el parsing de expresiones regulares y los módulos de lógica de negocio).

#### RNF4 - Seguridad y Privacidad
* Las credenciales de sesión (`.wwebjs_auth/`) nunca deben incluirse en el control de versiones público (GitHub) mediante el uso estricto del archivo `.gitignore`.

---

## 4. Matriz de Trazabilidad (Requisitos vs. Módulos de Código)

| Requisito Funcional | Módulo Asociado en Código | Archivo Objetivo |
| :--- | :--- | :--- |
| **RF1.1, RF1.2** | Núcleo del Bot | `src/index.js` |
| **RF2.1 - RF2.4** | Módulo de Hidratación | `src/modules/hydration.js` |
| **RF3.1 - RF3.4** | Módulo Pomodoro | `src/modules/pomodoro.js` |
| **RF4.1 - RF4.3** | Módulo de Recordatorios Ad-hoc | `src/modules/reminders.js` |
| **RF5.1 - RF5.4** | Módulo de Tareas Aleatorias | `src/modules/tasks.js` |
| **Parsing General** | Expresiones Regulares | `src/parsers.js` |

---

## 5. Criterios de Validación del SRS

1. **Prueba de Hidratación:** Simular envío de alertas a las 06:30 AM y validar que tras un `"sí"` transcurran exactamente 2 horas antes de la siguiente pregunta.
2. **Prueba de Pomodoro:** Ejecutar un ciclo acelerado (ej. segundos en lugar de minutos) para validar la transición de 4 ciclos de trabajo, 3 descansos cortos, 1 descanso largo y la pregunta interactiva final.
3. **Prueba de Expresión Regular:** Evaluar que el parser detecte correctamente las distintas variantes de sintaxis para recordatorios y tareas.