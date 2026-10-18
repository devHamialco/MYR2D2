'use strict';

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const cron = require('node-cron');
const storage = require('../src/utils/storage');
const tasks = require('../src/modules/tasks');

const WINDOW_CONFIG = { timeFrom: '08:00', timeTo: '22:00', probability: 1 };

function at(h, m) {
  return new Date(2026, 9, 17, h, m, 0, 0);
}

function fireCron() {
  const cb = cron.schedule.mock.calls[0][1];
  cb();
}

let send;
let tmpDir;
let canSend;

beforeEach(() => {
  jest.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2d2-tsk-'));
  storage.init(tmpDir);
  send = jest.fn();
  canSend = jest.fn(() => true);
  cron.schedule.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  tasks.shutdown();
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('tasks module — add/remove (RF5.1, RF5.2, RF5.4)', () => {
  test('RF5.2: addTask persists to tasks.json immediately with id and createdAt', () => {
    const task = tasks.addTask('cepillar al gato');
    expect(task).toEqual({
      id: 1,
      text: 'cepillar al gato',
      createdAt: expect.any(String),
    });

    const persisted = JSON.parse(fs.readFileSync(path.join(tmpDir, 'tasks.json'), 'utf8'));
    expect(persisted.tasks).toHaveLength(1);
    expect(persisted.tasks[0].text).toBe('cepillar al gato');
  });

  test('auto-incrementing ids across persistence reloads', () => {
    tasks.addTask('una');
    tasks.addTask('dos');
    const ids = tasks.listTasks().map((t) => t.id);
    expect(ids).toEqual([1, 2]);
  });

  test('removeTask by accent-insensitive name and by id (RF5.4)', () => {
    tasks.addTask('cepillar al gato');
    tasks.addTask('sacar la basura');

    const removed = tasks.removeTask('CEPILLAR AL GATO');
    expect(removed).toMatchObject({ id: 1, text: 'cepillar al gato' });
    expect(tasks.listTasks()).toHaveLength(1);

    const removedById = tasks.removeTask('2');
    expect(removedById).toMatchObject({ id: 2, text: 'sacar la basura' });
    expect(tasks.listTasks()).toHaveLength(0);

    expect(tasks.removeTask('algo inexistente')).toBeNull();
    // removal persisted
    expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'tasks.json'), 'utf8')).tasks).toHaveLength(0);
  });

  test('rejects empty task text', () => {
    expect(() => tasks.addTask('   ')).toThrow(TypeError);
  });
});

describe('tasks module — random dispatcher (updated RF5.3: 08:00-22:00, pomodoro gate)', () => {
  beforeEach(() => {
    tasks.init({ send, canSend, config: WINDOW_CONFIG });
    tasks.addTask('tarea uno');
    tasks.addTask('tarea dos');
    send.mockClear();
  });

  test('sends the numbered pending list inside the window', () => {
    jest.setSystemTime(at(10, 0));
    expect(tasks.checkAndSend()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const msg = send.mock.calls[0][0];
    expect(msg).toContain('📋');
    expect(msg).toContain('1. tarea uno');
    expect(msg).toContain('2. tarea dos');
  });

  test('window boundaries: blocks before 08:00 and after 22:00', () => {
    jest.setSystemTime(at(7, 59));
    expect(tasks.checkAndSend()).toBe(false);

    jest.setSystemTime(at(8, 0));
    expect(tasks.checkAndSend()).toBe(true);
    send.mockClear();

    jest.setSystemTime(at(21, 30));
    expect(tasks.checkAndSend()).toBe(true);
    send.mockClear();

    jest.setSystemTime(at(22, 1));
    expect(tasks.checkAndSend()).toBe(false);

    expect(send).not.toHaveBeenCalled();
  });

  test('gate blocks dispatch during pomodoro WORKING (user rule)', () => {
    jest.setSystemTime(at(12, 0));
    canSend.mockReturnValue(false);

    expect(tasks.checkAndSend()).toBe(false);
    expect(send).not.toHaveBeenCalled();

    canSend.mockReturnValue(true);
    expect(tasks.checkAndSend()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('probability gates the dispatch', () => {
    jest.setSystemTime(at(12, 0));
    tasks.shutdown();
    tasks.init({ send, canSend, config: { ...WINDOW_CONFIG, probability: 0.5 } });

    const spy = jest.spyOn(Math, 'random').mockReturnValue(0.6);
    expect(tasks.checkAndSend()).toBe(false);
    expect(send).not.toHaveBeenCalled();

    spy.mockReturnValue(0.4);
    expect(tasks.checkAndSend()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('probability 0 never sends, probability 1 always sends', () => {
    jest.setSystemTime(at(12, 0));

    tasks.shutdown();
    tasks.init({ send, canSend, config: { ...WINDOW_CONFIG, probability: 0 } });
    expect(tasks.checkAndSend()).toBe(false);

    tasks.shutdown();
    tasks.init({ send, canSend, config: { ...WINDOW_CONFIG, probability: 1 } });
    expect(tasks.checkAndSend()).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('empty list never sends regardless of window/gate/probability', () => {
    jest.setSystemTime(at(12, 0));
    tasks.removeTask('1');
    tasks.removeTask('2');
    expect(tasks.listTasks()).toHaveLength(0);

    expect(tasks.checkAndSend()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  test('cron scheduled with the configured expression and stopped on shutdown', () => {
    expect(cron.schedule).toHaveBeenCalledWith('*/30 8-21 * * *', expect.any(Function));
    const { stop } = cron.schedule.mock.results[cron.schedule.mock.results.length - 1].value;
    tasks.shutdown();
    expect(stop).toHaveBeenCalled();
  });

  test('cron callback drives checkAndSend with system clock', () => {
    jest.setSystemTime(at(9, 30));
    fireCron();
    expect(send).toHaveBeenCalledTimes(1);

    jest.setSystemTime(at(23, 0));
    fireCron();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
