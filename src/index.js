'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');

// Load .env BEFORE requiring modules: they capture process.env defaults at
// module load time. Existing process.env values always win over .env entries.
const FILE_ENV = loadEnvFile();
for (const [key, value] of Object.entries(FILE_ENV)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const storage = require('./utils/storage');
const { parseMessage, INTENTS } = require('./parsers');
const hydration = require('./modules/hydration');
const pomodoro = require('./modules/pomodoro');
const reminders = require('./modules/reminders');
const tasks = require('./modules/tasks');

const HELP_TEXT = [
  '🤖 Soy R2D2, tu asistente. Comandos:',
  '',
  '💧 Responde "sí" cuando tomes agua',
  '📚 "voy a estudiar" o "voy a trabajar" → Pomodoro (25/5)',
  '⏰ "recuérdame [acción] dentro de [N] minutos"',
  '✅ "añade [tarea] a las tareas"',
  '🗑️ "elimina [tarea]" o "tarea completada [id]"',
  '❓ "ayuda" → este mensaje',
].join('\n');

/**
 * Minimal .env reader (KEY=VALUE lines, # comments, optional quotes).
 * No external dependency on purpose.
 *
 * @param {string} [file]
 * @returns {Record<string, string>} entries found in the file
 */
function loadEnvFile(file = path.join(process.cwd(), '.env')) {
  try {
    if (!fs.existsSync(file)) return {};
    const out = {};
    for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      out[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
    return out;
  } catch (err) {
    logger.warn(`env: could not read ${file}: ${err.message}`);
    return {};
  }
}

/**
 * Decide whether an incoming message should be processed.
 * In the self-chat both sides are fromMe, so bot messages are filtered by
 * their recorded message ids instead of the fromMe flag.
 *
 * @param {object} msg whatsapp-web.js Message
 * @param {string|null} targetChatId resolved target chat JID
 * @param {Set<string>} botMessageIds ids of messages the bot itself sent
 * @returns {boolean}
 */
function shouldProcess(msg, targetChatId, botMessageIds) {
  if (!msg || !msg.from || !targetChatId) return false;
  if (msg.from === 'status@broadcast' || msg.isStatus) return false;
  if (!msg.body || !String(msg.body).trim()) return false;
  const id = msg.id && msg.id._serialized;
  if (id && botMessageIds.has(id)) return false;
  return msg.from === targetChatId;
}

/**
 * Build the intent router with injected dependencies (testable without a
 * real WhatsApp connection).
 *
 * @param {object} deps
 * @param {(text: string) => Promise<any>} deps.send
 * @param {() => string|null} deps.getTargetChatId
 * @param {Set<string>} deps.botMessageIds
 * @param {object} deps.hydration pomodoro/reminders/tasks module refs
 * @param {(text: string, ctx?: object) => {intent: string, payload: object}} deps.parseMessage
 * @param {object} deps.logger
 * @returns {(msg: object) => Promise<void>}
 */
function createMessageHandler(deps) {
  const { send, getTargetChatId, botMessageIds, parseMessage: parse } = deps;

  return async function onMessage(msg) {
    if (!shouldProcess(msg, getTargetChatId(), botMessageIds)) return;

    try {
      const context = {
        awaitingPomodoroContinuation: deps.pomodoro.awaitingContinuation(),
      };
      const { intent, payload } = parse(msg.body, context);
      deps.logger.debug(`intent ${intent}: "${msg.body}"`);

      switch (intent) {
        case INTENTS.HYDRATION_CONFIRM: {
          deps.hydration.handleConfirm();
          break;
        }
        case INTENTS.POMODORO_START: {
          deps.pomodoro.start();
          break;
        }
        case INTENTS.POMODORO_CONTINUE_YES: {
          deps.pomodoro.handleContinuation(true);
          break;
        }
        case INTENTS.POMODORO_CONTINUE_NO: {
          deps.pomodoro.handleContinuation(false);
          break;
        }
        case INTENTS.REMINDER_CREATE: {
          // RF4.3: exact confirmation before the timer runs.
          deps.reminders.schedule(payload.task, payload.delayMs);
          await send(`Entendido, te recordaré ${payload.task} en ${payload.amount} ${payload.unit}`);
          break;
        }
        case INTENTS.TASK_ADD: {
          const created = deps.tasks.addTask(payload.text);
          await send(`✅ Añadida: ${created.text}`);
          break;
        }
        case INTENTS.TASK_REMOVE: {
          const removed = deps.tasks.removeTask(payload.match);
          await send(
            removed
              ? `🗑️ Eliminada: ${removed.text}`
              : `No encontré "${payload.match}" en tus tareas.`
          );
          break;
        }
        case INTENTS.HELP: {
          await send(HELP_TEXT);
          break;
        }
        default:
          // UNKNOWN: stay silent so unrelated chat noise gets no reply.
          break;
      }
    } catch (err) {
      deps.logger.error('message handling failed', err);
    }
  };
}

/**
 * Serialize message_create processing against in-flight sends.
 *
 * In the self-chat, whatsapp-web.js can emit `message_create` for a message
 * the bot just sent BEFORE the sendMessage promise settles — so id recording
 * would lag the event and the bot could parse its own text ("ya bebiste
 * agua?" would self-confirm, help text would self-add tasks, etc).
 * The queue defers every event while any send is still settling, guaranteeing
 * ids are recorded before handling.
 *
 * @param {(msg: object) => Promise<void>} onMessage
 * @param {Set<Promise<any>>} inFlight send promises currently pending
 * @param {object} [log] logger for the safety net
 * @returns {{enqueue: (msg: object) => Promise<void>, size: () => number}}
 */
function createSerialMessageQueue(onMessage, inFlight, log) {
  const queue = [];
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (queue.length > 0) {
        if (inFlight.size > 0) {
          // Wait for pending sends to record their ids, then re-check: a new
          // send may have started during the await (loop condition refreshes).
          await Promise.allSettled([...inFlight]);
          continue;
        }
        const msg = queue.shift();
        try {
          await onMessage(msg);
        } catch (err) {
          // onMessage catches internally; safety net so one bad event
          // never stalls the queue.
          if (log) log.error('queued message handling failed', err);
        }
      }
    } finally {
      draining = false;
    }
  }

  return {
    enqueue(msg) {
      queue.push(msg);
      return drain();
    },
    size: () => queue.length,
  };
}

