'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../src/utils/storage');
const pomodoro = require('../src/modules/pomodoro');

const MIN = 60 * 1000;
const { STATES, MESSAGES, PHRASES } = pomodoro;

function initialState(overrides = {}) {
  return {
    hydration: { status: 'IDLE', nextScheduledAt: null },
    pomodoro: { currentState: 'IDLE', cycleCount: 0, endsAt: null, ...overrides.pomodoro },
    reminders: [],
  };
}

function lastMessage(send) {
  const calls = send.mock.calls;
  return calls[calls.length - 1][0];
}

let send;
let tmpDir;

beforeEach(() => {
  jest.useFakeTimers();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2d2-pom-'));
  storage.init(tmpDir);
  send = jest.fn();
});

afterEach(() => {
  pomodoro.shutdown();
  jest.useRealTimers();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('pomodoro module (RF3.1-RF3.4)', () => {
  test('RF3.1/RF3.2: start confirms immediately and enters WORKING cycle 1', () => {
    pomodoro.init({ send });
    expect(pomodoro.start()).toBe(true);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(MESSAGES.started);
    expect(pomodoro.getState()).toEqual({
      currentState: STATES.WORKING,
      cycleCount: 1,
      endsAt: expect.any(String),
    });
    expect(
      new Date(pomodoro.getState().endsAt).getTime() - Date.now()
    ).toBe(25 * MIN);
    expect(pomodoro.isWorking()).toBe(true);
  });

  test('start while a session is running is rejected', () => {
    pomodoro.init({ send });
    pomodoro.start();
    expect(pomodoro.start()).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('RF3.3: full 130-minute sequence 25/5 x4 with prompts and phrase banks', () => {
    pomodoro.init({ send });
    pomodoro.start();
    const start = Date.now();

    // Work 1 -> short break 1
    jest.advanceTimersByTime(25 * MIN);
    expect(pomodoro.getState().currentState).toBe(STATES.SHORT_BREAK);
    expect(PHRASES.toShortBreak).toContain(lastMessage(send));

    // Short break 1 -> work 2
    jest.advanceTimersByTime(5 * MIN);
    expect(pomodoro.getState()).toMatchObject({ currentState: STATES.WORKING, cycleCount: 2 });
    expect(PHRASES.toWork).toContain(lastMessage(send));

    // Work 2 -> short break 2 -> work 3
    jest.advanceTimersByTime(25 * MIN + 5 * MIN);
    expect(pomodoro.getState()).toMatchObject({ currentState: STATES.WORKING, cycleCount: 3 });

    // Work 3 -> short break 3 -> work 4
    jest.advanceTimersByTime(25 * MIN + 5 * MIN);
    expect(pomodoro.getState()).toMatchObject({ currentState: STATES.WORKING, cycleCount: 4 });

    // Work 4 -> long break (no 4th short break)
    jest.advanceTimersByTime(25 * MIN);
    expect(pomodoro.getState().currentState).toBe(STATES.LONG_BREAK);
    expect(PHRASES.toLongBreak).toContain(lastMessage(send));

    // Long break -> continuation prompt
    jest.advanceTimersByTime(15 * MIN);
    expect(pomodoro.getState().currentState).toBe(STATES.WAITING_CONTINUATION_RESPONSE);
    expect(lastMessage(send)).toBe(MESSAGES.continuePrompt);
    expect(pomodoro.awaitingContinuation()).toBe(true);

    expect(Date.now() - start).toBe(130 * MIN);
  });

  test('RF3.4: YES restarts a full cycle, NO finishes the session', () => {
    pomodoro.init({ send });
    pomodoro.start();
    jest.advanceTimersByTime(130 * MIN);
    expect(pomodoro.awaitingContinuation()).toBe(true);

    expect(pomodoro.handleContinuation(true)).toBe(true);
    expect(pomodoro.getState()).toMatchObject({ currentState: STATES.WORKING, cycleCount: 1 });
    expect(lastMessage(send)).toBe(MESSAGES.started);

    jest.advanceTimersByTime(130 * MIN);
    expect(pomodoro.awaitingContinuation()).toBe(true);

    expect(pomodoro.handleContinuation(false)).toBe(true);
    expect(pomodoro.getState()).toMatchObject({ currentState: STATES.IDLE, endsAt: null });
    expect(lastMessage(send)).toBe(MESSAGES.finished);
    expect(pomodoro.awaitingContinuation()).toBe(false);
  });

  test('continuation answers are rejected outside the waiting state', () => {
    pomodoro.init({ send });
    expect(pomodoro.handleContinuation(true)).toBe(false);
    pomodoro.start();
    expect(pomodoro.handleContinuation(false)).toBe(false);
  });

  test('isWorking only during work intervals (tasks suppression gate)', () => {
    pomodoro.init({ send });
    expect(pomodoro.isWorking()).toBe(false);
    pomodoro.start();
    expect(pomodoro.isWorking()).toBe(true);
    jest.advanceTimersByTime(25 * MIN); // short break
    expect(pomodoro.isWorking()).toBe(false);
    jest.advanceTimersByTime(5 * MIN); // work again
    expect(pomodoro.isWorking()).toBe(true);
    jest.advanceTimersByTime(25 * MIN); // short break
    expect(pomodoro.isWorking()).toBe(false);
  });

  test('persists state transitions to state.json', () => {
    pomodoro.init({ send });
    pomodoro.start();

    expect(storage.loadState().pomodoro).toEqual({
      currentState: STATES.WORKING,
      cycleCount: 1,
      endsAt: expect.any(String),
    });

    jest.advanceTimersByTime(25 * MIN);
    expect(storage.loadState().pomodoro.currentState).toBe(STATES.SHORT_BREAK);
  });

  test('boot restore with future endsAt waits only the remaining ms', () => {
    storage.saveState(initialState({
      pomodoro: {
        currentState: STATES.WORKING,
        cycleCount: 2,
        endsAt: new Date(Date.now() + 10 * MIN).toISOString(),
      },
    }));

    pomodoro.init({ send });
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10 * MIN - 1);
    expect(send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(pomodoro.getState().currentState).toBe(STATES.SHORT_BREAK);
    expect(PHRASES.toShortBreak).toContain(lastMessage(send));
  });

  test('boot restore with expired endsAt transitions immediately (SAD 5.2)', () => {
    storage.saveState(initialState({
      pomodoro: {
        currentState: STATES.WORKING,
        cycleCount: 1,
        endsAt: new Date(Date.now() - 5 * MIN).toISOString(),
      },
    }));

    pomodoro.init({ send });
    expect(pomodoro.getState().currentState).toBe(STATES.SHORT_BREAK);
    expect(PHRASES.toShortBreak).toContain(lastMessage(send));
    expect(storage.loadState().pomodoro.currentState).toBe(STATES.SHORT_BREAK);
  });

  test('boot restore keeps WAITING state without scheduling timers', () => {
    storage.saveState(initialState({
      pomodoro: {
        currentState: STATES.WAITING_CONTINUATION_RESPONSE,
        cycleCount: 4,
        endsAt: null,
      },
    }));

    pomodoro.init({ send });
    expect(send).not.toHaveBeenCalled();
    expect(pomodoro.awaitingContinuation()).toBe(true);

    jest.advanceTimersByTime(60 * MIN);
    expect(send).not.toHaveBeenCalled();
  });

  test('corrupt/missing endsAt on an active state recovers by advancing now', () => {
    storage.saveState(initialState({
      pomodoro: { currentState: STATES.SHORT_BREAK, cycleCount: 1, endsAt: null },
    }));

    pomodoro.init({ send });
    expect(pomodoro.getState().currentState).toBe(STATES.WORKING);
    expect(pomodoro.getState().cycleCount).toBe(2);
    expect(PHRASES.toWork).toContain(lastMessage(send));
  });
});
