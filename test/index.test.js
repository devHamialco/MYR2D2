'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadEnvFile,
  shouldProcess,
  jidFromWid,
  createMessageHandler,
  createSerialMessageQueue,
  initializeWithRetry,
  HELP_TEXT,
} = require('../src/index');
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

describe('initializeWithRetry', () => {
  const log = { warn: jest.fn() };

  test('retries a transient failure, destroys the browser in between, then succeeds', async () => {
    const client = {
      initialize: jest.fn()
        .mockRejectedValueOnce(new Error('Execution context was destroyed'))
        .mockResolvedValueOnce(undefined),
      destroy: jest.fn(),
    };

    await initializeWithRetry(client, { attempts: 3, delayMs: 1, log });
    expect(client.initialize).toHaveBeenCalledTimes(2);
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining('intento 1/3 falló')
    );
  });

  test('throws the last error after exhausting attempts', async () => {
    const client = {
      initialize: jest.fn().mockRejectedValue(new Error('boom')),
      destroy: jest.fn(),
    };

    await expect(
      initializeWithRetry(client, { attempts: 2, delayMs: 1, log })
    ).rejects.toThrow('boom');
    expect(client.initialize).toHaveBeenCalledTimes(2);
    expect(client.destroy).toHaveBeenCalledTimes(2);
  });

  test('a destroy() failure does not mask the initialize error', async () => {
    const client = {
      initialize: jest.fn().mockRejectedValue(new Error('boom')),
      destroy: jest.fn().mockRejectedValue(new Error('already dead')),
    };

    await expect(
      initializeWithRetry(client, { attempts: 1, delayMs: 1, log })
    ).rejects.toThrow('boom');
  });
});

describe('jidFromWid', () => {
  test('builds a plain JID from {user, server}', () => {
    expect(jidFromWid({ user: '5215512345678', server: 'c.us' })).toBe('5215512345678@c.us');
  });

  test('accepts LID ids untouched', () => {
    expect(jidFromWid({ user: '123456789012345', server: 'lid' })).toBe('123456789012345@lid');
  });

  test('falls back to _serialized and strips device suffixes', () => {
    expect(jidFromWid({ _serialized: '5215512345678:12@c.us' })).toBe('5215512345678@c.us');
    expect(jidFromWid({ _serialized: '5215512345678@c.us' })).toBe('5215512345678@c.us');
  });

  test('returns null for missing/empty wid', () => {
    expect(jidFromWid(null)).toBeNull();
    expect(jidFromWid(undefined)).toBeNull();
    expect(jidFromWid({})).toBeNull();
  });
});

describe('createSerialMessageQueue (self-chat race guard)', () => {
  test('processes immediately when no send is in flight', async () => {
    const onMessage = jest.fn(async () => {});
    const inFlight = new Set();
    const queue = createSerialMessageQueue(onMessage, inFlight);

    await queue.enqueue({ body: 'uno' });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  test('defers events while a send is settling, then processes them', async () => {
    const order = [];
    let settle;
    const pendingSend = new Promise((resolve) => { settle = resolve; });
    const inFlight = new Set([pendingSend]);
    const onMessage = jest.fn(async (m) => { order.push(`handled:${m.body}`); });

    const queue = createSerialMessageQueue(onMessage, inFlight);
    const drainPromise = queue.enqueue({ body: 'bot-self-msg' });

    // Let the microtask queue flush: the event must still be deferred.
    await Promise.resolve();
    await Promise.resolve();
    expect(onMessage).not.toHaveBeenCalled();

    inFlight.delete(pendingSend); // id recorded by send() before settle
    settle();
    await drainPromise;

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['handled:bot-self-msg']);
  });

  test('re-entrant enqueue during drain is neither dropped nor duplicated', async () => {
    const seen = [];
    const inFlight = new Set();
    const queue = createSerialMessageQueue(async (m) => {
      seen.push(m.body);
      if (m.body === 'first') queue.enqueue({ body: 'second' });
    }, inFlight);

    await queue.enqueue({ body: 'first' });
    expect(seen).toEqual(['first', 'second']);
    expect(queue.size()).toBe(0);
  });

  test('a throwing handler does not stall subsequent events', async () => {
    const log = { error: jest.fn() };
    const inFlight = new Set();
    const onMessage = jest.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const queue = createSerialMessageQueue(onMessage, inFlight, log);

    await queue.enqueue({ body: 'bad' });
    await queue.enqueue({ body: 'good' });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalled();
    expect(queue.size()).toBe(0);
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

  test('dropped messages are traced via logger.debug (DEBUG diagnostics)', async () => {
    const handler = buildHandler();
    await handler(msg({ from: 'otro@c.us', body: 'hola', id: { _serialized: 'x1' } }));
    expect(send).not.toHaveBeenCalled();
    expect(deps.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('msg descartado: from=otro@c.us')
    );
    expect(deps.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('target=me@c.us')
    );
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
