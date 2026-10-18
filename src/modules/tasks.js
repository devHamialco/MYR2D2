'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const storage = require('../utils/storage');
const { stripAccents } = require('../parsers');

const DEFAULT_CONFIG = {
  cronSchedule: process.env.TASKS_CRON || '*/30 8-21 * * *',
  timeFrom: process.env.TASKS_TIME_FROM || '08:00',
  timeTo: process.env.TASKS_TIME_TO || '22:00',
  probability: Number(process.env.TASKS_SEND_PROBABILITY || 0.3),
};

// Single bot instance per process (CommonJS module-level runtime).
let runtime = null;

function parseTime(hhmm) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Active sending window (user rule): 08:00-22:00 by default, enforced in
 * code in addition to the cron so custom crons cannot escape it.
 */
function inWindow(now = new Date()) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes >= runtime.config.fromMinutes && minutes <= runtime.config.toMinutes;
}

function buildMessage(tasks) {
  const lines = tasks.map((t, i) => `${i + 1}. ${t.text}`);
  return `📋 Tareas pendientes — ¿cuál atacas primero?\n${lines.join('\n')}`;
}

/**
 * Random-dispatch check (updated RF5.3): only inside the 08:00-22:00 window,
 * only when the injected canSend gate allows it (pomodoro work intervals
 * block sends so study sessions stay distraction-free), and only with the
 * configured probability.
 *
 * @returns {boolean} true when a message was sent
 */
function checkAndSend() {
  if (!runtime) return false;
  const { tasks } = storage.loadTasks();
  if (!tasks.length) return false;

  if (!inWindow()) {
    logger.debug('tasks: outside active window, skipped');
    return false;
  }
  if (!runtime.canSend()) {
    logger.debug('tasks: blocked by gate (pomodoro working), skipped');
    return false;
  }
  if (runtime.config.probability < 1 && Math.random() >= runtime.config.probability) {
    logger.debug('tasks: probability roll failed, skipped');
    return false;
  }

  runtime.send(buildMessage(tasks));
  logger.info(`tasks: sent random suggestion with ${tasks.length} task(s)`);
  return true;
}

/**
 * RF5.1/RF5.2: add a task and persist immediately to data/tasks.json.
 *
 * @param {string} text task description
 * @returns {{id: number, text: string, createdAt: string}}
 */
function addTask(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) throw new TypeError('tasks.addTask requires a non-empty text');

  const data = storage.loadTasks();
  const nextId = data.tasks.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0) + 1;
  const task = { id: nextId, text: cleaned, createdAt: new Date().toISOString() };
  data.tasks.push(task);
  storage.saveTasks(data);
  logger.info(`tasks: added #${nextId} "${cleaned}"`);
  return task;
}

/**
 * RF5.4: remove a task by id number or by (accent-insensitive) name match.
 *
 * @param {string} matcher digits (id) or free text (name substring)
 * @returns {{id: number, text: string, createdAt: string}|null} removed task
 */
function removeTask(matcher) {
  const needle = String(matcher || '').trim();
  if (!needle) return null;

  const data = storage.loadTasks();
  let index = -1;

  if (/^\d+$/.test(needle)) {
    const id = Number(needle);
    index = data.tasks.findIndex((t) => Number(t.id) === id);
  }
  if (index === -1) {
    const norm = stripAccents(needle).toLowerCase();
    index = data.tasks.findIndex(
      (t) => stripAccents(String(t.text)).toLowerCase().includes(norm)
    );
  }
  if (index === -1) {
    logger.info(`tasks: no match for "${needle}"`);
    return null;
  }

  const [removed] = data.tasks.splice(index, 1);
  storage.saveTasks(data);
  logger.info(`tasks: removed #${removed.id} "${removed.text}"`);
  return removed;
}

function listTasks() {
  return storage.loadTasks().tasks.slice();
}

/**
 * Initialize the tasks module: schedule the random dispatcher.
 *
 * @param {object} options
 * @param {(text: string) => any} options.send outbound message function
 * @param {() => boolean} [options.canSend] gate consulted before every
 *   dispatch (orchestrator injects () => !pomodoro.isWorking())
 * @param {object} [options.config] overrides (cron, window, probability)
 */
function init(options = {}) {
  const { send, canSend, config = {} } = options;
  if (typeof send !== 'function') {
    throw new TypeError('tasks.init requires a send function');
  }

  shutdown(); // re-init safe (tests, hot reload)

  const merged = { ...DEFAULT_CONFIG, ...config };
  const from = parseTime(merged.timeFrom);
  const to = parseTime(merged.timeTo);
  if (from == null || to == null) {
    throw new TypeError(`tasks: invalid window ${merged.timeFrom}-${merged.timeTo}`);
  }

  runtime = {
    send,
    canSend: typeof canSend === 'function' ? canSend : () => true,
    config: {
      cronSchedule: merged.cronSchedule,
      probability: Math.min(Math.max(Number(merged.probability), 0), 1),
      fromMinutes: from,
      toMinutes: to,
    },
    cronJob: null,
  };

  runtime.cronJob = cron.schedule(runtime.config.cronSchedule, () => {
    checkAndSend();
  });
  logger.info(
    `tasks: module initialized (window ${merged.timeFrom}-${merged.timeTo}, p=${runtime.config.probability})`
  );
}

function shutdown() {
  if (!runtime) return;
  if (runtime.cronJob) {
    runtime.cronJob.stop();
    runtime.cronJob = null;
  }
  runtime = null;
}

module.exports = { init, addTask, removeTask, listTasks, checkAndSend, buildMessage, shutdown };
