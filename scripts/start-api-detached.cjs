const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isWindows = process.platform === 'win32';
const workspacePython = path.join(root, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const npmGlobalBin = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm');
const larkCliBin = path.join(npmGlobalBin, isWindows ? 'lark-cli.cmd' : 'lark-cli');
const runtimePathDirs = [
  path.join(root, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin'),
  path.join(root, '.runtime', 'uv'),
  npmGlobalBin
].filter(function(dir) { return fs.existsSync(dir); });
const out = fs.openSync(path.join(root, 'codex-api.log'), 'a');
const err = fs.openSync(path.join(root, 'codex-api.err.log'), 'a');
const env = Object.assign({}, process.env);

if (fs.existsSync(workspacePython)) {
  env.PYTHON = env.PYTHON || workspacePython;
  env.PYTHON_BIN = env.PYTHON_BIN || workspacePython;
  env.PYTHON_EXECUTABLE = env.PYTHON_EXECUTABLE || workspacePython;
}
env.DOUYIN_DOWNLOADER_ROOT = env.DOUYIN_DOWNLOADER_ROOT || path.join(root, 'tools', 'douyin-downloader');
env.BILIBILI_CLI_ROOT = env.BILIBILI_CLI_ROOT || path.join(root, 'tools', 'bilibili-cli');
if (fs.existsSync(larkCliBin)) env.LARK_CLI_BIN = env.LARK_CLI_BIN || larkCliBin;
if (isWindows && env.Path && env.PATH && env.Path !== env.PATH) {
  delete env.Path;
} else if (isWindows && env.Path && !env.PATH) {
  env.PATH = env.Path;
  delete env.Path;
}
env.PATH = runtimePathDirs.concat(env.PATH || '').join(path.delimiter);

const child = spawn(process.execPath, ['server/index.cjs'], {
  cwd: root,
  env,
  detached: true,
  stdio: ['ignore', out, err],
  windowsHide: true
});

child.unref();
console.log(child.pid);
