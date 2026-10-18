'use strict';

jest.mock('node-cron', () => ({
  schedule: jest.fn(() => ({ stop: jest.fn() })),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const cron = require('node-cron');
const storage = require('../src/utils/storage');
const hydration = require('../src/modules/hydration');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function fireDailyCron() {
  const cb = cron.schedule.mock.calls[0][1];
  cb();
}

function initialState(overrides = {}) {
  return {
    hydration: { status: 'IDLE', nextScheduledAt: null, ...overrides.hydration },
    pomodoro: { currentState: 'IDLE', cycleCount: 0 },
    reminders: [],
  };
}

let send;
let tmpDir;

beforeEach(() => {
  jest.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2d2-hyd-'));
  storage.init(tmpDir);
  send = jest.fn();
  cron.schedule.mockClear();
});

afterEach(() => {
  hydration.shutdown();
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function initialCount() {
  return send.mock.calls.filter((c) => c[0] === hydration.MESSAGES.initial).length;
}

function insistCount() {
  return send.mock.calls.filter((c) => c[0] === hydration.MESSAGES.insist).length;
}

describe('hydration module (RF2.1-RF2.4)', () => {
  test('RF2.1: daily cron sends the initial question once', () => {
    hydration.init({ send });
    expect(cron.schedule).toHaveBeenCalledWith('30 6 * * *', expect.any(Function));
    fireDailyCron();
    expect(initialCount()).toBe(1);
    expect(send).toHaveBeenCalledWith('Ya bebiste agua?');
  });

  test('RF2.2: insists every 10 minutes until confirmed', () => {
    hydration.init({ send });
    fireDailyCron();
    expect(insistCount()).toBe(0);

    jest.advanceTimersByTime(10 * MIN);
    expect(insistCount()).toBe(1);
    expect(send).toHaveBeenLastCalledWith('Bebe agua we');

    jest.advanceTimersByTime(10 * MIN);
    expect(insistCount()).toBe(2);

    jest.advanceTimersByTime(30 * MIN);
    expect(insistCount()).toBe(5);
  });

  test('RF2.4: confirmation stops insistence and schedules next question in exactly 2h', () => {
    hydration.init({ send });
    fireDailyCron();

    expect(hydration.handleConfirm()).toBe(true);
    expect(hydration.getStatus().status).toBe('CONFIRMED');

    jest.advanceTimersByTime(10 * MIN);
    expect(insistCount()).toBe(0);

    // Confirm happened at t0; only 10 min have elapsed so far.
    jest.advanceTimersByTime(2 * HOUR - 10 * MIN - 1);
    expect(initialCount()).toBe(1);

    jest.advanceTimersByTime(1);
    expect(initialCount()).toBe(2);
    // New cycle re-enters AWAITING_CONFIRMATION with a fresh insist loop.
    expect(hydration.getStatus().status).toBe('AWAITING_CONFIRMATION');
  });

  test('boot restore with expired AWAITING state fires immediately and keeps insisting', () => {
    storage.saveState(initialState({
      hydration: {
        status: 'AWAITING_CONFIRMATION',
        nextScheduledAt: new Date(Date.now() - 5 * MIN).toISOString(),
      },
    }));

    hydration.init({ send });
    expect(insistCount()).toBe(1);

    jest.advanceTimersByTime(10 * MIN);
    expect(insistCount()).toBe(2);
  });

  test('boot restore with future AWAITING state waits only the remaining ms', () => {
    storage.saveState(initialState({
      hydration: {
        status: 'AWAITING_CONFIRMATION',
        nextScheduledAt: new Date(Date.now() + 5 * MIN).toISOString(),
      },
    }));

    hydration.init({ send });
    expect(insistCount()).toBe(0);

    jest.advanceTimersByTime(5 * MIN - 1);
    expect(insistCount()).toBe(0);

    jest.advanceTimersByTime(1);
    expect(insistCount()).toBe(1);
  });

  test('boot restore with expired CONFIRMED state asks immediately', () => {
    storage.saveState(initialState({
      hydration: {
        status: 'CONFIRMED',
        nextScheduledAt: new Date(Date.now() - 30 * MIN).toISOString(),
      },
    }));

    hydration.init({ send });
    expect(initialCount()).toBe(1);
    expect(hydration.getStatus().status).toBe('AWAITING_CONFIRMATION');
  });

  test('boot restore with future CONFIRMED state fires after remaining time', () => {
    storage.saveState(initialState({
      hydration: {
        status: 'CONFIRMED',
        nextScheduledAt: new Date(Date.now() + HOUR).toISOString(),
      },
    }));

    hydration.init({ send });
    expect(initialCount()).toBe(0);

    jest.advanceTimersByTime(HOUR);
    expect(initialCount()).toBe(1);
  });

  test('persists status and nextScheduledAt to state.json', () => {
    hydration.init({ send });
    fireDailyCron();

    let persisted = storage.loadState().hydration;
    expect(persisted.status).toBe('AWAITING_CONFIRMATION');
    expect(persisted.nextScheduledAt).toBeTruthy();
    expect(Number.isFinite(new Date(persisted.nextScheduledAt).getTime())).toBe(true);

    hydration.handleConfirm();
    persisted = storage.loadState().hydration;
    expect(persisted.status).toBe('CONFIRMED');
    expect(
      new Date(persisted.nextScheduledAt).getTime() - Date.now()
    ).toBe(2 * HOUR);
  });

  test('shutdown stops cron and timers', () => {
    hydration.init({ send });
    const { stop } = cron.schedule.mock.results[0].value;
    fireDailyCron();
    hydration.shutdown();
    expect(stop).toHaveBeenCalled();

    jest.advanceTimersByTime(60 * MIN);
    expect(insistCount()).toBe(0);
  });
});
