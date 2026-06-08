#!/usr/bin/env node

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require('../server/env.cjs').loadEnv(ROOT);
const isWindows = process.platform === 'win32';
const workspacePython = path.join(ROOT, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const douyinRoot = path.join(ROOT, 'tools', 'douyin-downloader');
const douyinPython = path.join(douyinRoot, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const bilibiliRoot = path.join(ROOT, 'tools', 'bilibili-cli');
const bilibiliPython = path.join(bilibiliRoot, '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
const bilibiliBin = path.join(bilibiliRoot, '.venv', isWindows ? 'Scripts\\bili.exe' : 'bin/bili');
const npmGlobalBin = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm');
const larkCliBin = path.join(npmGlobalBin, isWindows ? 'lark-cli.cmd' : 'lark-cli');
const localPathDirs = [
  path.join(ROOT, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(douyinRoot, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(bilibiliRoot, '.venv', isWindows ? 'Scripts' : 'bin'),
  path.join(ROOT, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin'),
  path.join(ROOT, '.runtime', 'uv'),
  npmGlobalBin
].filter(dir => fs.existsSync(dir));

const ENV_KEYS = [
  'GATEWAY_TOKEN',
  'SILICONFLOW_API_KEY',
  'SF_KEY',
  'MINIMAX_API_KEY',
  'GPT_IMAGE2_KEY',
  'USAGI_ADMIN_USER',
  'USAGI_ADMIN_PASSWORD',
  'USAGI_REGISTER_INVITE_CODE',
  'USAGI_AUTH_DISABLED',
  'VITE_USAGI_AUTH_DISABLED'
];

const LEGACY_DOUYIN_ROOT = '/Users/xjx/Documents/New project/douyin-downloader';
const DOUYIN_MODULES = [
  'yaml',
  'aiohttp',
  'aiofiles',
  'aiosqlite',
  'rich',
  'gmssl'
];
const OPTIONAL_DOUYIN_MODULES = [
  ['playwright', '网页解析/浏览器兜底'],
  ['yt_dlp', '视频下载兜底'],
  ['whisper', '本地 Whisper 转写']
];
const BILIBILI_MODULES = [
  'bilibili_api',
  'click',
  'rich',
  'aiohttp',
  'browser_cookie3',
  'yaml',
  'qrcode'
];
const OPTIONAL_BILIBILI_MODULES = [
  ['av', '音频切分/更稳的音频处理']
];
const WORKSPACE_PY_MODULES = [
  ['requests', '旧转写脚本/video_info/quick_search'],
  ['playwright', 'video_info 抖音标题解析'],
  ['chromadb', '旧 Chroma 调试脚本']
];

const BINARIES = [
  'sqlite3',
  'ffmpeg',
  'ffprobe'
];

function ok(label, detail) {
  console.log('✓ ' + label + (detail ? ' ' + detail : ''));
}

function warn(label, detail) {
  console.log('! ' + label + (detail ? ' ' + detail : ''));
}

function run(cmd, args) {
  const env = Object.assign({}, process.env, {
    PYTHONIOENCODING: 'utf-8',
    DOUYIN_DOWNLOADER_ROOT: process.env.DOUYIN_DOWNLOADER_ROOT || douyinRoot,
    BILIBILI_CLI_ROOT: process.env.BILIBILI_CLI_ROOT || bilibiliRoot
  });
  if (fs.existsSync(workspacePython)) {
    env.PYTHON = env.PYTHON || workspacePython;
    env.PYTHON_BIN = env.PYTHON_BIN || workspacePython;
    env.PYTHON_EXECUTABLE = env.PYTHON_EXECUTABLE || workspacePython;
  }
  if (fs.existsSync(douyinPython)) env.DOUYIN_DOWNLOADER_PYTHON = env.DOUYIN_DOWNLOADER_PYTHON || douyinPython;
  if (fs.existsSync(bilibiliPython)) env.BILIBILI_CLI_PYTHON = env.BILIBILI_CLI_PYTHON || bilibiliPython;
  if (fs.existsSync(bilibiliBin)) env.BILIBILI_CLI_BIN = env.BILIBILI_CLI_BIN || bilibiliBin;
  if (fs.existsSync(larkCliBin)) env.LARK_CLI_BIN = env.LARK_CLI_BIN || larkCliBin;
  if (isWindows && env.Path && env.PATH && env.Path !== env.PATH) {
    delete env.Path;
  } else if (isWindows && env.Path && !env.PATH) {
    env.PATH = env.Path;
    delete env.Path;
  }
  env.PATH = localPathDirs.concat(env.PATH || '').join(path.delimiter);
  return spawnSync(cmd, args || [], {
    cwd: ROOT,
    encoding: 'utf8',
    env
  });
}

function commandExists(cmd) {
  const result = run(process.platform === 'win32' ? 'where' : 'which', [cmd]);
  return result.status === 0;
}

function checkEnv() {
  console.log('\nEnvironment');
  ENV_KEYS.forEach(key => {
    const value = process.env[key];
    if (value === undefined || value === '') warn(key, '未配置');
    else ok(key, key.indexOf('DISABLED') >= 0 ? '=' + value : '已配置');
  });
}

function checkNode() {
  console.log('\nNode');
  ok('node', process.version);
  try {
    require('sqlite3');
    ok('sqlite3 native module', '可加载');
  } catch(e) {
    warn('sqlite3 native module', e.message.split('\n')[0]);
  }
  try {
    require('xlsx');
    ok('xlsx', '可加载');
  } catch(e) {
    warn('xlsx', e.message);
  }
}

function checkPython() {
  console.log('\nWorkspace Python');
  const candidates = [process.env.PYTHON, process.env.PYTHON_BIN, process.env.PYTHON_EXECUTABLE, workspacePython, 'python3', 'python'].filter(Boolean);
  let python = '';
  for (const candidate of candidates) {
    const result = run(candidate, ['--version']);
    if (result.status === 0) {
      python = candidate;
      ok(candidate, (result.stdout || result.stderr).trim());
      break;
    }
  }
  if (!python) {
    warn('python', '未找到，转写/向量/飞书/热点等 Python 功能不可用');
    return;
  }

  WORKSPACE_PY_MODULES.forEach(([mod, purpose]) => {
    const result = run(python, ['-c', 'import ' + mod]);
    if (result.status === 0) ok('python module ' + mod, '可加载');
    else warn('python module ' + mod, '缺失：' + purpose);
  });
}

function firstExisting(paths) {
  return paths.find(item => item && fs.existsSync(item)) || '';
}

function pickDouyinRoot() {
  return firstExisting([
    process.env.DOUYIN_DOWNLOADER_ROOT,
    path.join(ROOT, 'tools', 'douyin-downloader'),
    LEGACY_DOUYIN_ROOT
  ]);
}

function pickDouyinPython(root) {
  return firstExisting([
    process.env.DOUYIN_DOWNLOADER_PYTHON,
    path.join(root, '.venv314', 'bin', 'python'),
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, '.venv', 'bin', 'python'),
    path.join(ROOT, '.venv', 'Scripts', 'python.exe'),
    path.join(LEGACY_DOUYIN_ROOT, '.venv314', 'bin', 'python'),
    path.join(LEGACY_DOUYIN_ROOT, '.venv', 'bin', 'python')
  ]) || 'python3';
}

function pickDouyinConfig(root) {
  return firstExisting([
    process.env.DOUYIN_DOWNLOADER_CONFIG,
    path.join(root, 'config.local.yml'),
    path.join(root, 'config.yml'),
    path.join(root, 'config.example.yml')
  ]);
}

function pickBilibiliRoot() {
  return firstExisting([
    process.env.BILIBILI_CLI_ROOT,
    path.join(ROOT, 'tools', 'bilibili-cli')
  ]);
}

function pickBilibiliPython(root) {
  return firstExisting([
    process.env.BILIBILI_CLI_PYTHON,
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, '.venv', 'Scripts', 'python.exe')
  ]) || '';
}

function pickBilibiliBin(root) {
  return firstExisting([
    process.env.BILIBILI_CLI_BIN,
    path.join(root, '.venv', 'bin', 'bili'),
    path.join(root, '.venv', 'Scripts', 'bili.exe')
  ]) || (commandExists('bili') ? 'bili' : '');
}

function checkDouyinDownloader() {
  console.log('\nDouyin Downloader');
  const root = pickDouyinRoot();
  if (!root) {
    warn('root', '未找到 douyin-downloader');
    return;
  }
  ok('root', root);

  const python = pickDouyinPython(root);
  const version = run(python, ['--version']);
  if (version.status === 0) ok('python', python + ' (' + (version.stdout || version.stderr).trim() + ')');
  else warn('python', python + ' 不可执行');

  const config = pickDouyinConfig(root);
  if (config) ok('config', config);
  else warn('config', '未找到 config.local.yml/config.yml/config.example.yml');

  const help = run(python, [path.join(root, 'run.py'), '--help']);
  if (help.status === 0) ok('run.py', '可启动');
  else warn('run.py', '启动失败：' + (help.stderr || help.stdout || '').split('\n')[0]);

  DOUYIN_MODULES.forEach(mod => {
    const result = run(python, ['-c', 'import ' + mod]);
    if (result.status === 0) ok('module ' + mod, '可加载');
    else warn('module ' + mod, '缺失：douyin-downloader 核心功能可能不可用');
  });

  OPTIONAL_DOUYIN_MODULES.forEach(([mod, purpose]) => {
    const result = run(python, ['-c', 'import ' + mod]);
    if (result.status === 0) ok('optional ' + mod, '可加载');
    else warn('optional ' + mod, '缺失：' + purpose + '不可用');
  });
}

function checkBilibiliCli() {
  console.log('\nBilibili CLI');
  const root = pickBilibiliRoot();
  if (!root) {
    warn('root', '未找到 tools/bilibili-cli，请运行 git submodule update --init --recursive');
    return;
  }
  ok('root', root);

  if (fs.existsSync(path.join(root, 'pyproject.toml'))) ok('pyproject.toml', '存在');
  else warn('pyproject.toml', '缺失');

  const bin = pickBilibiliBin(root);
  if (bin) ok('bili command', bin);
  else warn('bili command', '未找到；首次使用请执行：cd tools/bilibili-cli && uv sync --extra audio');

  const python = pickBilibiliPython(root);
  if (!python) {
    warn('python env', '未找到 .venv；首次使用请执行：cd tools/bilibili-cli && uv sync --extra audio');
    return;
  }

  const version = run(python, ['--version']);
  if (version.status === 0) ok('python', python + ' (' + (version.stdout || version.stderr).trim() + ')');
  else warn('python', python + ' 不可执行');

  BILIBILI_MODULES.forEach(mod => {
    const result = run(python, ['-c', 'import ' + mod]);
    if (result.status === 0) ok('module ' + mod, '可加载');
    else warn('module ' + mod, '缺失：bilibili-cli 核心功能可能不可用');
  });

  OPTIONAL_BILIBILI_MODULES.forEach(([mod, purpose]) => {
    const result = run(python, ['-c', 'import ' + mod]);
    if (result.status === 0) ok('optional ' + mod, '可加载');
    else warn('optional ' + mod, '缺失：' + purpose + '不可用');
  });
}

function checkBinaries() {
  console.log('\nBinaries');
  BINARIES.forEach(cmd => {
    if (commandExists(cmd)) ok(cmd, '已安装');
    else warn(cmd, '未找到');
  });
  if (commandExists('lark-cli') || fs.existsSync(larkCliBin)) ok('lark-cli', process.env.LARK_CLI_BIN || larkCliBin || '已安装');
  else warn('lark-cli', '未找到，飞书 CLI 兜底读取不可用');
}

function checkFiles() {
  console.log('\nFiles');
  [
    'server/index.cjs',
    'server/lib/auth.cjs',
    'server/lib/python.cjs',
    'server/routes/tools.cjs',
    'server/routes/vector.cjs',
    'server/routes/imagegen.cjs',
    'server/routes/dailyHot.cjs',
    'server/profit_db.py',
    'server/chroma_combined.py',
    'server/douyin_downloader_bridge.py'
  ].forEach(file => {
    if (fs.existsSync(path.join(ROOT, file))) ok(file);
    else warn(file, '缺失');
  });

  [
    'server/dreamina_api.py'
  ].forEach(file => {
    if (fs.existsSync(path.join(ROOT, file))) ok(file);
    else warn(file, '缺失：即梦生图入口会不可用');
  });
}

checkEnv();
checkNode();
checkPython();
checkDouyinDownloader();
checkBilibiliCli();
checkBinaries();
checkFiles();
