const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_WINDOWS_PYTHON = 'C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe';

module.exports = function createPythonRuntime(options) {
  var serverDir = options.serverDir;
  var rootDir = path.join(serverDir, '..');
  var defaultWindowsPython = options.defaultWindowsPython || DEFAULT_WINDOWS_PYTHON;
  var isWindows = process.platform === 'win32';

  function existingRuntimePathDirs() {
    return [
      path.join(rootDir, '.venv', isWindows ? 'Scripts' : 'bin'),
      path.join(rootDir, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts' : 'bin'),
      path.join(rootDir, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts' : 'bin'),
      path.join(rootDir, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin'),
      path.join(rootDir, '.runtime', 'uv'),
      path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm')
    ].filter(function(dir) { return fs.existsSync(dir); });
  }

  function buildPythonEnv() {
    var env = Object.assign({}, process.env, {
      PYTHONIOENCODING: 'utf-8',
      SILICONFLOW_API_KEY: process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '',
      SF_KEY: process.env.SF_KEY || process.env.SILICONFLOW_API_KEY || '',
      API_KEY: process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '',
      DOUYIN_DOWNLOADER_ROOT: process.env.DOUYIN_DOWNLOADER_ROOT || path.join(rootDir, 'tools', 'douyin-downloader'),
      BILIBILI_CLI_ROOT: process.env.BILIBILI_CLI_ROOT || path.join(rootDir, 'tools', 'bilibili-cli')
    });
    var douyinPython = path.join(rootDir, 'tools', 'douyin-downloader', '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
    var bilibiliPython = path.join(rootDir, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts\\python.exe' : 'bin/python');
    var bilibiliBin = path.join(rootDir, 'tools', 'bilibili-cli', '.venv', isWindows ? 'Scripts\\bili.exe' : 'bin/bili');
    var npmGlobalBin = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm');
    var larkCliBin = path.join(npmGlobalBin, isWindows ? 'lark-cli.cmd' : 'lark-cli');
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
    env.PATH = existingRuntimePathDirs().concat(env.PATH || '').join(path.delimiter);
    return env;
  }

  function getPythonCandidates() {
    var candidates = [];
    var fromEnv = process.env.PYTHON || process.env.PYTHON_BIN || process.env.PYTHON_EXECUTABLE;
    if (fromEnv) candidates.push(fromEnv);
    if (process.platform === 'win32') {
      var workspacePython = path.join(rootDir, '.venv', 'Scripts', 'python.exe');
      if (fs.existsSync(workspacePython)) candidates.push(workspacePython);
      if (fs.existsSync(defaultWindowsPython)) candidates.push(defaultWindowsPython);
      candidates.push('python');
    } else {
      var unixWorkspacePython = path.join(rootDir, '.venv', 'bin', 'python');
      if (fs.existsSync(unixWorkspacePython)) candidates.push(unixWorkspacePython);
      candidates.push('python3', 'python');
    }
    return candidates.filter(function(cmd, idx) { return cmd && candidates.indexOf(cmd) === idx; });
  }

  function stringifyPayload(payload) {
    var seen = new WeakSet();
    return JSON.stringify(payload, function(key, value) {
      if (key && key.charAt(0) === '_') return undefined;
      if (typeof value === 'function') return undefined;
      if (value && typeof value === 'object') {
        if (seen.has(value)) return undefined;
        seen.add(value);
      }
      return value;
    });
  }

  function runPython(script, action, params, timeoutSec) {
    return new Promise(function(resolve) {
      var scriptPath = path.join(serverDir, script);
      if (!fs.existsSync(scriptPath)) {
        resolve({ error: 'python script not found: ' + script });
        return;
      }

      var tmpFile = path.join(os.tmpdir(), 'usagi_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.json');
      fs.writeFileSync(tmpFile, Buffer.from(stringifyPayload({ action: action, params: params }), 'utf8'));
      var candidates = getPythonCandidates();
      var settled = false;

      function finish(result) {
        if (settled) return;
        settled = true;
        try { fs.unlinkSync(tmpFile); } catch(e) {}
        resolve(result);
      }

      function attempt(index) {
        var cmd = candidates[index];
        if (!cmd) { finish({ error: 'python not found' }); return; }
        var py = spawn(cmd, [scriptPath, tmpFile], {
          env: buildPythonEnv(),
          shell: false
        });
        var outChunks = [], errChunks = [];
        var completed = false;
        var timer;
        if (timeoutSec) {
          timer = setTimeout(function() {
            if (completed) return;
            completed = true;
            py.kill();
            finish({ error: 'timeout after ' + timeoutSec + 's' });
          }, timeoutSec * 1000);
        }
        py.stdout.on('data', function(c) { outChunks.push(c); });
        py.stderr.on('data', function(c) { errChunks.push(c); });
        py.on('error', function(err) {
          if (completed) return;
          completed = true;
          if (timer) clearTimeout(timer);
          if (err.code === 'ENOENT' && index + 1 < candidates.length) {
            attempt(index + 1);
          } else {
            finish({ error: err.message });
          }
        });
        py.on('close', function() {
          if (completed) return;
          completed = true;
          if (timer) clearTimeout(timer);
          var outStr = Buffer.concat(outChunks).toString('utf8');
          var errStr = Buffer.concat(errChunks).toString('utf8');
          try { finish(JSON.parse(outStr)); }
          catch (e) { finish({ error: errStr.trim().substring(0,300) || outStr.substring(0,200) }); }
        });
        py.stdin.end();
      }

      attempt(0);
    });
  }

  return {
    getPythonCandidates: getPythonCandidates,
    runPython: runPython
  };
};
