const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const DIR = __dirname;
const LOG = path.join(DIR, 'hook.log');
const log = (m) => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch (_) {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function resolveExe() {
  const custom = path.join(DIR, 'exe-path.txt');
  try {
    if (fs.existsSync(custom)) {
      const line = fs.readFileSync(custom, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (line) return line;
    }
  } catch (_) {}
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DeepSeek Harness', 'DeepSeek Harness.exe'),
    'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
    'H:\\Agent\\Deepseek-Harness\\DeepSeek Harness.exe',
  ];
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch (_) {}
  }
  return candidates[candidates.length - 1];
}

function cleanEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function inspectorUrl(port) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) return list[0].webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(250);
  }
  return null;
}

function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = 1;
    const timer = setTimeout(() => reject(new Error('evaluate timeout')), 15000);
    const onMessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data.toString()); } catch (_) { return; }
      if (msg.id === id) { clearTimeout(timer); ws.removeEventListener('message', onMessage); resolve(msg); }
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true } }));
  });
}

(async () => {
  const exe = resolveExe();
  const plain = () => {
    const c = spawn(exe, [], { detached: true, stdio: 'ignore', env: cleanEnv() });
    c.unref();
  };
  if (!fs.existsSync(exe)) { log('exe not found: ' + exe); return; }
  if (fs.existsSync(path.join(DIR, 'hook.disabled'))) { log('hook.disabled present -> plain start'); plain(); return; }

  const port = await freePort();
  const child = spawn(exe, ['--inspect=' + port], { detached: true, stdio: 'ignore', env: cleanEnv() });
  child.unref();
  log('spawned --inspect=' + port + ' pid=' + child.pid);
  try {
    const url = await inspectorUrl(port);
    if (!url) { log('inspector unreachable (already running? single-instance lock)'); return; }
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
    const code = fs.readFileSync(path.join(DIR, 'hook-inject.js'), 'utf8')
      .split('__HOOK_DIR__').join(JSON.stringify(DIR));
    const res = await evaluate(ws, code);
    log('inject result: ' + JSON.stringify(res && res.result));
    ws.close();
  } catch (err) {
    log('inject failed: ' + ((err && err.message) || err));
  }
})().catch((e) => log('launcher error: ' + ((e && e.message) || e)));