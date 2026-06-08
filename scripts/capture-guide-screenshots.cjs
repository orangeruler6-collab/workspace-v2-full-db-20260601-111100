const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'guide-screenshots');
const PROFILE_DIR = path.join(ROOT, 'temp', 'guide-chrome-profile');
const CHROME = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9444;
const LOG_FILE = path.join(ROOT, 'docs', 'guide-screenshots.log');

function log(message) {
  fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitJson(url, tries = 40) {
  let lastError;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
    }
    await sleep(250);
  }
  throw lastError || new Error(`Cannot fetch ${url}`);
}

async function openTab(url) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`Cannot open tab: HTTP ${res.status}`);
  return res.json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();

  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
      else resolve(data.result || {});
    }
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
        },
        close() {
          ws.close();
        }
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function main() {
  fs.rmSync(LOG_FILE, { force: true });
  log(`browser=${CHROME}`);
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const loginRes = await fetch('http://localhost:5555/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: '陈健伊', password: 'chenjianyi123' })
  });
  const login = await loginRes.json();
  if (!loginRes.ok || login.error || !login.token) {
    throw new Error(login.error || 'login failed');
  }
  log(`login ok user=${login.user && login.user.username}`);

  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    'about:blank'
  ], { stdio: 'ignore' });
  log(`spawned pid=${chrome.pid}`);

  try {
    await waitJson(`http://127.0.0.1:${PORT}/json/version`);
    log('debug endpoint ready');
    const tabInfo = await openTab('http://localhost:3000/');
    log(`tab opened ${tabInfo.id || ''}`);
    const cdp = await connect(tabInfo.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
    await sleep(1200);
    await cdp.send('Runtime.evaluate', {
      expression: `
        localStorage.setItem('usagi_auth_token', ${JSON.stringify(login.token)});
        localStorage.setItem('usagi_auth_user', ${JSON.stringify(JSON.stringify(login.user))});
        localStorage.setItem('usagi_login', ${JSON.stringify(JSON.stringify({ user: login.user.username || login.user.display_name || '陈健伊' }))});
        true;
      `
    });
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
    await sleep(3000);
    log('auth state injected');

    const shots = [
      ['01-account-hot-board.png', 'accountmonitor', '账号热榜'],
      ['02-workflow.png', 'workflow', '文案工作流'],
      ['03-schedule.png', 'schedule', '排期看板'],
      ['04-tools.png', 'tools', '文案工具'],
      ['05-materials.png', 'material', '素材库'],
      ['06-imagegen.png', 'imagegen', 'AI 生图'],
      ['07-video-publish.png', 'videopublish', '视频发布'],
      ['08-usagi-ai.png', 'accountmonitor', '乌萨奇 AI']
    ];

    for (const [file, moduleId] of shots) {
      await cdp.send('Runtime.evaluate', {
        expression: `window.dispatchEvent(new CustomEvent('usagi:navigate', { detail: { module: ${JSON.stringify(moduleId)} } })); true;`
      });
      await sleep(1500);
      if (file === '08-usagi-ai.png') {
        await cdp.send('Runtime.evaluate', {
          expression: `document.querySelector('.pet-button')?.click(); true;`
        });
        await sleep(800);
      }
      const png = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true
      });
      fs.writeFileSync(path.join(OUT_DIR, file), Buffer.from(png.data, 'base64'));
      log(`saved ${file}`);
    }
    cdp.close();
  } finally {
    chrome.kill();
  }

  const result = { outDir: OUT_DIR, count: fs.readdirSync(OUT_DIR).length };
  log(`done ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
