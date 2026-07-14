const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const session = process.argv[2] || '';
const logFile = session
  ? path.join(root, 'data', 'data-export-tests', `${session}.stderr.log`)
  : '';

if (!logFile || !fs.existsSync(logFile)) {
  console.error('usage: node scripts/account-data-collect-progress.cjs <session>');
  process.exit(1);
}

const text = fs.readFileSync(logFile, 'utf8');
const lines = text.split(/\r?\n/);
const started = [];
const ok = [];
const failed = [];
const skipped = [];
let current = '';

for (const line of lines) {
  let match = line.match(/^\[batch\] group (\d+)\/(\d+) start targets=(.+)$/);
  if (match) {
    current = match[3];
    started.push({ index: Number(match[1]), total: Number(match[2]), target: match[3] });
    continue;
  }
  match = line.match(/^\[batch\] (.+?) ok code=/);
  if (match) ok.push(match[1]);
  match = line.match(/^\[batch\] (.+?) failed code=/);
  if (match) failed.push(match[1]);
  match = line.match(/^\[batch\] (.+?) skipped code=/);
  if (match) skipped.push(match[1]);
}

const last = started[started.length - 1] || { index: 0, total: 0, target: '' };
console.log(JSON.stringify({
  session,
  total: last.total,
  started: started.length,
  completed: ok.length + failed.length + skipped.length,
  ok: ok.length,
  skipped: skipped.length,
  failed: failed.length,
  current,
  skippedTargets: skipped.slice(-20),
  failedTargets: failed.slice(-20)
}, null, 2));
