const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function mkdirp(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(filePath, fallback) { try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return fallback; } }
function writeJsonAtomic(filePath, data) {
  mkdirp(path.dirname(filePath));
  const tmp = filePath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}
function shanghaiParts(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(date).reduce(function(acc, item) { acc[item.type] = item.value; return acc; }, {});
}
function dateKey(date) {
  const p = shanghaiParts(date);
  return p.year + '-' + p.month + '-' + p.day;
}
function parseDailyTime(value) {
  const m = String(value || '05:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  return { hour: m ? Math.min(23, Math.max(0, Number(m[1]))) : 5, minute: m ? Math.min(59, Math.max(0, Number(m[2]))) : 0 };
}
function nextDelayMs(hour, minute) {
  const p = shanghaiParts(new Date());
  const now = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  const target = hour * 3600 + minute * 60;
  let seconds = target - now;
  if (seconds <= 0) seconds += 24 * 3600;
  return Math.max(1000, seconds * 1000);
}
function status(ok, warn) { return ok ? 'ok' : (warn ? 'warn' : 'fail'); }
function checkPath(name, targetPath, kind, required) {
  try {
    const stat = fs.statSync(targetPath);
    const ok = kind === 'file' ? stat.isFile() : stat.isDirectory();
    return { name, ok, status: status(ok, required === false), message: ok ? targetPath : 'path type mismatch: ' + targetPath, path: targetPath };
  } catch (e) {
    return { name, ok: false, status: required === false ? 'warn' : 'fail', message: 'missing path: ' + targetPath, path: targetPath };
  }
}
function checkHttp(name, url, timeoutMs) {
  const startedAt = Date.now();
  return new Promise(function(resolve) {
    let u;
    try { u = new URL(url); } catch (e) { resolve({ name, ok: false, status: 'fail', message: e.message, url, durationMs: 0 }); return; }
    const req = http.request({ hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: 'GET', timeout: timeoutMs }, function(res) {
      res.resume();
      res.on('end', function() {
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        resolve({ name, ok, status: ok ? 'ok' : 'fail', message: 'HTTP ' + res.statusCode, url, durationMs: Date.now() - startedAt });
      });
    });
    req.on('timeout', function() { req.destroy(new Error('timeout ' + timeoutMs + 'ms')); });
    req.on('error', function(error) { resolve({ name, ok: false, status: 'fail', message: error.message, url, durationMs: Date.now() - startedAt }); });
    req.end();
  });
}
function commandName(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'npm') return 'npm.cmd';
  return command;
}
function checkCommand(name, command, args, options) {
  const startedAt = Date.now();
  options = options || {};
  return new Promise(function(resolve) {
    execFile(commandName(command), args || [], { cwd: options.cwd || process.cwd(), timeout: options.timeoutMs || 5000, windowsHide: true }, function(error, stdout, stderr) {
      const output = String(stdout || stderr || '').trim().split(/\r?\n/)[0] || 'ok';
      if (error) {
        resolve({ name, ok: false, status: options.required === false ? 'warn' : 'fail', message: (error.message || output).slice(0, 500), durationMs: Date.now() - startedAt });
        return;
      }
      resolve({ name, ok: true, status: 'ok', message: output.slice(0, 300), durationMs: Date.now() - startedAt });
    });
  });
}
function tailFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, stat.size - size);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch (e) { return ''; }
}
function scanLog(name, filePath, patterns) {
  const text = tailFile(filePath, 256 * 1024);
  if (!text) return { name, ok: true, status: 'ok', message: 'no recent log', path: filePath, hits: [] };
  const hits = text.split(/\r?\n/).filter(Boolean).slice(-1500).filter(function(line) {
    return patterns.some(function(pattern) { return pattern.test(line); });
  }).slice(-10).map(function(line) { return line.slice(0, 600); });
  return { name, ok: hits.length === 0, status: hits.length ? 'warn' : 'ok', message: hits.length ? 'recent suspicious log lines: ' + hits.length : 'no suspicious keywords', path: filePath, hits };
}
function summarize(groups) {
  const summary = { ok: 0, warn: 0, fail: 0, total: 0 };
  groups.forEach(function(group) { group.checks.forEach(function(check) { summary.total += 1; summary[check.status === 'fail' ? 'fail' : check.status === 'warn' ? 'warn' : 'ok'] += 1; }); });
  return summary;
}

