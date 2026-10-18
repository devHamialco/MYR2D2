'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DEFAULT_STATE = {
  hydration: { status: 'IDLE' },
  pomodoro: { currentState: 'IDLE', cycleCount: 0 },
  reminders: [],
};

let baseDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));

function init(dataDir) {
  if (dataDir) baseDir = path.resolve(dataDir);
  ensureDataDir();
  return baseDir;
}

function statePath() {
  return path.join(baseDir, 'state.json');
}

function tasksPath() {
  return path.join(baseDir, 'tasks.json');
}

function ensureDataDir() {
  fs.mkdirSync(baseDir, { recursive: true });
}

function readJSON(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn(`storage: failed to read ${filePath}: ${err.message}`);
    }
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDataDir();
  const tmpPath = `${filePath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    logger.warn(`storage: atomic write failed for ${filePath}, falling back: ${err.message}`);
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (fallbackErr) {
      logger.error(`storage: write failed for ${filePath}: ${fallbackErr.message}`);
    }
  }
}

function mergeState(raw) {
  const state = raw && typeof raw === 'object' ? raw : {};
  return {
    hydration: { ...DEFAULT_STATE.hydration, ...(state.hydration || {}) },
    pomodoro: { ...DEFAULT_STATE.pomodoro, ...(state.pomodoro || {}) },
    reminders: Array.isArray(state.reminders) ? state.reminders : [],
  };
}

function loadState() {
  return mergeState(readJSON(statePath(), null));
}

function saveState(state) {
  writeJSON(statePath(), state);
}

function loadTasks() {
  const raw = readJSON(tasksPath(), null);
  if (raw && Array.isArray(raw.tasks)) return { tasks: raw.tasks };
  return { tasks: [] };
}

function saveTasks(data) {
  writeJSON(tasksPath(), data);
}

module.exports = {
  init,
  ensureDataDir,
  readJSON,
  writeJSON,
  loadState,
  saveState,
  loadTasks,
  saveTasks,
  statePath,
  tasksPath,
  DEFAULT_STATE,
};
