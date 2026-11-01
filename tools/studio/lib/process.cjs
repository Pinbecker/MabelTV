'use strict';
const { spawn } = require('node:child_process');

function run(executable, args, { signal, timeout = 120000, onLine = () => {}, env = {}, maxOutput = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Stopped'));
    const child = spawn(executable, args, { windowsHide: true, shell: false,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', pending = '', failure = null;
    const stop = () => {
      failure ||= new Error('Stopped');
      if (!child.pid) return;
      if (process.platform === 'win32') spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'],
        { windowsHide: true, shell: false, stdio: 'ignore' });
      else child.kill('SIGTERM');
    };
    const timer = setTimeout(() => { failure = new Error('This operation took too long. Please retry.'); stop(); }, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    const receive = chunk => {
      const text = chunk.toString('utf8');
      output = (output + text).slice(-maxOutput);
      pending += text;
      const lines = pending.split(/[\r\n]+/); pending = lines.pop();
      for (const line of lines) if (line) onLine(line);
    };
    child.stdout.on('data', receive); child.stderr.on('data', receive);
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (pending) onLine(pending);
      if (failure) reject(failure);
      else if (code !== 0) {
        const lines = output.split(/[\r\n]+/);
        const errors = lines.filter(line => /\bERROR\b|No media streams|No versions of this programme|Invalid|failed/i.test(line));
        const meaningful = errors.length ? errors : lines.filter(line => /WARNING/i.test(line));
        reject(new Error(meaningful.slice(-8).join('\n').slice(-3000) || `The media tool stopped (code ${code}).`));
      } else resolve(output);
    });
  });
}
module.exports = { run };
