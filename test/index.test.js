'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadEnvFile, shouldProcess, createMessageHandler, HELP_TEXT } = require('../src/index');
const { parseMessage } = require('../src/parsers');

function msg(overrides = {}) {
  return {
    from: 'me@c.us',
    body: 'hola',
    id: { _serialized: 'msg_1' },
    ...overrides,
  };
}

describe('loadEnvFile', () => {
  let tmpFile;

  afterEach(() => {
    if (tmpFile) fs.rmSync(tmpFile, { force: true });
    tmpFile = null;
  });

  test('parses KEY=VALUE lines, comments and quotes', () => {
    tmpFile = path.join(os.tmpdir(), `r2d2-env-${Date.now()}.env`);
    fs.writeFileSync(tmpFile, [
      '# comment',
      'FOO=bar',
      'QUOTED="x y"',
      "SINGLE='z'",
      'EMPTY=',
      'NOT A PAIR',
    ].join('\n'));

    expect(loadEnvFile(tmpFile)).toEqual({ FOO: 'bar', QUOTED: 'x y', SINGLE: 'z', EMPTY: '' });
  });

  test('missing file returns empty object', () => {
    expect(loadEnvFile(path.join(os.tmpdir(), 'definitely-missing.env'))).toEqual({});
  });
});

describe('shouldProcess', () => {
  const ids = new Set();

  beforeEach(() => ids.clear());

  test('accepts messages from the target chat', () => {
    expect(shouldProcess(msg(), 'me@c.us', ids)).toBe(true);
  });

  test('rejects status broadcasts, other chats, empty bodies and null target', () => {
    expect(shouldProcess(msg({ from: 'status@broadcast' }), 'me@c.us', ids)).toBe(false);
    expect(shouldProcess(msg(), 'other@c.us', ids)).toBe(false);
    expect(shouldProcess(msg({ body: '   ' }), 'me@c.us', ids)).toBe(false);
    expect(shouldProcess(msg(), null, ids)).toBe(false);
    expect(shouldProcess(null, 'me@c.us', ids)).toBe(false);
  });

  test('rejects messages the bot itself sent (self-chat protection)', () => {
    ids.add('msg_1');
    expect(shouldProcess(msg(), 'me@c.us', ids)).toBe(false);
  });
});

describe('createMessageHandler routing', () => {
  let deps;
  let send;
  let seenContext;

  function buildHandler(options = {}) {
    const parseSpy = (text, context) => {
      seenContext = context;
      return parseMessage(text, context);
    };
    return createMessageHandler({ ...deps, parseMessage: options.parseMessage || parseSpy });
  }

  function hydratedMsg(body, id = 'msg_x') {
    return msg({ body, id: { _serialized: id } });
  }

  beforeEach(() => {
    seenContext = undefined;
    send = jest.fn(async () => ({ id: { _serialized: 'sent_1' } }));
    deps = {
      send,
      getTargetChatId: () => 'me@c.us',
      botMessageIds: new Set(),
      hydration: { handleConfirm: jest.fn() },
      pomodoro: {
        start: jest.fn(),
        handleContinuation: jest.fn(),
        awaitingContinuation: jest.fn(() => false),
      },
      reminders: { schedule: jest.fn() },
      tasks: { addTask: jest.fn((text) => ({ id: 1, text })), removeTask: jest.fn() },
      logger: { debug: jest.fn(), error: jest.fn() },
    };
  });

  test('HYDRATION_CONFIRM reaches hydration.handleConfirm with context captured', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('sí', 'a1'));
    expect(deps.hydration.handleConfirm).toHaveBeenCalledTimes(1);
    expect(seenContext).toEqual({ awaitingPomodoroContinuation: false });
  });

  test('POMODORO_START reaches pomodoro.start', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('Voy a estudiar', 'a2'));
    expect(deps.pomodoro.start).toHaveBeenCalledTimes(1);
  });

  test('affirmative while pomodoro waits routes to continuation, not hydration', async () => {
    deps.pomodoro.awaitingContinuation.mockReturnValue(true);
    const handler = buildHandler();
    await handler(hydratedMsg('sí', 'a3'));
    expect(deps.pomodoro.handleContinuation).toHaveBeenCalledWith(true);
    expect(deps.hydration.handleConfirm).not.toHaveBeenCalled();
    expect(seenContext).toEqual({ awaitingPomodoroContinuation: true });
  });

  test('negative answer routes to continuation(NO)', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('no', 'a4'));
    expect(deps.pomodoro.handleContinuation).toHaveBeenCalledWith(false);
  });

  test('RF4.3: reminder schedules timer and confirms with exact wording', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('recuérdame sacar la basura dentro de 10 minutos', 'a5'));
    expect(deps.reminders.schedule).toHaveBeenCalledWith('sacar la basura', 10 * 60 * 1000);
    expect(send).toHaveBeenCalledWith('Entendido, te recordaré sacar la basura en 10 minutos');
  });

  test('RF5.1: task add persists and acknowledges', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('añade comprar pan a las tareas', 'a6'));
    expect(deps.tasks.addTask).toHaveBeenCalledWith('comprar pan');
    expect(send).toHaveBeenCalledWith('✅ Añadida: comprar pan');
  });

  test('RF5.4: task removal acknowledges success and failure', async () => {
    const handler = buildHandler();
    deps.tasks.removeTask.mockReturnValueOnce({ id: 2, text: 'comprar pan' });
    await handler(hydratedMsg('elimina comprar pan', 'a7'));
    expect(send).toHaveBeenCalledWith('🗑️ Eliminada: comprar pan');

    deps.tasks.removeTask.mockReturnValueOnce(null);
    await handler(hydratedMsg('tarea completada algo raro', 'a8'));
    expect(send).toHaveBeenCalledWith('No encontré "algo raro" en tus tareas.');
  });

  test('HELP returns the command cheat-sheet; UNKNOWN stays silent', async () => {
    const handler = buildHandler();
    await handler(hydratedMsg('ayuda', 'a9'));
    expect(send).toHaveBeenCalledWith(HELP_TEXT);

    send.mockClear();
    await handler(hydratedMsg('esto no es un comando', 'a10'));
    expect(send).not.toHaveBeenCalled();
    expect(deps.hydration.handleConfirm).not.toHaveBeenCalled();
  });

  test('bot does not react to its own recorded messages', async () => {
    deps.botMessageIds.add('bot_msg');
    const handler = buildHandler();
    await handler(hydratedMsg('sí', 'bot_msg'));
    expect(deps.hydration.handleConfirm).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  test('module errors are caught and logged, never thrown', async () => {
    deps.hydration.handleConfirm.mockImplementation(() => { throw new Error('boom'); });
    const handler = buildHandler();
    await expect(handler(hydratedMsg('sí', 'a11'))).resolves.toBeUndefined();
    expect(deps.logger.error).toHaveBeenCalled();
  });
});
