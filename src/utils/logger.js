'use strict';

function timestamp() {
  return new Date().toISOString();
}

function format(level, args) {
  const msg = args
    .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.stack || a.message : JSON.stringify(a)))
    .join(' ');
  return `[${timestamp()}] [${level}] ${msg}`;
}

function info(...args) {
  console.log(format('INFO', args));
}

function warn(...args) {
  console.warn(format('WARN', args));
}

function error(...args) {
  console.error(format('ERROR', args));
}

function debug(...args) {
  if (process.env.DEBUG) {
    console.log(format('DEBUG', args));
  }
}

module.exports = { info, warn, error, debug };
