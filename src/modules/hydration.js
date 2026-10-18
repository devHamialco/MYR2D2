'use strict';

const cron = require('node-cron');
const logger = require('../utils/logger');
const storage = require('../utils/storage');

const MESSAGES = {
  initial: 'Ya bebiste agua?',
  insist: 'Bebe agua we',
};

const DEFAULT_CONFIG = {
  cronSchedule: process.env.HYDRATION_CRON || '30 6 * * *',
  insistMs: Number(process.env.HYDRATION_INSIST_MS || 10 * 60 * 1000),
  cycleMs: Number(process.env.HYDRATION_CYCLE_MS || 2 * 60 * 60 * 1000),
};

// Single bot instance per process (CommonJS module-level runtime).
let runtime = null;

function persist() {
  const state = storage.loadState();
  state.hydration = {
    status: runtime.status,
    nextScheduledAt: runtime.nextScheduledAt,
  };
  storage.saveState(state);
}

function clearTimer(key) {
  if (runtime[key]) {
    clearTimeout(runtime[key]);
    runtime[key] = null;
  }
}

function clearAllTimers() {
  clearTimer('insistTimer');
  clearTimer('cycleTimer');
}

function fireInsist() {
  runtime.send(MESSAGES.insist);
  logger.info('hydration: insistence sent');
  scheduleInsist();
}

// RF2.2: repeat "Bebe agua we" every 10 minutes until confirmed.
function scheduleInsist() {
  clearTimer('insistTimer');
  runtime.nextScheduledAt = new Date(Date.now() + runtime.config.insistMs).toISOString();
  runtime.insistTimer = setTimeout(fireInsist, runtime.config.insistMs);
  persist();
}

// RF2.1: ask the initial question and start the insistence loop.
function askInitial() {
  clearAllTimers();
  runtime.status = 'AWAITING_CONFIRMATION';
  runtime.send(MESSAGES.initial);
  logger.info('hydration: initial question sent');
  scheduleInsist();
}

/**
 * Boot recovery per SAD 5.2: timers that expired while the process was down
 * fire immediately; future timers are rescheduled with their remaining time.
 */
function restoreTimers() {
  if (!runtime.nextScheduledAt) return;
  const due = new Date(runtime.nextScheduledAt).getTime();
  if (!Number.isFinite(due)) return;
  const remaining = due - Date.now();

  if (runtime.status === 'AWAITING_CONFIRMATION') {
    if (remaining <= 0) {
      runtime.send(MESSAGES.insist);
      logger.info('hydration: overdue insistence fired on boot');
      scheduleInsist();
    } else {
      runtime.insistTimer = setTimeout(fireInsist, remaining);
    }
  } else if (runtime.status === 'CONFIRMED') {
    if (remaining <= 0) {
      askInitial();
    } else {
      runtime.cycleTimer = setTimeout(askInitial, remaining);
    }
  }
}

/**
 * Initialize the hydration module.
 *
 * @param {object} options
 * @param {(text: string) => any} options.send outbound message function
 * @param {object} [options.config] overrides for cron/insist/cycle timings
 */
function init(options = {}) {
  const { send, config = {} } = options;
  if (typeof send !== 'function') {
    throw new TypeError('hydration.init requires a send function');
  }

  shutdown(); // re-init safe (tests, hot reload)

  runtime = {
    send,
    config: { ...DEFAULT_CONFIG, ...config },
    status: 'IDLE',
    nextScheduledAt: null,
    insistTimer: null,
    cycleTimer: null,
    cronJob: null,
  };

  const saved = storage.loadState().hydration || {};
  runtime.status = saved.status || 'IDLE';
  runtime.nextScheduledAt = saved.nextScheduledAt || null;

  runtime.cronJob = cron.schedule(runtime.config.cronSchedule, () => {
    logger.info('hydration: daily cron fired');
    askInitial();
  });

  restoreTimers();
  logger.info('hydration: module initialized');
}

/**
 * RF2.3/RF2.4: on user confirmation stop the insistence loop and schedule the
 * next "Ya bebiste agua?" for exactly two hours later.
 *
 * Only honored while an initial question is actually pending
 * (AWAITING_CONFIRMATION): stray affirmatives in idle conversation ("ya",
 * "sí" match RF2.3 words) must not invent a 2-hour cycle out of nowhere.
 *
 * @returns {boolean} true when a confirmation was accepted
 */
function handleConfirm() {
  if (!runtime) return false;
  if (runtime.status !== 'AWAITING_CONFIRMATION') {
    logger.debug(`hydration: confirm ignored (status ${runtime.status})`);
    return false;
  }
  clearAllTimers();
  runtime.status = 'CONFIRMED';
  runtime.nextScheduledAt = new Date(Date.now() + runtime.config.cycleMs).toISOString();
  persist();
  scheduleCycle();
  logger.info('hydration: confirmed, next question in 2h');
  return true;
}

function scheduleCycle() {
  clearTimer('cycleTimer');
  runtime.cycleTimer = setTimeout(askInitial, runtime.config.cycleMs);
}

function getStatus() {
  if (!runtime) return { status: 'UNINITIALIZED', nextScheduledAt: null };
  return { status: runtime.status, nextScheduledAt: runtime.nextScheduledAt };
}

function shutdown() {
  if (!runtime) return;
  clearAllTimers();
  if (runtime.cronJob) {
    runtime.cronJob.stop();
    runtime.cronJob = null;
  }
  runtime = null;
}

module.exports = { init, handleConfirm, getStatus, shutdown, MESSAGES };
