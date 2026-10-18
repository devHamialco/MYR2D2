'use strict';

const { parseMessage, INTENTS } = require('../src/parsers');

describe('parsers: HYDRATION_CONFIRM', () => {
  test.each(['sí', 'si', 'ya', 'listo', 'listo ya', 'seep', 'sip', 'check', 'SÍ', 'Ya!', 'Check'])(
    'recognizes affirmative "%s"',
    (input) => {
      expect(parseMessage(input).intent).toBe(INTENTS.HYDRATION_CONFIRM);
    }
  );

  test('does not match affirmatives inside other words', () => {
    expect(parseMessage('silencio').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('sistema').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('listonería').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('ayer').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('chequeo').intent).toBe(INTENTS.UNKNOWN);
  });
});

describe('parsers: POMODORO_START', () => {
  test.each(['voy a estudiar', 'Voy a trabajar', 'VOY A ESTUDIAR', 'hoy voy a estudiar maths'])(
    'recognizes start command "%s"',
    (input) => {
      expect(parseMessage(input).intent).toBe(INTENTS.POMODORO_START);
    }
  );
});

describe('parsers: REMINDER_CREATE', () => {
  test('parses "dentro de N minutos"', () => {
    const { intent, payload } = parseMessage('recuérdame sacar la basura dentro de 30 minutos');
    expect(intent).toBe(INTENTS.REMINDER_CREATE);
    expect(payload.task).toBe('sacar la basura');
    expect(payload.amount).toBe(30);
    expect(payload.unit).toBe('minutos');
    expect(payload.delayMs).toBe(30 * 60 * 1000);
  });

  test('parses accent-less "recuerdame ... dentro de N horas"', () => {
    const { intent, payload } = parseMessage('recuerdame llamar a mi mama dentro de 2 horas');
    expect(intent).toBe(INTENTS.REMINDER_CREATE);
    expect(payload.task).toBe('llamar a mi mama');
    expect(payload.amount).toBe(2);
    expect(payload.unit).toBe('horas');
    expect(payload.delayMs).toBe(2 * 60 * 60 * 1000);
  });

  test('parses "en N minutos" variant', () => {
    const { intent, payload } = parseMessage('recuérdame tomar vitaminas en 15 minutos');
    expect(intent).toBe(INTENTS.REMINDER_CREATE);
    expect(payload.task).toBe('tomar vitaminas');
    expect(payload.amount).toBe(15);
    expect(payload.delayMs).toBe(15 * 60 * 1000);
  });

  test('keeps accents in the extracted task text', () => {
    const { payload } = parseMessage('recuérdame llamar a mi mamá dentro de 10 minutos');
    expect(payload.task).toBe('llamar a mi mamá');
  });

  test('rejects negative numbers', () => {
    expect(parseMessage('recuérdame sacar basura dentro de -5 minutos').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('recuérdame x en -5 minutos').intent).toBe(INTENTS.UNKNOWN);
  });

  test('rejects zero delay', () => {
    expect(parseMessage('recuérdame x dentro de 0 minutos').intent).toBe(INTENTS.UNKNOWN);
  });

  test('rejects reminder without time', () => {
    expect(parseMessage('recuérdame sacar la basura').intent).toBe(INTENTS.UNKNOWN);
  });
});

describe('parsers: TASK_ADD', () => {
  test('parses "añade ... a las tareas"', () => {
    const { intent, payload } = parseMessage('añade comprar pan a las tareas');
    expect(intent).toBe(INTENTS.TASK_ADD);
    expect(payload.text).toBe('comprar pan');
  });

  test('parses "agrega ... a las tareas"', () => {
    const { intent, payload } = parseMessage('agrega llamar al doctor a las tareas');
    expect(intent).toBe(INTENTS.TASK_ADD);
    expect(payload.text).toBe('llamar al doctor');
  });

  test('requires the "a las tareas" suffix', () => {
    expect(parseMessage('añade comprar pan').intent).toBe(INTENTS.UNKNOWN);
  });
});

describe('parsers: TASK_REMOVE', () => {
  test('parses "elimina ..."', () => {
    const { intent, payload } = parseMessage('elimina comprar pan');
    expect(intent).toBe(INTENTS.TASK_REMOVE);
    expect(payload.match).toBe('comprar pan');
  });

  test('parses "tarea completada ..."', () => {
    const { intent, payload } = parseMessage('tarea completada comprar pan');
    expect(intent).toBe(INTENTS.TASK_REMOVE);
    expect(payload.match).toBe('comprar pan');
  });
});

describe('parsers: continuation answers', () => {
  test('bare affirmative defaults to hydration confirm', () => {
    expect(parseMessage('sí').intent).toBe(INTENTS.HYDRATION_CONFIRM);
  });

  test('bare affirmative becomes POMODORO_CONTINUE_YES with context', () => {
    const { intent } = parseMessage('sí', { awaitingPomodoroContinuation: true });
    expect(intent).toBe(INTENTS.POMODORO_CONTINUE_YES);
  });

  test.each(['no', 'nah', 'para', 'stop', 'cancel', 'cancelar'])(
    'recognizes negative "%s" as POMODORO_CONTINUE_NO',
    (input) => {
      expect(parseMessage(input).intent).toBe(INTENTS.POMODORO_CONTINUE_NO);
    }
  );

  test('negation does not match inside words', () => {
    expect(parseMessage('enorme').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('paraguas').intent).toBe(INTENTS.UNKNOWN);
  });
});

describe('parsers: HELP and UNKNOWN', () => {
  test('recognizes ayuda/help', () => {
    expect(parseMessage('ayuda').intent).toBe(INTENTS.HELP);
    expect(parseMessage('help').intent).toBe(INTENTS.HELP);
    expect(parseMessage('necesito ayuda').intent).toBe(INTENTS.HELP);
  });

  test('falls back to UNKNOWN', () => {
    expect(parseMessage('hola qué tal').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage('').intent).toBe(INTENTS.UNKNOWN);
    expect(parseMessage(null).intent).toBe(INTENTS.UNKNOWN);
  });

  test('command intents win over embedded keywords', () => {
    expect(parseMessage('recuérdame pedir ayuda dentro de 5 minutos').intent).toBe(INTENTS.REMINDER_CREATE);
    expect(parseMessage('añade buscar ayuda a las tareas').intent).toBe(INTENTS.TASK_ADD);
    expect(parseMessage('voy a estudiar ya').intent).toBe(INTENTS.POMODORO_START);
  });
});
