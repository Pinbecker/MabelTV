'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
function retry(operation, io = fs, wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)) {
  for (let attempt = 0; ; attempt++) {
    try { return operation(io); }
    catch (error) {
      if (attempt >= 7 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      wait(Math.min(250, 25 * 2 ** attempt));
    }
  }
}
function writeJson(file, value, { backup = false, io = fs, wait } = {}) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp', previous = temporary + '.previous';
  try {
    const descriptor = io.openSync(temporary, 'wx', 0o600);
    try { io.writeFileSync(descriptor, JSON.stringify(value, null, 2)); io.fsyncSync(descriptor); }
    finally { io.closeSync(descriptor); }
    if (backup && io.existsSync(file)) {
      retry(() => io.copyFileSync(file, previous), io, wait);
      retry(() => io.renameSync(previous, file + '.bak'), io, wait);
    }
    retry(() => io.renameSync(temporary, file), io, wait);
  } finally {
    for (const item of [temporary, previous]) { try { io.unlinkSync(item); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
}
module.exports = { writeJson, retry };
