const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const cwd = 'D:/workspace-v2/apps/account-style-library';
const log = 'D:/workspace-v2/codex-style.log';
const err = 'D:/workspace-v2/codex-style.err.log';
const env = { ...process.env };
if (env.Path && !env.PATH) env.PATH = env.Path;
if (env.Path && env.PATH && env.Path !== env.PATH) delete env.Path;
env.PATH = [
  'C:\\Program Files\\nodejs',
  'C:\\Users\\Administrator\\AppData\\Roaming\\npm',
  env.PATH || ''
].join(';');
fs.appendFileSync(log, `\n[start-style] ${new Date().toISOString()} cwd=${cwd}\n`);
const child = cp.spawn('C:/Program Files/nodejs/node.exe', ['node_modules/next/dist/bin/next', 'dev', '-p', '3100'], {
  cwd,
  env,
  detached: true,
  stdio: ['ignore', fs.openSync(log, 'a'), fs.openSync(err, 'a')],
  windowsHide: true
});
fs.writeFileSync('D:/workspace-v2/codex-style.pid', String(child.pid));
child.unref();
console.log(`started ${child.pid}`);
