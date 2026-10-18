'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../src/utils/storage');
const reminders = require('../src/modules/reminders');

const MIN = 60 * 1000;

function initialState(overrides = {}) {
  return {
    hydration: { status: 'IDLE', nextScheduledAt: null },
    pomodoro: { currentState: 'IDLE', cycleCount: 0 },
    reminders: Array.isArray(overrides.reminders) ? overrides.reminders : [],
  };
}

let send;
let tmpDir;

beforeEach(() => {
  jest.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2d2-rem-'));
  storage.init(tmpDir);
  send = jest.fn();
});

afterEach(() => {
  reminders.shutdown();
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('reminders module (RF4.1-RF4.3)', () => {
  test('RF4.3: fires "⏰ Recordatorio: [acción]" after the exact delay', () => {
    reminders.init({ send });
    const result = reminders.schedule('sacar la basura', 10 * MIN);
    expect(result).toEqual({
      id: expect.stringMatching(/^rem_/),
      text: 'sacar la basura',
      triggerAt: expect.any(String),
    });
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10 * MIN - 1);
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('⏰ Recordatorio: sacar la basura');
  });

  test('persists active reminders to state.json and removes after firing', () => {
    reminders.init({ send });
    const saved = reminders.schedule('llamar al dentista', 5 * MIN);

    const persisted = storage.loadState().reminders;
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toEqual({
      id: saved.id,
      text: 'llamar al dentista',
      triggerAt: saved.id ? expect.any(String) : undefined,
    });

    jest.advanceTimersByTime(5 * MIN);
    expect(storage.loadState().reminders).toHaveLength(0);
  });

  test('multiple reminders fire independently at their own times', () => {
    reminders.init({ send });
    reminders.schedule('uno', 1 * MIN);
    reminders.schedule('dos', 3 * MIN);

    jest.advanceTimersByTime(1 * MIN);
    expect(send).toHaveBeenCalledWith('⏰ Recordatorio: uno');

    jest.advanceTimersByTime(2 * MIN);
    expect(send).toHaveBeenCalledWith('⏰ Recordatorio: dos');
    expect(send).toHaveBeenCalledTimes(2);
  });

  test('boot restore with future triggerAt waits only the remaining ms', () => {
    storage.saveState(initialState({
      reminders: [{
        id: 'rem_x1',
        text: 'reunion',
        triggerAt: new Date(Date.now() + 7 * MIN).toISOString(),
      }],
    }));

    reminders.init({ send });
    expect(send).not.toHaveBeenCalled();
    expect(reminders.list()).toHaveLength(1);

    jest.advanceTimersByTime(7 * MIN - 1);
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith('⏰ Recordatorio: reunion');
    expect(reminders.list()).toHaveLength(0);
  });

  test('boot restore fires expired reminders immediately (SAD 5.2)', () => {
    storage.saveState(initialState({
      reminders: [{
        id: 'rem_expired',
        text: 'pagar luz',
        triggerAt: new Date(Date.now() - 30 * MIN).toISOString(),
      }],
    }));

    reminders.init({ send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('⏰ Recordatorio: pagar luz');
    expect(storage.loadState().reminders).toHaveLength(0);
  });

  test('rejects invalid schedules', () => {
    reminders.init({ send });
    expect(() => reminders.schedule('', 1000)).toThrow(TypeError);
    expect(() => reminders.schedule('texto', 0)).toThrow(TypeError);
    expect(() => reminders.schedule('texto', NaN)).toThrow(TypeError);
    expect(storage.loadState().reminders).toHaveLength(0);
  });

  test('shutdown clears pending timers', () => {
    reminders.init({ send });
    reminders.schedule('nunca', 5 * MIN);
    reminders.shutdown();

    jest.advanceTimersByTime(60 * MIN);
    expect(send).not.toHaveBeenCalled();
  });
});