module.exports = function createSystemHealthRoutes(deps) {
  const root = deps.root;
  const repoRoot = deps.repoRoot || path.join(__dirname, '..', '..');
  const reportDir = path.join(root, 'system-health');
  const latestPath = path.join(reportDir, 'latest.json');
  const dailyTime = parseDailyTime(process.env.SYSTEM_HEALTH_DAILY_TIME || '05:00');
  const dailyLabel = String(dailyTime.hour).padStart(2, '0') + ':' + String(dailyTime.minute).padStart(2, '0');
  const retention = Number(process.env.SYSTEM_HEALTH_RETENTION || 30);
  let timer = null;
  let running = null;

  function reportFiles() {
    try { return fs.readdirSync(reportDir).filter(function(name) { return /^report-.*\.json$/.test(name); }).sort().reverse(); }
    catch (e) { return []; }
  }

  async function runHealthCheck(trigger) {
    if (running) return running;
    running = (async function() {
      const started = Date.now();
      const styleRoot = path.join(repoRoot, 'apps', 'account-style-library');
      const styleLibraryDir = process.env.STYLE_LIBRARY_DIR || path.join(repoRoot, 'data', 'style-library');
      const groups = [
        { id: 'services', label: 'Services', checks: [
          await checkHttp('Main API 5555', 'http://127.0.0.1:' + (process.env.PORT || 5555) + '/api/health', 6000),
          await checkHttp('Next workbench 3100', process.env.STYLE_DEV_HEALTH_URL || 'http://127.0.0.1:3100/style-workbench/api/health', 10000)
        ] },
        { id: 'storage', label: 'Storage', checks: [
          checkPath('Runtime data root', root, 'dir', true),
          checkPath('Style library', styleLibraryDir, 'dir', true),
          checkPath('Next app', styleRoot, 'dir', true)
        ] },
        { id: 'dependencies', label: 'Dependencies', checks: [
          await checkCommand('Node.js', process.execPath, ['--version'], { timeoutMs: 5000 }),
          await checkCommand('Vite config', process.execPath, ['-e', 'require("fs").accessSync("vite.config.js"); console.log("vite config ok")'], { cwd: repoRoot, timeoutMs: 5000 }),
          await checkCommand('Account library typecheck', 'npm', ['run', 'typecheck'], { cwd: styleRoot, timeoutMs: Number(process.env.SYSTEM_HEALTH_TYPECHECK_TIMEOUT_MS || 180000), required: false })
        ] },
        { id: 'config', label: 'Config', checks: [
          { name: 'Chat model config', ok: Boolean(process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY), status: Boolean(process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY) ? 'ok' : 'warn', message: Boolean(process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY) ? 'model key detected' : 'model key not detected' },
          { name: 'Volcengine ASR config', ok: Boolean(process.env.VOLCENGINE_ASR_API_KEY || process.env.VOLCENGINE_API_KEY), status: Boolean(process.env.VOLCENGINE_ASR_API_KEY || process.env.VOLCENGINE_API_KEY) ? 'ok' : 'warn', message: Boolean(process.env.VOLCENGINE_ASR_API_KEY || process.env.VOLCENGINE_API_KEY) ? 'ASR key detected' : 'ASR key not detected' },
          { name: 'Feishu config', ok: Boolean(process.env.FEISHU_OPENCLI_AS || process.env.FEISHU_FOLDER_TOKEN), status: Boolean(process.env.FEISHU_OPENCLI_AS || process.env.FEISHU_FOLDER_TOKEN) ? 'ok' : 'warn', message: Boolean(process.env.FEISHU_OPENCLI_AS || process.env.FEISHU_FOLDER_TOKEN) ? 'Feishu config detected' : 'Feishu config not detected' }
        ] },
        { id: 'logs', label: 'Recent logs', checks: [
          scanLog('API error log', path.join(repoRoot, 'codex-api.err.log'), [/\berror\b/i, /exception/i, /failed/i, /timeout/i, /unhandled/i]),
          scanLog('Next supervisor log', path.join(repoRoot, 'codex-style.log'), [/restarting next/i, /health failed/i, /next exited/i]),
          scanLog('Next error log', path.join(repoRoot, 'codex-style.err.log'), [/\berror\b/i, /exception/i, /failed/i, /timeout/i, /unhandled/i])
        ] }
      ];
      const summary = summarize(groups);
      const report = {
        ok: summary.fail === 0,
        status: summary.fail ? 'fail' : (summary.warn ? 'warn' : 'ok'),
        trigger: trigger || 'manual',
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        schedule: { time: dailyLabel, timezone: 'Asia/Shanghai' },
        host: { hostname: os.hostname(), platform: os.platform(), uptimeSeconds: Math.round(os.uptime()) },
        summary,
        groups
      };
      writeJsonAtomic(latestPath, report);
      writeJsonAtomic(path.join(reportDir, 'report-' + dateKey(new Date()) + '-' + Date.now() + '.json'), report);
      reportFiles().slice(retention).forEach(function(name) { try { fs.unlinkSync(path.join(reportDir, name)); } catch (e) {} });
      return report;
    })().finally(function() { running = null; });
    return running;
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() {
      runHealthCheck('daily').catch(function() {}).finally(scheduleNext);
    }, nextDelayMs(dailyTime.hour, dailyTime.minute));
    if (timer.unref) timer.unref();
  }

  return {
    _startScheduler: scheduleNext,
    '/api/system-health/latest': function(body, cb) { cb({ ok: true, report: readJson(latestPath, null), schedule: { time: dailyLabel, timezone: 'Asia/Shanghai' } }); },
    '/api/system-health/run': function(body, cb) { runHealthCheck('manual').then(function(report) { cb({ ok: true, report }); }).catch(function(e) { cb({ ok: false, error: e.message || String(e) }); }); },
    '/api/system-health/history': function(body, cb) {
      const files = reportFiles().slice(0, Number(body.limit) || 30);
      cb({ ok: true, reports: files.map(function(name) {
        const report = readJson(path.join(reportDir, name), {});
        return { file: name, ok: report.ok, status: report.status, trigger: report.trigger, startedAt: report.startedAt, finishedAt: report.finishedAt, durationMs: report.durationMs, summary: report.summary };
      }) });
    }
  };
};