async function main() {
  storage.init(process.env.DATA_DIR);

  const client = new Client({ authStrategy: new LocalAuth() });
  let targetChatId = null;
  const botMessageIds = new Set();
  const inFlightSends = new Set();

  // Modules share this send function; recorded ids keep the bot from
  // reacting to its own messages in the self-chat. Failures are logged and
  // swallowed so a transient sendMessage rejection never crashes timers (RNF1).
  const send = (text) => {
    if (!targetChatId) {
      logger.warn('send skipped: target chat not resolved yet');
      return Promise.resolve(null);
    }
    const pending = (async () => {
      try {
        const sent = await client.sendMessage(targetChatId, text);
        const id = sent && sent.id && sent.id._serialized;
        if (id) {
          botMessageIds.add(id);
          if (botMessageIds.size > 500) {
            botMessageIds.delete(botMessageIds.values().next().value);
          }
        }
        return sent;
      } catch (err) {
        logger.error(`sendMessage failed: ${err.message}`);
        return null;
      }
    })();
    inFlightSends.add(pending);
    pending.finally(() => inFlightSends.delete(pending));
    return pending;
  };

  client.on('qr', (qr) => {
    logger.info('Escanea este código QR con tu WhatsApp (Primario → Dispositivos vinculados)');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    try {
      const configured = process.env.TARGET_CHAT_ID;
      if (!configured || configured === 'me') {
        const me = await client.getMe();
        targetChatId = `${me.id.user}@${me.id.server}`;
      } else {
        targetChatId = configured;
      }
      logger.info(`R2D2 listo — chat objetivo: ${targetChatId}`);

      // Init order: all modules get the same send; tasks receives the gate
      // that suspends dispatches during pomodoro WORKING intervals (SAD 4.1,
      // modules never import each other).
      hydration.init({ send });
      pomodoro.init({ send });
      reminders.init({ send });
      tasks.init({ send, canSend: () => !pomodoro.isWorking() });
      logger.info('Módulos inicializados: hydration, pomodoro, reminders, tasks');
    } catch (err) {
      logger.error('module initialization failed', err);
    }
  });

  const onMessage = createMessageHandler({
    send,
    getTargetChatId: () => targetChatId,
    botMessageIds,
    hydration,
    pomodoro,
    reminders,
    tasks,
    parseMessage,
    logger,
  });
  const messageQueue = createSerialMessageQueue(onMessage, inFlightSends, logger);
  client.on('message_create', (msg) => {
    messageQueue.enqueue(msg);
  });

  client.on('disconnected', (reason) => {
    logger.warn(`WhatsApp disconnected: ${reason}`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down`);
    hydration.shutdown();
    pomodoro.shutdown();
    reminders.shutdown();
    tasks.shutdown();
    try {
      await client.destroy();
    } catch (err) {
      logger.warn(`client destroy failed: ${err.message}`);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  await client.initialize();
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('fatal startup error', err);
    process.exit(1);
  });
}

module.exports = {
  loadEnvFile,
  shouldProcess,
  createMessageHandler,
  createSerialMessageQueue,
  HELP_TEXT,
  main,
};
