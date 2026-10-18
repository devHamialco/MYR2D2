'use strict';

const logger = require('../utils/logger');
const storage = require('../utils/storage');

const STATES = {
  IDLE: 'IDLE',
  WORKING: 'WORKING',
  SHORT_BREAK: 'SHORT_BREAK',
  LONG_BREAK: 'LONG_BREAK',
  WAITING_CONTINUATION_RESPONSE: 'WAITING_CONTINUATION_RESPONSE',
};

const TOTAL_CYCLES = 4;

const DEFAULT_CONFIG = {
  workMs: Number(process.env.POMODORO_WORK_MS || 25 * 60 * 1000),
  shortBreakMs: Number(process.env.POMODORO_SHORT_BREAK_MS || 5 * 60 * 1000),
  longBreakMs: Number(process.env.POMODORO_LONG_BREAK_MS || 15 * 60 * 1000),
};

const MESSAGES = {
  started: '¡Dale! Modo Pomodoro activado: 25 minutos de concentración.',
  finished: 'Sesión Pomodoro finalizada. ¡Buen trabajo!',
  continuePrompt: '¿Vas a continuar trabajando?',
};

// Random phrase banks (RF3.3): every transition picks one variant.
const PHRASES = {
  toShortBreak: [
    'Te toca un break',
    'Descansa 5 minutos',
    'Puedes descansar',
    '¡Break! Levántate y estira un poco',
    'Pausa corta: 5 minutos para recargar',
  ],
  toWork: [
    'Regresa al trabajo',
    'Terminó el break',
    '¡De vuelta a la carga!',
    'Se acabó la pausa, retomamos',
    'Time on: otra ronda de 25 minutos',
  ],
  toLongBreak: [
    'Eres libre un rato',
    'Descansa 15 minutos',
    '¡Ciclo completo! Toca descanso largo',
    '15 minutos de libertad, ya la ganaste',
    'Gran pausa: respira y desconecta',
  ],
};

// Single bot instance per process (CommonJS module-level runtime).
let runtime = null;

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function persist() {
  const state = storage.loadState();
  state.pomodoro = {
    currentState: runtime.state,
    cycleCount: runtime.cycleCount,
    endsAt: runtime.endsAt,
  };
  storage.saveState(state);
}

function enterState(state, message, durationMs) {
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  runtime.state = state;
  if (message) runtime.send(message);
  if (durationMs == null) {
    runtime.endsAt = null;
    persist();
    return;
  }
  runtime.endsAt = new Date(Date.now() + durationMs).toISOString();
  runtime.timer = setTimeout(advanceState, durationMs);
  persist();
}

/**
 * Transition performed when the current state's timer expires.
 * WORKING(1..3) -> SHORT_BREAK -> WORKING(n+1); WORKING(4) -> LONG_BREAK;
 * LONG_BREAK -> WAITING_CONTINUATION_RESPONSE (prompt, no timer).
 */
function advanceState() {
  runtime.timer = null;
  const prev = runtime.state;

  if (prev === STATES.WORKING) {
    if (runtime.cycleCount >= TOTAL_CYCLES) {
      logger.info('pomodoro: work cycle 4 done -> long break');
      enterState(STATES.LONG_BREAK, pick(PHRASES.toLongBreak), runtime.config.longBreakMs);
    } else {
      logger.info(`pomodoro: work cycle ${runtime.cycleCount} done -> short break`);
      enterState(STATES.SHORT_BREAK, pick(PHRASES.toShortBreak), runtime.config.shortBreakMs);
    }
    return;
  }

  if (prev === STATES.SHORT_BREAK) {
    runtime.cycleCount += 1;
    logger.info(`pomodoro: short break done -> work cycle ${runtime.cycleCount}`);
    enterState(STATES.WORKING, pick(PHRASES.toWork), runtime.config.workMs);
    return;
  }

  if (prev === STATES.LONG_BREAK) {
    logger.info('pomodoro: long break done -> awaiting continuation');
    enterState(STATES.WAITING_CONTINUATION_RESPONSE, MESSAGES.continuePrompt, null);
    return;
  }

  // No timered transition applies (IDLE / WAITING): nothing to do.
}

