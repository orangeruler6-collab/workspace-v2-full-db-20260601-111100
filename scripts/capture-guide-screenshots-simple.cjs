const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'docs', 'guide-screenshots');
const PROFILE_DIR = path.join(ROOT, 'temp', 'guide-chrome-profile-simple');
const CHROME = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 3009;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (e) {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${url}`);
}

function chromeShot(url, file) {
  const out = path.join(OUT_DIR, file);
  const result = spawnSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--disable-software-rasterizer=false',
    '--disable-dev-shm-usage',
    '--disable-features=VizDisplayCompositor',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${PROFILE_DIR}-${file.replace(/\\W+/g, '-')}`,
    '--window-size=1440,1000',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000',
    `--screenshot=${out}`,
    url
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`screenshot failed ${file}: ${result.stderr || result.stdout}`);
  }
}

async function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const vite = spawn('cmd.exe', ['/c', 'npm.cmd', 'run', 'dev:front', '--', '--mode', 'screenshot', '--port', String(PORT), '--host', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  const logFile = path.join(ROOT, 'docs', 'guide-screenshots-vite.log');
  fs.rmSync(logFile, { force: true });
  vite.stdout.on('data', data => fs.appendFileSync(logFile, data));
  vite.stderr.on('data', data => fs.appendFileSync(logFile, data));

  try {
    await waitFor(`http://127.0.0.1:${PORT}/`);
    await sleep(1500);
    const shots = [
      ['01-account-hot-board.png', 'accountmonitor', '账号'],
      ['02-workflow.png', 'workflow', '文案工作流'],
      ['03-schedule.png', 'schedule', '排期'],
      ['04-tools.png', 'tools', '文案工具'],
      ['05-materials.png', 'material', '素材'],
      ['06-imagegen.png', 'imagegen', 'AI'],
      ['07-video-publish.png', 'videopublish', '视频发布']
    ];
    for (const [file, moduleId] of shots) {
      chromeShot(`http://127.0.0.1:${PORT}/guide-login.html?module=${moduleId}`, file);
    }
    chromeShot(`http://127.0.0.1:${PORT}/guide-login.html?module=accountmonitor`, '08-home-overview.png');
  } finally {
    vite.kill();
  }

  console.log(JSON.stringify({ outDir: OUT_DIR, count: fs.readdirSync(OUT_DIR).length }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
