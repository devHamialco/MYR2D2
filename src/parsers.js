'use strict';

const INTENTS = {
  HYDRATION_CONFIRM: 'HYDRATION_CONFIRM',
  POMODORO_START: 'POMODORO_START',
  POMODORO_CONTINUE_YES: 'POMODORO_CONTINUE_YES',
  POMODORO_CONTINUE_NO: 'POMODORO_CONTINUE_NO',
  REMINDER_CREATE: 'REMINDER_CREATE',
  TASK_ADD: 'TASK_ADD',
  TASK_REMOVE: 'TASK_REMOVE',
  HELP: 'HELP',
  UNKNOWN: 'UNKNOWN',
};

const UNIT_MS = {
  minuto: 60 * 1000,
  minutos: 60 * 1000,
  hora: 60 * 60 * 1000,
  horas: 60 * 60 * 1000,
};

// Accent-tolerant patterns; matched against the lowercased original text so
// payloads (task text) keep the user's accents.
const REMINDER_PATTERNS = [
  /recu[eé]rdame\s+(.+?)\s+dentro de\s+(\d+)\s+(minutos?|horas?)/i,
  /recu[eé]rdame\s+(.+?)\s+en\s+(\d+)\s+(minutos?|horas?)/i,
];

const TASK_ADD_PATTERN = /(?:a[nñ]ade|agrega)\s+(.+?)\s+a las tareas/i;
const TASK_REMOVE_PATTERNS = [/elimina\s+(.+)/i, /tarea completada\s+(.+)/i];
const POMODORO_START_PATTERN = /voy a (?:estudiar|trabajar)/i;
const HELP_PATTERN = /\b(ayuda|help)\b/i;

// Affirmative/negative words are matched against an accent-stripped copy so
// "sí" and "si" behave identically. Word boundaries keep "si" from matching
// inside "silencio" or "sistema".
const AFFIRMATIVE_PATTERN = /\b(si|ya|listo|seep|sip|check)\b/i;
const NEGATIVE_PATTERN = /\b(no|nah|para|stop|cancel|cancelar)\b/i;

function stripAccents(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tidy(text) {
  return text.trim().replace(/[.,;!?¡¿]+$/g, '').trim();
}

function parseReminder(lower) {
  for (const pattern of REMINDER_PATTERNS) {
    const match = lower.match(pattern);
    if (!match) continue;
    const task = tidy(match[1]);
    const amount = Number.parseInt(match[2], 10);
    const unit = match[3].toLowerCase();
    // \d+ already rejects negative numbers; also reject zero-delay requests.
    if (!task || !Number.isFinite(amount) || amount <= 0) return null;
    return { task, amount, unit, delayMs: amount * UNIT_MS[unit] };
  }
  return null;
}

/**
 * Pure intent parser. No side effects, easy to unit test.
 *
 * @param {string} text raw incoming message text
 * @param {object} [context] optional routing context
 * @param {boolean} [context.awaitingPomodoroContinuation] when true, a bare
 *   affirmative is classified as POMODORO_CONTINUE_YES instead of
 *   HYDRATION_CONFIRM (both flows share the same yes-words).
 * @returns {{intent: string, payload: object}}
 */
function parseMessage(text, context = {}) {
  const original = String(text || '').trim();
  const lower = original.toLowerCase();
  const norm = stripAccents(lower);

  const reminder = parseReminder(lower);
  if (reminder) return { intent: INTENTS.REMINDER_CREATE, payload: reminder };

  let match = lower.match(TASK_ADD_PATTERN);
  if (match) return { intent: INTENTS.TASK_ADD, payload: { text: tidy(match[1]) } };

  for (const pattern of TASK_REMOVE_PATTERNS) {
    match = lower.match(pattern);
    if (match) return { intent: INTENTS.TASK_REMOVE, payload: { match: tidy(match[1]) } };
  }

  if (POMODORO_START_PATTERN.test(lower)) return { intent: INTENTS.POMODORO_START, payload: {} };

  if (HELP_PATTERN.test(lower)) return { intent: INTENTS.HELP, payload: {} };

  if (NEGATIVE_PATTERN.test(norm)) return { intent: INTENTS.POMODORO_CONTINUE_NO, payload: {} };

  if (AFFIRMATIVE_PATTERN.test(norm)) {
    if (context && context.awaitingPomodoroContinuation) {
      return { intent: INTENTS.POMODORO_CONTINUE_YES, payload: {} };
    }
    return { intent: INTENTS.HYDRATION_CONFIRM, payload: {} };
  }

  return { intent: INTENTS.UNKNOWN, payload: {} };
}

module.exports = { parseMessage, INTENTS, stripAccents };