/**
 * Boot recovery per SAD 5.2: an expired transition runs immediately,
 * a future one is rescheduled with its remaining time.
 */
function restoreTimers() {
  if (runtime.state !== STATES.WORKING
    && runtime.state !== STATES.SHORT_BREAK
    && runtime.state !== STATES.LONG_BREAK) {
    return; // IDLE / WAITING need no timer
  }
  const due = runtime.endsAt ? new Date(runtime.endsAt).getTime() : NaN;
  const remaining = Number.isFinite(due) ? due - Date.now() : -1;
  if (remaining <= 0) {
    logger.info('pomodoro: overdue transition fired on boot');
    advanceState();
  } else {
    runtime.timer = setTimeout(advanceState, remaining);
  }
}

/**
 * Initialize the pomodoro module.
 *
 * @param {object} options
 * @param {(text: string) => any} options.send outbound message function
 * @param {object} [options.config] overrides for work/short/long durations
 */
function init(options = {}) {
  const { send, config = {} } = options;
  if (typeof send !== 'function') {
    throw new TypeError('pomodoro.init requires a send function');
  }

  shutdown(); // re-init safe (tests, hot reload)

  runtime = {
    send,
    config: { ...DEFAULT_CONFIG, ...config },
    state: STATES.IDLE,
    cycleCount: 0,
    endsAt: null,
    timer: null,
  };

  const saved = storage.loadState().pomodoro || {};
  runtime.state = saved.currentState || STATES.IDLE;
  runtime.cycleCount = Number.isFinite(saved.cycleCount) ? saved.cycleCount : 0;
  runtime.endsAt = saved.endsAt || null;

  restoreTimers();
  logger.info(`pomodoro: module initialized in state ${runtime.state}`);
}

/**
 * RF3.1/RF3.2: start a full 130-minute session with an immediate confirmation.
 *
 * @returns {boolean} false when a session is already running
 */
function start() {
  if (!runtime || runtime.state !== STATES.IDLE) return false;
  runtime.cycleCount = 1;
  enterState(STATES.WORKING, MESSAGES.started, runtime.config.workMs);
  logger.info('pomodoro: session started');
  return true;
}

/**
 * RF3.4: continuation answer after the long break.
 *
 * @param {boolean} yes true to start a new 130-min cycle, false to finish
 * @returns {boolean} false when not awaiting a continuation answer
 */
function handleContinuation(yes) {
  if (!runtime || runtime.state !== STATES.WAITING_CONTINUATION_RESPONSE) return false;
  if (yes) {
    runtime.cycleCount = 1;
    enterState(STATES.WORKING, MESSAGES.started, runtime.config.workMs);
    logger.info('pomodoro: new cycle started');
  } else {
    enterState(STATES.IDLE, MESSAGES.finished, null);
    logger.info('pomodoro: session finished');
  }
  return true;
}

function getState() {
  if (!runtime) return { currentState: 'UNINITIALIZED', cycleCount: 0, endsAt: null };
  return { currentState: runtime.state, cycleCount: runtime.cycleCount, endsAt: runtime.endsAt };
}

// Gate helper for the tasks module: RF5.3-adjacent user rule — no random task
// messages while a 25-minute work interval is running.
function isWorking() {
  return !!runtime && runtime.state === STATES.WORKING;
}

function awaitingContinuation() {
  return !!runtime && runtime.state === STATES.WAITING_CONTINUATION_RESPONSE;
}

function shutdown() {
  if (!runtime) return;
  if (runtime.timer) {
    clearTimeout(runtime.timer);
    runtime.timer = null;
  }
  runtime = null;
}

module.exports = {
  init,
  start,
  handleContinuation,
  getState,
  isWorking,
  awaitingContinuation,
  shutdown,
  STATES,
  MESSAGES,
  PHRASES,
};
