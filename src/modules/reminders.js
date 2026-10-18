'use strict';

const logger = require('../utils/logger');
const storage = require('../utils/storage');

// Single bot instance per process (CommonJS module-level runtime).
let runtime = null;

function persist() {
  const state = storage.loadState();
  state.reminders = runtime.reminders.map((r) => ({
    id: r.id,
    text: r.text,
    triggerAt: r.triggerAt,
  }));
  storage.saveState(state);
}

function fire(reminder) {
  const idx = runtime.reminders.findIndex((r) => r.id === reminder.id);
  if (idx !== -1) {
    runtime.reminders.splice(idx, 1);
    persist();
  }
  runtime.send(`⏰ Recordatorio: ${reminder.text}`);
  logger.info(`reminders: fired ${reminder.id}`);
}

function arm(reminder, delayMs) {
  reminder.timer = setTimeout(() => fire(reminder), delayMs);
}

/**
 * RF4.2: schedule a dynamic reminder.
 *
 * @param {string} text reminder body (user action)
 * @param {number} delayMs delay from now in milliseconds
 * @returns {{id: string, text: string, triggerAt: string}} persisted reminder
 */
function schedule(text, delayMs) {
  if (!runtime) throw new Error('reminders: module not initialized');
  if (!text || !Number.isFinite(delayMs) || delayMs <= 0) {
    throw new TypeError('reminders.schedule requires text and a positive delayMs');
  }

  const reminder = {
    id: `rem_${Date.now().toString(36)}_${runtime.seq += 1}`,
    text,
    triggerAt: new Date(Date.now() + delayMs).toISOString(),
    timer: null,
  };
  runtime.reminders.push(reminder);
  arm(reminder, delayMs);
  persist();
  logger.info(`reminders: scheduled ${reminder.id} at ${reminder.triggerAt}`);
  return { id: reminder.id, text: reminder.text, triggerAt: reminder.triggerAt };
}

/**
 * Boot recovery per SAD 5.2: reminders that expired while the process was
 * down fire immediately; future ones reschedule with their remaining time.
 */
function restoreSaved() {
  const saved = Array.isArray(storage.loadState().reminders) ? storage.loadState().reminders : [];
  for (const entry of saved) {
    if (!entry || !entry.text || !entry.triggerAt) continue;
    const due = new Date(entry.triggerAt).getTime();
    if (!Number.isFinite(due)) continue;
    const remaining = due - Date.now();
    const reminder = {
      id: entry.id,
      text: entry.text,
      triggerAt: entry.triggerAt,
      timer: null,
    };
    runtime.reminders.push(reminder);
    if (remaining <= 0) {
      logger.info(`reminders: overdue ${reminder.id} fired on boot`);
      fire(reminder); // fire() removes + persists
    } else {
      arm(reminder, remaining);
    }
  }
  persist();
}

/**
 * Initialize the reminders module and restore persisted timers.
 *
 * @param {object} options
 * @param {(text: string) => any} options.send outbound message function
 */
function init(options = {}) {
  const { send } = options;
  if (typeof send !== 'function') {
    throw new TypeError('reminders.init requires a send function');
  }

  shutdown(); // re-init safe (tests, hot reload)

  runtime = { send, reminders: [], seq: 0 };
  restoreSaved();
  logger.info(`reminders: module initialized with ${runtime.reminders.length} active`);
}

function list() {
  if (!runtime) return [];
  return runtime.reminders.map((r) => ({ id: r.id, text: r.text, triggerAt: r.triggerAt }));
}

function shutdown() {
  if (!runtime) return;
  for (const reminder of runtime.reminders) {
    if (reminder.timer) clearTimeout(reminder.timer);
  }
  runtime = null;
}

module.exports = { init, schedule, list, shutdown };
