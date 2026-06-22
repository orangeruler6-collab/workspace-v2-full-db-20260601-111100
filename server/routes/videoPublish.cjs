const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');
const {
  chromeProfileDirectoryMap,
  defaultVideoPublishBindings,
  publishAccountCatalog
} = require('../lib/accountCatalog.cjs');

const logger = createLogger('routes:videoPublish');
const profileLocks = new Map();
const chromeLaunchState = new Map();
const runningJobs = new Map();
const chromeProfileByOpenCli = chromeProfileDirectoryMap();
const defaultAccountBindings = defaultVideoPublishBindings();
const openCliExtensionDir = process.env.OPENCLI_EXTENSION_DIR
  || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');

function now() {
  return Math.floor(Date.now() / 1000);
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function stringify(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function cleanText(value, max) {
  const text = String(value || '').replace(/\r/g, '\n').trim();
  return max ? text.slice(0, max) : text;
}

function cleanCommerceProductText(value, commerce) {
  const text = cleanText(value, 80).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const preset = cleanText(commerce && commerce.preset, 40);
  const mode = cleanText(commerce && commerce.mode, 80);
  const productUrl = cleanText(commerce && commerce.productUrl, 1000);
  const chiselProduct = preset === 'chisel' || /chisel|凿子/.test(mode) || /3822421447960297861/.test(productUrl);
  if (!chiselProduct) return text;
  const preferred = '欧气凿子来辣';
  if (text.includes(preferred)) return preferred;
  const compact = text.replace(/\s+/g, '');
  for (let size = 1; size <= Math.floor(compact.length / 2); size += 1) {
    if (compact.length % size !== 0) continue;
    const chunk = compact.slice(0, size);
    if (chunk && chunk.repeat(compact.length / size) === compact) return chunk;
  }
  return text;
}

function videoSizeBytes(row, videoPath) {
  const recorded = Number(row && row.video_size) || 0;
  if (recorded > 0) return recorded;
  try {
    return fs.statSync(videoPath).size || 0;
  } catch (e) {
    return 0;
  }
}

function videoSizeExtraWaitLoops(row, videoPath) {
  const mb = videoSizeBytes(row, videoPath) / 1024 / 1024;
  if (mb <= 40) return 0;
  return Math.min(180, 24 + Math.ceil((mb - 40) / 10) * 12);
}

function videoUploadTimeoutMs(row, videoPath) {
  const mb = videoSizeBytes(row, videoPath) / 1024 / 1024;
  const extraMinutes = mb > 40 ? Math.ceil((mb - 40) / 10) * 2 : 0;
  return (10 + Math.min(25, extraMinutes)) * 60 * 1000;
}

function cleanTextChars(value, max) {
  const text = String(value || '').replace(/\r/g, '\n').trim();
  return max ? Array.from(text).slice(0, max).join('') : text;
}

function cleanOpenCliNoise(value) {
  return String(value || '')
    .replace(/\s*Update available:[^\n]*\n\s*Run:\s*npm install -g @jackwener\/opencli\s*/g, '')
    .replace(/\s*Extension update available:[^\n]*\n\s*Download:\s*https:\/\/github\.com\/jackwener\/opencli\/releases\s*/g, '')
    .trim();
}

function parseOpenCliJson(value) {
  const text = cleanOpenCliNoise(value);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const candidates = [];
    for (let i = text.length - 1; i >= 0; i -= 1) {
      if (text[i] === '{' || text[i] === '[') candidates.push(i);
    }
    for (const start of candidates) {
      const chunk = text.slice(start).trim();
      try { return JSON.parse(chunk); } catch (err) {}
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(lines[i]); } catch (err) {}
    }
    return null;
  }
}

function openCliErrorText(result, fallback) {
  const stderr = cleanOpenCliNoise(result && result.stderr);
  const stdout = cleanOpenCliNoise(result && result.stdout);
  if (/No current window/i.test(stdout + '\n' + stderr)) {
    return 'OpenCLI Profile 已连接，但没有可操作的 Chrome 当前窗口。请先把对应账号的 Chrome 窗口打开到前台后再试。';
  }
  if (/Semantic locator matched 0 elements|semantic_not_found|selector_not_found/i.test(stdout + '\n' + stderr)) {
    return '页面上没有找到对应控件，可能是页面未加载、按钮文案变化或弹窗挡住了。请确认平台页面状态后再试。';
  }
  if (stdout) {
    const match = stdout.match(/"message"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
    const code = stdout.match(/"code"\s*:\s*"([^"]+)"/);
    if (code) return code[1];
  }
  return cleanText(stderr || stdout || fallback || 'OpenCLI 鎵ц澶辫触', 1000);
}

function isBrowserCrashText(value) {
  return /Target closed|Execution context was destroyed|Cannot find context|browser has been closed|Browser connection dropped|Page crashed|crash|WebSocket.*closed|Protocol error|Session closed|No current window|chrome-error:\/\/|Aw,\s*Snap|STATUS_BREAKPOINT|STATUS_ACCESS_VIOLATION|RESULT_CODE_KILLED|页面崩溃|标签页已崩溃|无法访问此网站/i.test(String(value || ''));
}

function safeName(value, fallback) {
  const ext = path.extname(String(value || '')).toLowerCase();
  const base = path.basename(String(value || fallback || 'file'), ext)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'file';
  return base + (ext || '');
}

function safeFolder(value, fallback) {
  return String(value || fallback || 'default')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'default';
}

function decodeUrlPath(value) {
  try {
    return decodeURI(String(value || ''));
  } catch (e) {
    return String(value || '');
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function preparePlatformUploadVideo(root, row, videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) return { path: videoPath, cleanup: async function() {}, meta: {} };
  const probe = await probePlatformUploadVideo(root, videoPath);
  const needsH264 = /^(hevc|h265)$/i.test(String(probe.codec_name || ''));
  const rawName = safeName(row && (row.video_name || row.video_id), path.basename(videoPath));
  const originalName = needsH264 ? rawName.replace(/\.[^.]+$/, '') + '.mp4' : rawName;
  if (!needsH264 && path.basename(videoPath) === originalName && videoPath.length < 160) {
    return { path: videoPath, cleanup: async function() {}, meta: { codec: probe.codec_name || '', copied: false, transcoded: false } };
  }
  const uploadDir = path.join(root, 'temp', 'video-publish-opencli', String(row && row.id || Date.now()));
  ensureDir(uploadDir);
  const uploadPath = path.join(uploadDir, originalName);
  let meta = { codec: probe.codec_name || '', copied: false, transcoded: false };
  if (needsH264) {
    const result = await runProcess(ffmpegBin(root), [
      '-y',
      '-i', videoPath,
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-movflags', '+faststart',
      '-c:a', 'aac',
      '-b:a', '192k',
      uploadPath
    ], { timeoutMs: 10 * 60 * 1000, cwd: root });
    if (result.code !== 0 || !fs.existsSync(uploadPath)) {
      throw new Error('视频临时转 H.264 失败：' + cleanText(result.stderr || result.stdout || 'ffmpeg failed', 800));
    }
    meta.transcoded = true;
  } else {
    await fs.promises.copyFile(videoPath, uploadPath);
    meta.copied = true;
  }
  return {
    path: uploadPath,
    meta,
    cleanup: async function() {
      try { await fs.promises.unlink(uploadPath); } catch (e) {}
      try { await fs.promises.rmdir(uploadDir); } catch (e) {}
    }
  };
}

async function probePlatformUploadVideo(root, videoPath) {
  const result = await runProcess(ffprobeBin(root), [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt',
    '-of', 'json',
    videoPath
  ], { timeoutMs: 60000, cwd: root });
  if (result.code !== 0) return {};
  const parsed = safeJson(result.stdout, {});
  return parsed && parsed.streams && parsed.streams[0] || {};
}

function opencliBin() {
  if (process.env.OPENCLI_BIN) return process.env.OPENCLI_BIN;
  const npmDir = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm');
  const mainJs = path.join(npmDir, 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
  if (fs.existsSync(mainJs)) return mainJs;
  const ps1 = path.join(npmDir, 'opencli.ps1');
  if (fs.existsSync(ps1)) return ps1;
  return path.join(npmDir, 'opencli.cmd');
}

function chromeBin() {
  const candidates = [
    process.env.CHROME_BIN,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(item => fs.existsSync(item)) || candidates[0] || 'chrome.exe';
}

function chromeUserDataDir() {
  return process.env.CHROME_USER_DATA_DIR
    || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
}

function listChromeProfileDirectories() {
  const localState = path.join(chromeUserDataDir(), 'Local State');
  try {
    const state = JSON.parse(fs.readFileSync(localState, 'utf8'));
    const info = state && state.profile && state.profile.info_cache || {};
    return Object.keys(info).map(dir => ({
      dir,
      name: cleanText(info[dir] && info[dir].name, 120),
      shortcut_name: cleanText(info[dir] && info[dir].shortcut_name, 120),
      user_name: cleanText(info[dir] && info[dir].user_name, 120)
    }));
  } catch (e) {
    return [];
  }
}

function chromeProfileDirectory(accountId, profileAlias) {
  const envKey = 'VIDEO_PUBLISH_CHROME_PROFILE_' + String(accountId || profileAlias || '').replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  if (process.env[envKey]) return process.env[envKey];
  if (chromeProfileByOpenCli[accountId]) return chromeProfileByOpenCli[accountId];
  if (chromeProfileByOpenCli[profileAlias]) return chromeProfileByOpenCli[profileAlias];
  const wanted = cleanText(profileAlias, 120);
  if (!wanted) return '';
  const matched = listChromeProfileDirectories().find(item => (
    item.dir === wanted
    || item.name === wanted
    || item.shortcut_name === wanted
    || item.user_name === wanted
  ));
  return matched ? matched.dir : '';
}

function openCliProfileArgs(profileAlias) {
  const alias = cleanText(profileAlias, 120);
  return alias ? ['--profile', alias] : [];
}

function shellQuoteArg(value) {
  const text = String(value === undefined || value === null ? '' : value);
  if (!text) return '""';
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(text)) return text;
  return '"' + text.replace(/(["\\])/g, '\\$1') + '"';
}

function formatOpenCliCommand(args) {
  return 'opencli ' + (args || []).map(shellQuoteArg).join(' ');
}

function launchChromeProfile(profileDirectory, url) {
  return new Promise(resolve => {
    const bin = chromeBin();
    const userDataDir = chromeUserDataDir();
    const hasOpenCliExtension = fs.existsSync(path.join(openCliExtensionDir, 'manifest.json'));
    const args = [
      '--new-window',
      '--user-data-dir=' + userDataDir,
      '--no-first-run',
      '--no-default-browser-check'
    ];
    if (profileDirectory) args.push('--profile-directory=' + profileDirectory);
    if (hasOpenCliExtension) args.push('--load-extension=' + openCliExtensionDir);
    args.push(url || 'about:blank');
    let proc = null;
    try {
      proc = spawn(bin, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      proc.unref();
      resolve({ ok: true, bin, args, extension_dir: hasOpenCliExtension ? openCliExtensionDir : '' });
    } catch (err) {
      resolve({ ok: false, bin, args, error: err.message });
    }
  });
}

function killChromeProfile(profileDirectory) {
  return new Promise(resolve => {
    if (!profileDirectory) {
      resolve({ ok: false, error: 'missing profile directory' });
      return;
    }
    const escaped = String(profileDirectory).replace(/'/g, "''");
    const script = [
      "$needle='--profile-directory=" + escaped + "';",
      "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" |",
      "Where-Object { $_.CommandLine -like \"*$needle*\" } |",
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }"
    ].join(' ');
    let stdout = '';
    let stderr = '';
    const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true
    });
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', err => resolve({ ok: false, error: err.message, profile_directory: profileDirectory }));
    proc.on('close', code => {
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        profile_directory: profileDirectory
      });
    });
  });
}

async function closeProfileDirectory(profileDirectory, reason) {
  if (!profileDirectory) return { ok: false, error: 'missing profile directory', reason: reason || '' };
  for (const key of Array.from(chromeLaunchState.keys())) {
    if (String(key || '').startsWith(profileDirectory + ':')) chromeLaunchState.delete(key);
  }
  const killed = await killChromeProfile(profileDirectory);
  return Object.assign({ reason: reason || '' }, killed);
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runningJobState(jobId) {
  const id = Number(jobId || 0);
  if (!id) return null;
  if (!runningJobs.has(id)) runningJobs.set(id, { cancelled: false, procs: new Set() });
  return runningJobs.get(id);
}

function requestCancelRunningJob(jobId) {
  const state = runningJobs.get(Number(jobId || 0));
  if (!state) return false;
  state.cancelled = true;
  for (const proc of Array.from(state.procs || [])) {
    try { proc.kill(); } catch(e) {}
  }
  return true;
}

function isJobCancelled(jobId) {
  const state = runningJobs.get(Number(jobId || 0));
  return Boolean(state && state.cancelled);
}

async function ensureChromeProfileWindow(accountId, platformId, profileAlias, options) {
  options = options || {};
  const profileDirectory = chromeProfileDirectory(accountId, profileAlias);
  if (!profileDirectory) {
    return { ok: false, error: '鏈厤缃?Chrome Profile 鐩綍', profile_alias: profileAlias };
  }
  const connectedProfiles = await listOpenCliProfiles();
  if (!options.force && connectedProfiles.some(item => item.connected && (item.alias === profileAlias || item.context_id === profileAlias))) {
    return { ok: true, skipped: true, reason: 'profile already connected', profile_alias: profileAlias, profile_directory: profileDirectory };
  }
  const beforeIds = new Set((connectedProfiles || []).map(item => String(item && item.context_id || '').trim()).filter(Boolean));
  const key = profileDirectory + ':' + (platformId || '');
  const previous = chromeLaunchState.get(key) || 0;
  if (!options.force && Date.now() - previous < 10 * 60 * 1000) {
    return { ok: true, skipped: true, reason: 'recently launched', profile_alias: profileAlias, profile_directory: profileDirectory };
  }
  const launched = await launchChromeProfile(profileDirectory, options.url || 'about:blank');
  if (launched.ok) {
    chromeLaunchState.set(key, Date.now());
    const waitUntil = Date.now() + (Number(options.connectTimeoutMs) || 30000);
    while (Date.now() < waitUntil) {
      await waitMs(3000);
      const profiles = await listOpenCliProfiles();
      const aliased = profiles.find(item => item.connected && (item.alias === profileAlias || item.context_id === profileAlias));
      if (aliased) {
        launched.connected_profile = aliased.context_id || aliased.alias || profileAlias;
        break;
      }
      const newlyConnected = profiles.find(item => item.connected && item.context_id && !beforeIds.has(String(item.context_id).trim()));
      if (newlyConnected) {
        launched.connected_profile = newlyConnected.context_id || newlyConnected.alias || profileAlias;
        launched.detected_context_id = newlyConnected.context_id || '';
        break;
      }
    }
  }
  return Object.assign({
    profile_alias: profileAlias,
    profile_directory: profileDirectory
  }, launched);
}

function parseOpenCliProfiles(text) {
  let disconnected = false;
  return String(text || '').split(/\r?\n/).map(line => {
    const raw = String(line || '').trim();
    if (!raw || /^Update available:|^Run:|^Download:|^Extension update available:/i.test(raw)) return null;
    if (/No Browser Bridge profiles connected|Open a Chrome profile/i.test(raw)) return null;
    if (/Disconnected saved profiles/i.test(raw)) {
      disconnected = true;
      return null;
    }
    if (/Connected Browser Bridge profiles/i.test(raw)) {
      disconnected = false;
      return null;
    }
    const parts = raw.split(/\s+(?:\u2014|\u2013|-)\s+/);
    let left = '';
    let rest = '';
    if (parts.length >= 2) {
      left = parts[0].trim();
      rest = parts.slice(1).join(' - ').trim();
    } else {
      const match = raw.match(/^\s*(\S+)\s+(.*)$/);
      if (!match) return null;
      left = match[1];
      rest = match[2] || '';
    }
    const leftMatch = left.match(/^(\S+)(?:\s+(.*))?$/);
    if (!leftMatch) return null;
    const alias = (rest.match(/alias[:：]\s*([^\s]+)/i) || [])[1] || '';
    const connected = !disconnected && /connected/i.test(rest) && !/not connected/i.test(rest);
    return {
      context_id: leftMatch[1],
      alias: leftMatch[2] || alias || leftMatch[1],
      connected,
      raw
    };
  }).filter(Boolean);
}

function runOpenCli(args, options) {
  options = options || {};
  return new Promise(resolve => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let finished = false;
    let proc = null;
    try {
      const bin = opencliBin();
      const isJs = /\.js$/i.test(bin);
      const isCmd = /\.cmd$/i.test(bin) || /\.bat$/i.test(bin);
      const isPs1 = /\.ps1$/i.test(bin);
      const command = isJs ? process.execPath : (isCmd ? (process.env.ComSpec || 'cmd.exe') : (isPs1 ? 'powershell.exe' : bin));
      const commandArgs = isJs
        ? [bin].concat(args)
        : (isCmd
        ? ['/d', '/s', '/c', bin].concat(args)
        : (isPs1 ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bin].concat(args) : args));
      proc = spawn(command, commandArgs, {
        cwd: options.cwd || process.cwd(),
        windowsHide: true,
        env: Object.assign({}, process.env, options.env || {})
      });
      if (typeof options.onProcess === 'function') options.onProcess(proc);
    } catch (err) {
      resolve({ code: -1, stdout, stderr: err.message, duration_ms: Date.now() - started, args });
      return;
    }
    if (typeof options.cancelCheck === 'function' && options.cancelCheck()) {
      finished = true;
      try { proc.kill(); } catch(e) {}
      resolve({ code: -2, stdout, stderr: stderr + '\nCANCELLED', duration_ms: Date.now() - started, args });
      return;
    }
    const timeoutMs = options.timeoutMs || 15 * 60 * 1000;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { proc.kill(); } catch(e) {}
      resolve({ code: -1, stdout, stderr: stderr + '\nTIMEOUT', duration_ms: Date.now() - started, args });
    }, timeoutMs);
    const cancelTimer = typeof options.cancelCheck === 'function' ? setInterval(() => {
      if (finished || !options.cancelCheck()) return;
      finished = true;
      clearTimeout(timer);
      clearInterval(cancelTimer);
      try { proc.kill(); } catch(e) {}
      resolve({ code: -2, stdout, stderr: stderr + '\nCANCELLED', duration_ms: Date.now() - started, args });
    }, 1000) : null;
    if (cancelTimer && cancelTimer.unref) cancelTimer.unref();
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, duration_ms: Date.now() - started, args });
    });
    proc.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      resolve({ code: code || 0, stdout, stderr, duration_ms: Date.now() - started, args });
    });
  });
}

async function listOpenCliProfiles() {
  const result = await runOpenCli(['profile', 'list'], { timeoutMs: 20000 });
  return parseOpenCliProfiles(result.stdout);
}

async function resolveProfileAlias(alias) {
  const wanted = cleanText(alias, 120);
  if (!wanted) return '';
  const profiles = await listOpenCliProfiles();
  const found = profiles.find(item => item.connected && (item.alias === wanted || item.context_id === wanted));
  // `opencli profile list` can occasionally report no profiles while `opencli doctor`
  // still sees connected Browser Bridge contexts. If the job already has a stored
  // alias/context id, pass it through and let OpenCLI produce the real connectivity
  // error instead of surfacing a false "not bound" failure.
  return found ? (found.context_id || found.alias) : wanted;
}

function normalizeStatus(value) {
  const status = String(value || '').trim();
  if (['pending', 'ready', 'draft', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'].includes(status)) return status;
  return 'pending';
}

function statusFromPublishTime(value) {
  const publishTime = value && typeof value === 'object' ? value.publishTime : value;
  if (publishTime === 'draft') return 'draft';
  if (publishTime === 'schedule') return 'scheduled';
  if (publishTime === 'queue') return 'scheduled';
  return 'ready';
}

function scheduledAt(form) {
  if (!form || (form.publishTime !== 'schedule' && form.publishTime !== 'queue')) return 0;
  if (form.publishTime === 'queue' && form.queueImmediate) return now();
  const date = String(form.publishTime === 'queue' ? (form.queueDate || form.scheduleDate) : form.scheduleDate || '').trim();
  const time = String(form.publishTime === 'queue' ? (form.queueTime || form.scheduleTime) : form.scheduleTime || '').trim() || '00:00';
  if (!date) return 0;
  const ts = Date.parse(date + 'T' + time + ':00');
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

function normalizeRow(row) {
  return {
    id: row.id,
    batch_id: row.batch_id,
    user_name: row.user_name,
    account: {
      id: row.account_id,
      name: row.account_name
    },
    platform: {
      id: row.platform_id,
      name: row.platform_name,
      handle: row.platform_handle,
      profile: row.profile_alias || ''
    },
    video: {
      source: row.video_source,
      id: row.video_id,
      name: row.video_name,
      size: row.video_size,
      url: row.video_url
    },
    title: row.title,
    description: row.description,
    tags: safeJson(row.tags, []),
    cover_mode: row.cover_mode,
    visibility: row.visibility,
    publish_time: row.publish_time,
    scheduled_at: row.scheduled_at || 0,
    options: safeJson(row.options_json, {}),
    project_delivery: safeJson(row.options_json, {}).project_delivery || null,
    status: row.status,
    progress_stage: row.progress_stage || '',
    progress_detail: row.progress_detail || '',
    error: row.error || '',
    result_url: row.result_url || '',
    last_run_at: row.last_run_at || 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function platformUrl(platformId) {
  if (platformId === 'bilibili') return 'https://member.bilibili.com/platform/upload/video/frame';
  if (platformId === 'kuaishou') return 'https://cp.kuaishou.com/article/publish/video';
  if (platformId === 'xiaohongshu') return 'https://creator.xiaohongshu.com/publish/publish?target=video';
  if (platformId === 'wechatVideo') return 'https://channels.weixin.qq.com/platform/post/create';
  if (platformId === 'douyin') return 'https://creator.douyin.com/creator-micro/content/upload';
  return '';
}

function platformIdleUrl(platformId) {
  if (platformId === 'douyin') return 'https://creator.douyin.com/creator-micro/content/manage';
  return platformUrl(platformId) || 'https://www.douyin.com/';
}

function platformCapabilities(platformId) {
  if (platformId === 'douyin') return { native_draft: true, native_schedule: true, browser_draft: true, browser_publish: true, immediate_publish: true };
  if (platformId === 'bilibili') return { native_draft: false, native_schedule: false, browser_draft: true, browser_publish: true, immediate_publish: true };
  if (platformId === 'kuaishou') return { native_draft: false, native_schedule: false, browser_draft: true, browser_publish: true, immediate_publish: true };
  if (platformId === 'xiaohongshu') return { native_draft: false, native_schedule: false, browser_draft: true, browser_publish: true, immediate_publish: true };
  if (platformId === 'wechatVideo') return { native_draft: false, native_schedule: false, browser_draft: true, browser_publish: true, immediate_publish: true };
  return { native_draft: false, native_schedule: false, browser_draft: false, immediate_publish: false };
}

function formatSchedule(ts) {
  return new Date(ts * 1000).toISOString();
}

function tagsText(row) {
  return safeJson(row.tags, []).join(' ');
}

function captionFor(row) {
  return [row.description, tagsText(row)].filter(Boolean).join('\n').slice(0, 1000);
}

function douyinVisibility(value) {
  if (value === 'private') return 'private';
  if (value === 'fans' || value === 'friends') return 'friends';
  return 'public';
}

function resolveVideoPath(root, row) {
  const raw = String(row.video_url || '').trim();
  const decodedRaw = decodeUrlPath(raw);
  const candidates = [];
  if (raw) {
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) candidates.push(raw);
    if (raw.indexOf('/uploads/') === 0) candidates.push(path.join(root, 'public', raw.replace(/^\/+/, '')));
    if (raw.indexOf('uploads/') === 0) candidates.push(path.join(root, 'public', raw));
    if (decodedRaw && decodedRaw !== raw) {
      if (/^[a-zA-Z]:[\\/]/.test(decodedRaw) || decodedRaw.startsWith('\\\\')) candidates.push(decodedRaw);
      if (decodedRaw.indexOf('/uploads/') === 0) candidates.push(path.join(root, 'public', decodedRaw.replace(/^\/+/, '')));
      if (decodedRaw.indexOf('uploads/') === 0) candidates.push(path.join(root, 'public', decodedRaw));
    }
  }
  candidates.push(path.join(root, 'public', 'uploads', 'video', row.video_name || ''));
  candidates.push(path.join(root, 'public', 'uploads', 'video-publish', row.video_name || ''));
  for (const item of candidates) {
    if (item && fs.existsSync(item)) return path.resolve(item);
  }
  return '';
}

function resolveVideoUrlPath(root, url, filename) {
  return resolveVideoPath(root, {
    video_url: url || '',
    video_name: filename || ''
  });
}

function safeCacheFileName(id, filename) {
  const ext = path.extname(String(filename || '')).toLowerCase() || '.mp4';
  const base = path.basename(String(filename || 'material-' + id), ext)
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .slice(0, 80) || ('material-' + id);
  return 'material-' + id + '-' + base + ext;
}

function materialIdFromRemoteUrl(value) {
  const raw = String(value || '');
  const match = raw.match(/\/api\/materials\/remote-(?:preview|download)\/(\d+)/);
  return match ? match[1] : '';
}

function downloadUrlToFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp-' + Date.now();
    const file = fs.createWriteStream(tmpPath);
    const req = transport.get(target, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} });
        downloadUrlToFile(new URL(res.headers.location, target).toString(), filePath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        file.close(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} });
        reject(new Error('杩滅▼绱犳潗涓嬭浇澶辫触 HTTP ' + (res.statusCode || 0)));
        res.resume();
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(tmpPath, filePath);
            resolve(filePath);
          } catch(e) {
            reject(e);
          }
        });
      });
    });
    req.on('error', err => {
      file.close(() => { try { fs.unlinkSync(tmpPath); } catch(e) {} });
      reject(err);
    });
    req.setTimeout(15 * 60 * 1000, () => req.destroy(new Error('杩滅▼绱犳潗涓嬭浇瓒呮椂')));
  });
}

async function ensureRemoteMaterialVideoPath(root, row) {
  const id = materialIdFromRemoteUrl(row.video_url);
  if (!id) return '';
  const cacheDir = path.join(root, 'public', 'uploads', 'video-publish', 'remote-cache');
  const cachePath = path.join(cacheDir, safeCacheFileName(id, row.video_name || 'material-' + id + '.mp4'));
  if (fs.existsSync(cachePath)) return path.resolve(cachePath);
  if (!(process.env.INTERNAL_FILE_TOKEN || process.env.CONTENT_FILE_TOKEN)) {
    throw new Error('杩滅▼绱犳潗鏈嶅姟鏈厤缃?INTERNAL_FILE_TOKEN锛岀礌鏉愬簱杩滅▼瑙嗛鏃犳硶涓嬭浇锛涜鍏堥厤缃枃浠跺瓨鍌?token锛屾垨鏀圭敤鏈湴閫夋嫨瑙嗛涓婁紶');
  }
  const url = 'http://127.0.0.1:' + (process.env.PORT || process.env.API_PORT || 5555) + '/api/materials/remote-download/' + encodeURIComponent(id);
  await downloadUrlToFile(url, cachePath);
  return fs.existsSync(cachePath) ? path.resolve(cachePath) : '';
}

async function ensureVideoPath(root, row) {
  const local = resolveVideoPath(root, row);
  if (local) return local;
  return ensureRemoteMaterialVideoPath(root, row);
}

function runProcess(command, args, options) {
  options = options || {};
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let finished = false;
    let proc;
    try {
      proc = spawn(command, args, {
        cwd: options.cwd || process.cwd(),
        windowsHide: true,
        env: Object.assign({}, process.env, options.env || {})
      });
    } catch (e) {
      resolve({ code: -1, stdout, stderr: e.message });
      return;
    }
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { proc.kill(); } catch(e) {}
      resolve({ code: -1, stdout, stderr: stderr + '\nTIMEOUT' });
    }, options.timeoutMs || 180000);
    proc.stdout.on('data', chunk => { stdout += chunk.toString(); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString(); });
    proc.on('error', err => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message });
    });
    proc.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code: code || 0, stdout, stderr });
    });
  });
}

function ffmpegBin(root) {
  const bundled = path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  return fs.existsSync(bundled) ? bundled : 'ffmpeg';
}

function ffprobeBin(root) {
  const bundled = path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
  return fs.existsSync(bundled) ? bundled : 'ffprobe';
}

function transcribeAudioFile(audioPath) {
  const key = process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
  if (!key) return Promise.resolve({ error: 'SILICONFLOW_API_KEY is not configured' });
  let audioBuffer;
  try {
    audioBuffer = fs.readFileSync(audioPath);
  } catch (e) {
    return Promise.resolve({ error: 'audio file missing: ' + e.message });
  }
  const boundary = '----video-publish-' + Date.now();
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n' +
      'Content-Type: audio/mpeg\r\n\r\n', 'utf8'),
    audioBuffer,
    Buffer.from('\r\n--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="model"\r\n\r\n' +
      'FunAudioLLM/SenseVoiceSmall\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="language"\r\n\r\n' +
      'auto\r\n' +
      '--' + boundary + '--\r\n', 'utf8')
  ]);

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.siliconflow.cn',
      port: 443,
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': body.length,
        'Authorization': 'Bearer ' + key
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ error: 'transcribe HTTP ' + res.statusCode + ': ' + data.substring(0, 200) });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          resolve({ text: cleanText(parsed.text, 20000), raw: parsed });
        } catch (e) {
          resolve({ error: 'transcribe parse failed: ' + e.message });
        }
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(180000, () => {
      req.destroy(new Error('transcribe timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function transcribeVideoFile(root, videoPath) {
  if (!videoPath || !fs.existsSync(videoPath)) return { error: 'video file does not exist' };
  const audioPath = path.join(os.tmpdir(), 'video_publish_audio_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '.mp3');
  try {
    const result = await runProcess(ffmpegBin(root), [
      '-y',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-t', '240',
      '-f', 'mp3',
      audioPath
    ], { timeoutMs: 180000, cwd: root });
    if (result.code !== 0 || !fs.existsSync(audioPath)) {
      return { error: 'audio extraction failed: ' + cleanText(result.stderr || result.stdout || 'ffmpeg failed', 400) };
    }
    const transcribed = await transcribeAudioFile(audioPath);
    if (transcribed.error) return transcribed;
    return {
      ok: true,
      text: transcribed.text || '',
      source: 'local-video',
      duration_limit_seconds: 240
    };
  } finally {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch(e) {}
  }
}

function saveBase64Video(root, body) {
  const accountFolder = safeFolder(body.account_id || body.accountId || body.account_name || body.accountName || '', '');
  const urlPrefix = accountFolder
    ? '/uploads/video-publish/' + encodeURIComponent(accountFolder) + '/'
    : '/uploads/video-publish/';
  if (body._tempPath) {
    const originalTemp = String(body._tempPath || '');
    if (!fs.existsSync(originalTemp)) throw new Error('uploaded temp file missing');
    const original = cleanText(body.name || body._originalName || body.filename || 'video.mp4', 240);
    const ext = path.extname(original).toLowerCase() || '.mp4';
    if (!['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'].includes(ext)) {
      throw new Error('only video files are supported');
    }
    const dir = accountFolder
      ? path.join(root, 'public', 'uploads', 'video-publish', accountFolder)
      : path.join(root, 'public', 'uploads', 'video-publish');
    ensureDir(dir);
    const filename = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '_' + safeName(original, 'video' + ext);
    const filePath = path.join(dir, filename);
    fs.renameSync(originalTemp, filePath);
    let size = Number(body.size) || 0;
    try { size = fs.statSync(filePath).size || size; } catch(e) {}
    return {
      name: original,
      filename,
      size,
      source: 'local',
      url: urlPrefix + encodeURIComponent(filename),
      file_path: filePath
    };
  }
  const fileData = String(body.file_data || body.fileData || '');
  if (!fileData) throw new Error('missing file data');
  const original = cleanText(body.name || body.filename || 'video.mp4', 240);
  const ext = path.extname(original).toLowerCase() || '.mp4';
  if (!['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'].includes(ext)) {
    throw new Error('only video files are supported');
  }
  const base64 = fileData.includes(',') ? fileData.split(',').pop() : fileData;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('empty file');
  const dir = accountFolder
    ? path.join(root, 'public', 'uploads', 'video-publish', accountFolder)
    : path.join(root, 'public', 'uploads', 'video-publish');
  ensureDir(dir);
  const filename = Date.now() + '_' + crypto.randomBytes(4).toString('hex') + '_' + safeName(original, 'video' + ext);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return {
    name: original,
    filename,
    size: buffer.length,
    source: 'local',
    url: urlPrefix + encodeURIComponent(filename),
    file_path: filePath
  };
}

module.exports = function createVideoPublishRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'video_publish.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath, logger });
  function getDb() {
    return adapter.createDb();
  }

  const initDb = getDb();
  const initStatements = [
  `CREATE TABLE IF NOT EXISTS video_publish_jobs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id        TEXT    NOT NULL,
    user_name       TEXT    NOT NULL,
    account_id      TEXT    DEFAULT '',
    account_name    TEXT    DEFAULT '',
    platform_id     TEXT    NOT NULL,
    platform_name   TEXT    DEFAULT '',
    platform_handle TEXT    DEFAULT '',
    profile_alias   TEXT    DEFAULT '',
    video_source    TEXT    DEFAULT '',
    video_id        TEXT    DEFAULT '',
    video_name      TEXT    DEFAULT '',
    video_size      INTEGER DEFAULT 0,
    video_url       TEXT    DEFAULT '',
    title           TEXT    DEFAULT '',
    description     TEXT    DEFAULT '',
    tags            TEXT    DEFAULT '[]',
    cover_mode      TEXT    DEFAULT 'auto',
    visibility      TEXT    DEFAULT 'public',
    publish_time    TEXT    DEFAULT 'now',
    scheduled_at    INTEGER DEFAULT 0,
    options_json    TEXT    DEFAULT '{}',
    status          TEXT    DEFAULT 'pending',
    progress_stage  TEXT    DEFAULT '',
    progress_detail TEXT    DEFAULT '',
    error           TEXT    DEFAULT '',
    result_url      TEXT    DEFAULT '',
    last_run_at     INTEGER DEFAULT 0,
    created_at      INTEGER DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now'))
  )`,
  'ALTER TABLE video_publish_jobs ADD COLUMN profile_alias TEXT DEFAULT ""',
  'ALTER TABLE video_publish_jobs ADD COLUMN last_run_at INTEGER DEFAULT 0',
  'ALTER TABLE video_publish_jobs ADD COLUMN progress_stage TEXT DEFAULT ""',
  'ALTER TABLE video_publish_jobs ADD COLUMN progress_detail TEXT DEFAULT ""',
  `CREATE TABLE IF NOT EXISTS video_publish_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      TEXT    NOT NULL,
    account_name    TEXT    DEFAULT '',
    platform_id     TEXT    NOT NULL,
    platform_name   TEXT    DEFAULT '',
    platform_handle TEXT    DEFAULT '',
    profile_alias   TEXT    DEFAULT '',
    login_status    TEXT    DEFAULT 'unknown',
    last_checked_at INTEGER DEFAULT 0,
    capabilities    TEXT    DEFAULT '{}',
    created_at      INTEGER DEFAULT (strftime('%s','now')),
    updated_at      INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(account_id, platform_id)
  )`,
  `CREATE TABLE IF NOT EXISTS video_publish_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id          INTEGER DEFAULT 0,
    account_id      TEXT    DEFAULT '',
    platform_id     TEXT    DEFAULT '',
    profile_alias   TEXT    DEFAULT '',
    action          TEXT    DEFAULT '',
    status          TEXT    DEFAULT '',
    command_json    TEXT    DEFAULT '[]',
    stdout          TEXT    DEFAULT '',
    stderr          TEXT    DEFAULT '',
    error           TEXT    DEFAULT '',
    duration_ms     INTEGER DEFAULT 0,
    created_at      INTEGER DEFAULT (strftime('%s','now'))
  )`
  ];
  (function runInitStatement(index) {
    if (index >= initStatements.length) {
      seedDefaultAccountBindings(initDb, function() {
        initDb.close();
      });
      return;
    }
    initDb.run(initStatements[index], [], function() {
      runInitStatement(index + 1);
    });
  })(0);

  function seedDefaultAccountBindings(db, done) {
    if (!defaultAccountBindings.length) {
      done();
      return;
    }
    const ts = now();
    const sql = `INSERT INTO video_publish_accounts (
        account_id,account_name,platform_id,platform_name,platform_handle,profile_alias,login_status,last_checked_at,capabilities,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id, platform_id) DO UPDATE SET
        account_name=excluded.account_name,
        platform_name=excluded.platform_name,
        platform_handle=excluded.platform_handle,
        profile_alias=excluded.profile_alias,
        login_status=CASE
          WHEN video_publish_accounts.login_status IS NULL OR video_publish_accounts.login_status = 'unknown'
          THEN excluded.login_status
          ELSE video_publish_accounts.login_status
        END,
        capabilities=excluded.capabilities,
        updated_at=excluded.updated_at`;
    (function seedNext(index) {
      if (index >= defaultAccountBindings.length) {
        done();
        return;
      }
      const binding = defaultAccountBindings[index];
      const platformId = cleanText(binding.platform_id, 80);
      db.run(sql, [
        cleanText(binding.account_id, 80),
        cleanText(binding.account_name, 120),
        platformId,
        cleanText(binding.platform_name, 120),
        cleanText(binding.platform_handle, 200),
        cleanText(binding.profile_alias, 120),
        cleanText(binding.login_status || 'unknown', 40),
        Number(binding.last_checked_at || 0) || 0,
        stringify(platformCapabilities(platformId)),
        ts,
        ts
      ], function() {
        seedNext(index + 1);
      });
    })(0);
  }

  function logRun(payload, done) {
    const db = getDb();
    db.run(
      `INSERT INTO video_publish_logs (
        job_id,account_id,platform_id,profile_alias,action,status,command_json,stdout,stderr,error,duration_ms,created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        Number(payload.job_id) || 0,
        cleanText(payload.account_id, 80),
        cleanText(payload.platform_id, 80),
        cleanText(payload.profile_alias, 120),
        cleanText(payload.action, 80),
        cleanText(payload.status, 40),
        stringify(payload.command || []),
        cleanText(payload.stdout, 12000),
        cleanText(payload.stderr, 12000),
        cleanText(payload.error, 2000),
        Number(payload.duration_ms) || 0,
        now()
      ],
      function() {
        db.close();
        if (done) done();
      }
    );
  }

  function saveAccountBinding(input, auth, cb) {
    const accountId = cleanText(input.account_id || input.accountId, 80);
    const platformId = cleanText(input.platform_id || input.platformId, 80);
    if (!accountId || !platformId) { cb({ error: 'missing account/platform' }); return; }
    const profileAlias = cleanText(input.profile_alias || input.profileAlias, 120);
    if (!profileAlias) { cb({ error: 'missing profile alias' }); return; }
    const ts = now();
    const caps = platformCapabilities(platformId);
    const db = getDb();
    db.run(
      `INSERT INTO video_publish_accounts (
        account_id,account_name,platform_id,platform_name,platform_handle,profile_alias,login_status,last_checked_at,capabilities,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(account_id, platform_id) DO UPDATE SET
        account_name=excluded.account_name,
        platform_name=excluded.platform_name,
        platform_handle=excluded.platform_handle,
        profile_alias=excluded.profile_alias,
        capabilities=excluded.capabilities,
        updated_at=excluded.updated_at`,
      [
        accountId,
        cleanText(input.account_name || input.accountName, 120),
        platformId,
        cleanText(input.platform_name || input.platformName, 120),
        cleanText(input.platform_handle || input.platformHandle, 200),
        profileAlias,
        cleanText(input.login_status || input.loginStatus || 'unknown', 40),
        Number(input.last_checked_at || input.lastCheckedAt) || 0,
        stringify(caps),
        ts,
        ts
      ],
      function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, saved: true, capabilities: caps });
      }
    );
  }

  function getBinding(accountId, platformId) {
    return new Promise(resolve => {
      const db = getDb();
      db.get('SELECT * FROM video_publish_accounts WHERE account_id=? AND platform_id=?', [accountId || '', platformId || ''], function(err, row) {
        db.close();
        resolve(err ? null : row || null);
      });
    });
  }

  function updateJobStatus(id, status, error, resultUrl) {
    return new Promise(resolve => {
      const db = getDb();
      db.run(
        'UPDATE video_publish_jobs SET status=?, error=?, result_url=?, last_run_at=?, updated_at=? WHERE id=?',
        [normalizeStatus(status), cleanText(error, 1000), cleanText(resultUrl, 1000), now(), now(), id],
        function() {
          db.close();
          resolve();
        }
      );
    });
  }

  function updateJobProgress(id, stage, detail) {
    return new Promise(resolve => {
      if (!id) { resolve(); return; }
      const db = getDb();
      db.run(
        'UPDATE video_publish_jobs SET progress_stage=?, progress_detail=?, updated_at=? WHERE id=?',
        [cleanText(stage, 80), cleanText(detail, 240), now(), id],
        function() {
          db.close();
          resolve();
        }
      );
    });
  }

  function jobUserScope(auth, body) {
    const canSeeAll = auth && auth.role === 'admin' && body && body.mineOnly === false;
    return {
      sql: canSeeAll ? '' : ' AND user_name=?',
      args: canSeeAll ? [] : [auth && auth.username || '']
    };
  }

  function stageLabel(label, combined, data) {
    const text = String(label || '');
    const action = String(data && data.action || '');
    if (/open douyin upload|^open$/.test(text)) return '正在打开发布页';
    if (/wait page/.test(text)) return '正在等待发布页加载';
    if (/upload video/.test(text)) return '正在上传视频文件';
    if (/probe douyin commerce upload ready/.test(text)) return data && data.ok ? '视频上传完成，准备下一步' : '正在确认视频是否上传完成';
    if (/probe douyin recommended topic/.test(text)) return data && data.ok ? '已看到推荐话题区域' : '正在辅助确认发布页状态';
    if (/douyin commerce select cover/.test(text)) {
      if (data && data.ok) return '封面已设置完成';
      if (/open-horizontal-cover/.test(action)) return '正在打开横封面设置';
      if (/set-vertical-cover/.test(action)) return '正在设置竖封面';
      if (/generating/.test(action)) return '正在等待竖封面生成';
      if (/finish-cover/.test(action)) return '正在保存封面';
      return '正在选择封面';
    }
    if (/reset douyin commerce cover/.test(text)) return '封面弹窗可能卡住，正在关闭后重试';
    if (/wait douyin commerce cover/.test(text)) return '正在等待封面弹窗响应';
    if (/douyin commerce fillMain/.test(text)) return '正在填写标题、文案和话题';
    if (/douyin commerce openCartSelect/.test(text)) return '正在打开购物车标签选择';
    if (/wait cart dropdown|douyin commerce chooseCart/.test(text)) return '正在切换成购物车标签';
    if (/wait product link input|douyin commerce addProduct/.test(text)) return '正在打开商品链接入口';
    if (/wait product modal|probe douyin commerce product modal/.test(text)) return '正在等待商品链接弹窗';
    if (/douyin commerce completeProduct|completeProduct fallback|type product short title|finish product edit/.test(text)) return '正在填写商品文案';
    if (/wait product attached|douyin commerce verifyReady/.test(text)) return '正在确认商品已挂载并检查发布按钮';
    if (/douyin commerce click publish/.test(text)) return '正在点击最终发布';
    if (/douyin commerce confirm publish/.test(text)) return data && data.ok ? '发布已确认完成' : '正在确认发布结果';
    if (/recover douyin commerce publish stall/.test(text)) return '发布后仍停留页面，正在恢复检查';
    if (/retry douyin commerce final publish/.test(text)) return '正在重试最终发布';
    if (/retry douyin commerce cover/.test(text)) return '正在重试封面选择';
    if (/retry douyin commerce publish/.test(text)) return '正在重试发布';
    if (/restart douyin commerce attempt/.test(text)) return '正在从头重新上传重试';
    if (/wait .* upload ready/.test(text)) return '正在等待平台处理视频';
    if (/fill/.test(text)) return '正在填写发布表单';
    if (/click/.test(text)) return '正在点击平台按钮';
    return text || '正在执行发布任务';
  }

  function updateAccountLogin(accountId, platformId, status) {
    return new Promise(resolve => {
      const db = getDb();
      db.run(
        'UPDATE video_publish_accounts SET login_status=?, last_checked_at=?, updated_at=? WHERE account_id=? AND platform_id=?',
        [cleanText(status, 40), now(), now(), accountId || '', platformId || ''],
        function() {
          db.close();
          resolve();
        }
      );
    });
  }

  async function probeWechatVideoPage(prefix, session) {
    const script = `(() => { const host = document.querySelector('wujie-app'); const root = host && host.shadowRoot || document; const rawText = (document.body && document.body.innerText || ''); const buttons = Array.from(root.querySelectorAll('button')).map(btn => (btn.innerText || btn.textContent || btn.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 80); const inputs = Array.from(root.querySelectorAll('input[type=file]')); const videoInputs = inputs.filter(input => !input.accept || input.accept.includes('video')); const text = rawText.slice(0, 2000); return { url: location.href, title: document.title, text, buttons, fileInputs: videoInputs.length, allFileInputs: inputs.length, hasWujie: Boolean(host), hasShadow: Boolean(host && host.shadowRoot), hasLoginText: text.includes('鎵爜') || text.includes('鐧诲綍') || text.includes('璇蜂娇鐢ㄥ井淇?) || text.includes('浜岀淮鐮?), hasCreateShell: Boolean(host && host.shadowRoot) || text.includes('瑙嗛鍙?路 鍔╂墜') || text.includes('瑙嗛绠＄悊') || text.includes('鍙戣〃鍔ㄦ€?) || text.includes('瑙嗛鎻忚堪') || text.includes('鍙戣〃') || text.includes('鍙戝竷') }; })()`;
    const result = await runOpenCli(prefix.concat([
      'browser',
      session,
      'eval',
      script
    ]), { timeoutMs: 60000, cwd: root });
    const data = parseOpenCliJson(result.stdout) || {};
    return {
      ok: result.code === 0,
      result,
      data,
      ready: result.code === 0 && Number(data.fileInputs || 0) > 0,
      loggedIn: result.code === 0 && Boolean(data.hasCreateShell) && !data.hasLoginText,
      blocked: result.code === 0 && Boolean(data.hasCreateShell) && Number(data.fileInputs || 0) === 0
    };
  }

  async function exposeWechatVideoUpload(prefix, session) {
    const script = `(() => { const host = document.querySelector('wujie-app'); const root = host && host.shadowRoot; const target = root && (root.querySelector('input[type=file][accept*=video]') || root.querySelector('input[type=file]')); if (!target) return { ok: false, reason: 'shadow video file input not found', hasWujie: Boolean(host), hasShadow: Boolean(root) }; let proxy = document.querySelector('#opencliWechatVideoProxy'); if (proxy) proxy.remove(); proxy = document.createElement('input'); proxy.type = 'file'; proxy.id = 'opencliWechatVideoProxy'; proxy.accept = target.accept || 'video/mp4,video/x-m4v,video/*'; proxy.style.cssText = 'position:fixed;left:20px;top:20px;width:240px;height:80px;z-index:2147483647;opacity:1;display:block;visibility:visible;background:#fff;border:2px solid #07c160;'; document.body.appendChild(proxy); return { ok: true, accept: proxy.accept }; })()`;
    const result = await runOpenCli(prefix.concat(['browser', session, 'eval', script]), { timeoutMs: 60000, cwd: root });
    return { result, data: parseOpenCliJson(result.stdout) || {} };
  }

  async function commitWechatVideoUpload(prefix, session) {
    const script = `(() => { const proxy = document.querySelector('#opencliWechatVideoProxy'); const host = document.querySelector('wujie-app'); const root = host && host.shadowRoot; const target = root && (root.querySelector('input[type=file][accept*=video]') || root.querySelector('input[type=file]')); if (!proxy || !target || !proxy.files || !proxy.files.length) return { ok: false, reason: 'missing proxy/target/files', proxyFiles: proxy && proxy.files && proxy.files.length, target: Boolean(target) }; const dt = new DataTransfer(); Array.from(proxy.files).forEach(file => dt.items.add(file)); try { target.files = dt.files; } catch (e) { return { ok: false, reason: 'assign files failed: ' + e.message }; } target.dispatchEvent(new Event('input', { bubbles: true, composed: true })); target.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return { ok: true, files: target.files.length, name: target.files[0] && target.files[0].name }; })()`;
    const result = await runOpenCli(prefix.concat(['browser', session, 'eval', script]), { timeoutMs: 60000, cwd: root });
    return { result, data: parseOpenCliJson(result.stdout) || {} };
  }

  async function fillWechatVideoFields(prefix, session, row) {
    const title = JSON.stringify(cleanText(row.title || row.video_name, 60));
    const caption = JSON.stringify([cleanText(row.description, 1000), tagsText(row)].filter(Boolean).join('\\n'));
    const script = `(() => { const host = document.querySelector('wujie-app'); const root = host && host.shadowRoot; if (!root) return { ok: false, reason: 'shadow root not found' }; const title = ${title}; const caption = ${caption}; const setValue = (el, value) => { if (!el || !value) return false; el.focus && el.focus(); if ('value' in el) el.value = value; else el.innerText = value; el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); el.dispatchEvent(new Event('change', { bubbles: true, composed: true })); return true; }; const desc = Array.from(root.querySelectorAll('textarea,input,[contenteditable=true]')).find(el => /娣诲姞鎻忚堪|瑙嗛鎻忚堪/.test(el.placeholder || el.getAttribute('aria-label') || el.innerText || '')); const shortTitle = Array.from(root.querySelectorAll('input')).find(el => /姒傛嫭瑙嗛涓昏鍐呭|鐭爣棰?.test(el.placeholder || '')); return { ok: true, description: setValue(desc, caption), shortTitle: setValue(shortTitle, title), descFound: Boolean(desc), shortTitleFound: Boolean(shortTitle) }; })()`;
    const result = await runOpenCli(prefix.concat(['browser', session, 'eval', script]), { timeoutMs: 60000, cwd: root });
    return { result, data: parseOpenCliJson(result.stdout) || {} };
  }

  async function clickWechatVideoSubmit(prefix, session, publishTime) {
    const candidates = publishTime === 'draft'
      ? ['Save draft', 'Draft']
      : ['Publish', 'Submit', 'Confirm'];
    const script = `(function(){var host=document.querySelector('wujie-app');var root=host&&host.shadowRoot;if(!root)return {ok:false,reason:'shadow root not found'};var wanted=${JSON.stringify(candidates)};function visible(el){var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}var raw=Array.prototype.slice.call(root.querySelectorAll('button'));var items=[];for(var i=0;i<raw.length;i++){var b=raw[i];var text=(b.innerText||b.textContent||'').trim();var disabled=!!b.disabled||String(b.className||'').indexOf('disabled')>=0||b.getAttribute('aria-disabled')==='true';var r=b.getBoundingClientRect();items.push({el:b,index:i,text:text,disabled:disabled,visible:visible(b),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});}var target=null;for(var j=0;j<items.length&&!target;j++){var item=items[j];if(!item.visible||item.disabled)continue;for(var k=0;k<wanted.length;k++){if(item.text===wanted[k]||item.text.indexOf(wanted[k])>=0){target=item;break;}}}if(!target){var report=[];for(var n=0;n<items.length&&report.length<80;n++){if(items[n].text)report.push({index:items[n].index,text:items[n].text,disabled:items[n].disabled,visible:items[n].visible,x:items[n].x,y:items[n].y,w:items[n].w,h:items[n].h});}return {ok:false,reason:'submit button not found or disabled',wanted:wanted,buttons:report};}target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked:target.text,index:target.index};})()`;
    const result = await runOpenCli(prefix.concat(['browser', session, 'eval', script]), { timeoutMs: 60000, cwd: root });
    return { result, data: parseOpenCliJson(result.stdout) || {} };
  }

  async function confirmWechatVideoSubmit(prefix, session) {
    const candidates = ['Publish', 'Submit', 'Confirm', 'OK'];
    const script = `(function(){var host=document.querySelector('wujie-app');var root=host&&host.shadowRoot;if(!root)return {ok:false,reason:'shadow root not found'};var wanted=${JSON.stringify(candidates)};function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled/.test(String(el.className||'')));}var body=textOf(root);if(/鍙戣〃鎴愬姛|鍙戝竷鎴愬姛|宸插彂琛▅瀹℃牳涓瓅鎻愪氦鎴愬姛/.test(body))return {ok:true,alreadyDone:true,text:body.slice(-500)};var raw=Array.prototype.slice.call(root.querySelectorAll('button,[role=button]'));var items=raw.map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,text:textOf(el),cls:String(el.className||'').slice(0,100),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var visibleItems=items.filter(function(item){return item.visible&&!item.disabled&&item.text;});var target=null;for(var k=0;k<wanted.length&&!target;k++){target=visibleItems.filter(function(item){return item.text===wanted[k]||item.text.indexOf(wanted[k])>=0;}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0]||null;}if(!target)return {ok:false,reason:'confirm button not found',text:body.slice(-1000),buttons:items.filter(function(item){return item.text;}).slice(-100).map(function(item){return {index:item.index,text:item.text,cls:item.cls,disabled:item.disabled,visible:item.visible,x:item.x,y:item.y,w:item.w,h:item.h};})};target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked:target.text,index:target.index,x:target.x,y:target.y};})()`;
    const result = await runOpenCli(prefix.concat(['browser', session, 'eval', script]), { timeoutMs: 60000, cwd: root });
    return { result, data: parseOpenCliJson(result.stdout) || {} };
  }

  function wechatVideoProbeMessage(probe) {
    const data = probe && probe.data || {};
    if (data.hasLoginText) return 'Wechat video account needs login. Open the login page, finish login, then check again.';
    if (data.hasCreateShell && Number(data.fileInputs || 0) === 0) {
      const buttonHint = Array.isArray(data.buttons) && data.buttons.length ? 'Current buttons: ' + data.buttons.slice(0, 6).join(' / ') + '. ' : '';
      return buttonHint + 'Upload input is not visible. Check popups or account switching prompts, then retry.';
    }
    return openCliErrorText(probe && probe.result, 'Wechat video page is not ready. Open login page and check account state.');
  }

  async function runWithProfileLock(profileAlias, fn) {
    const key = profileAlias || '__default__';
    if (profileLocks.get(key)) throw new Error('该 OpenCLI Profile 正在执行另一个发布任务，请等待当前任务结束，或先取消正在运行的任务后再发布。');
    profileLocks.set(key, true);
    try {
      return await fn();
    } finally {
      profileLocks.delete(key);
    }
  }

  function isDouyinCommerceAccount(row, profileAlias) {
    const accountId = cleanText(row && row.account_id, 120);
    if (accountId.startsWith('nishuihan-') || accountId === 'youxia-bengbeng') return true;
    const accountText = [
      profileAlias,
      row && row.profile_alias,
      row && row.account_name,
      row && row.platform_handle
    ].filter(Boolean).join(' ');
    return /dvabrcmr|h4g7ab4y|b3uk5kjf|vpu8aysj|饭十七|游点慌|雷鸭|游侠蹦蹦/i.test(accountText);
  }

  function shouldRunDouyinCommerce(row, profileAlias, commerce) {
    if (!commerce) return false;
    if (commerce.enabled) return true;
    const productUrl = cleanText(commerce.productUrl, 1000);
    const productText = cleanCommerceProductText(commerce.productText, commerce);
    return Boolean(productUrl && productText && isDouyinCommerceAccount(row, profileAlias));
  }

  async function runDouyinJob(row, videoPath, profileAlias) {
    const options = safeJson(row.options_json, {});
    const commerce = options && options.raw && options.raw.commerce || {};
    if (shouldRunDouyinCommerce(row, profileAlias, commerce)) {
      return runDouyinCommerceJob(row, videoPath, profileAlias, {
        ...commerce,
        enabled: true,
        mode: commerce.mode || ('nishuihan-' + cleanText(commerce.preset || 'chisel', 40))
      });
    }
    if (row.publish_time === 'now') return runBrowserPublishJob(row, videoPath, profileAlias);
    const mode = row.publish_time === 'schedule' ? 'publish' : 'draft';
    if (mode === 'publish') {
      const min = now() + 2 * 60 * 60;
      const max = now() + 14 * 24 * 60 * 60;
      if (!row.scheduled_at || row.scheduled_at < min || row.scheduled_at > max) {
        throw new Error('鎶栭煶瀹氭椂鍙戝竷瑕佹眰鍙戝竷鏃堕棿鍦?2 灏忔椂鍒?14 澶╁悗');
      }
    }
    const args = [];
    args.push(...openCliProfileArgs(profileAlias));
    args.push('douyin', mode, videoPath, '--title', cleanText(row.title || row.video_name, 30), '--caption', captionFor(row), '--visibility', douyinVisibility(row.visibility), '-f', 'json');
    if (mode === 'publish') args.push('--schedule', formatSchedule(row.scheduled_at), '--allow_download', String(Boolean(safeJson(row.options_json, {}).allowDownload)));
    return runOpenCli(args, { timeoutMs: 30 * 60 * 1000, cwd: root });
  }

  function douyinCommerceTags(row, commerce) {
    const rawTags = cleanText(
      (commerce && (commerce.tagsRaw || commerce.rawTags || commerce.tagsText)) || '',
      500
    );
    const fallbackTags = safeJson(row.tags, [])
      .map(item => cleanText(item, 60))
      .filter(Boolean)
      .join(' ');
    return rawTags || fallbackTags;
  }

  function douyinCommerceCaption(row, commerce) {
    const tags = douyinCommerceTags(row, commerce);
    const description = cleanTextChars(cleanText(row.description, 800)
      .replace(/#[^\s#]+/g, '')
      .replace(/＃[^\s＃#]+/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(), 20);
    return [description, tags].filter(Boolean).join('\n');
  }

  function jsUriLiteral(value) {
    return 'decodeURIComponent(' + JSON.stringify(encodeURIComponent(String(value || ''))) + ')';
  }

  function douyinCommerceScript(row, commerce, stage) {
    const title = cleanText(row.title || row.video_name, 30);
    const mainCopy = cleanTextChars(cleanText(row.title || row.description || row.video_name, 200)
      .replace(/#[^\s#]+/g, '')
      .replace(/＃[^\s＃#]+/g, '')
      .trim(), 20);
    const tagsText = douyinCommerceTags(row, commerce);
    const caption = tagsText;
    const productUrl = cleanText(commerce && commerce.productUrl, 1000);
    const productText = cleanCommerceProductText(commerce && commerce.productText, commerce);
    return [
      '(function(){',
      'var stage=' + JSON.stringify(stage) + ';',
      'var title=' + jsUriLiteral(title) + ';',
      'var mainCopy=' + jsUriLiteral(mainCopy || title) + ';',
      'var tagsText=' + jsUriLiteral(tagsText) + ';',
      'var caption=' + jsUriLiteral(caption) + ';',
      'var productUrl=' + jsUriLiteral(productUrl) + ';',
      'var productText=' + jsUriLiteral(productText) + ';',
      'function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function disabled(el){return !!(el.disabled||el.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(el.className||"")))}',
      'function ctx(el){var a=[],p=el;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(textOf(p));return a.join(" | ").slice(0,700)}',
      'function items(selector,root){return Array.from((root||document).querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return{el:el,index:i,tag:el.tagName,text:textOf(el),ctx:ctx(el),cls:String(el.className||"").slice(0,180),placeholder:el.getAttribute&&el.getAttribute("placeholder")||"",type:el.getAttribute&&el.getAttribute("type")||"",disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'function inDialog(){return items("[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]").filter(function(item){return item.visible&&item.w>260&&item.h>160}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0]}',
      'function setInput(el,value){if(!el)return false;try{el.scrollIntoView({block:"center",inline:"center"})}catch(e){};el.focus&&el.focus();var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,"value");if(desc&&desc.set)desc.set.call(el,"");else el.value="";el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));el.dispatchEvent(new Event("change",{bubbles:true}));return true}',
      'function normText(value){return String(value||"").replace(/[\\u200b-\\u200f\\ufeff]/g,"").trim().replace(/\\s+/g," ")}',
      'function setEditable(el,value){if(!el)return false;try{el.scrollIntoView({block:"center",inline:"center"})}catch(e){};el.focus&&el.focus();try{var sel=window.getSelection&&window.getSelection();if(sel){var range=document.createRange();range.selectNodeContents(el);sel.removeAllRanges();sel.addRange(range)}}catch(e){}try{document.execCommand&&document.execCommand("delete",false,null);document.execCommand&&document.execCommand("insertText",false,value)}catch(e){}if(normText(textOf(el))!==normText(value)){el.textContent="";el.appendChild(document.createTextNode(value))}el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));el.dispatchEvent(new Event("change",{bubbles:true}));return normText(textOf(el))===normText(value)}',
      'function fire(item){if(!item)return null;try{item.el.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=item.el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||item.el;["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{item.el.click()}catch(e){}return{text:item.text,ctx:item.ctx,placeholder:item.placeholder,x:Math.round(x),y:Math.round(y),w:item.w,h:item.h,hit:textOf(hit)}}',
      'function buttonPool(root){return items("button,[role=button],a,div,span,.semi-select,[class*=semi-select],[class*=semi-select-option]",root).filter(function(item){return item.visible&&!item.disabled&&item.w>=18&&item.h>=14&&item.w<=520&&item.h<=220})}',
      'function focusTagRow(){function rowFor(el){var p=el;for(var i=0;i<10&&p;i++,p=p.parentElement){var r=p.getBoundingClientRect(),t=textOf(p);if(r.width>180&&r.width<900&&r.height>22&&r.height<220&&/\u6dfb\u52a0\u6807\u7b7e/.test(t)&&/(\u4f4d\u7f6e|\u8f93\u5165\u5730\u7406\u4f4d\u7f6e|\u6e38\u620f\u624b\u67c4|\u8d2d\u7269\u8f66|\u6dfb\u52a0\u4f5c\u54c1\u540c\u6b3e\u6e38\u620f)/.test(t))return p}return null}var labels=items("div,section,label,span").filter(function(item){return /\u6dfb\u52a0\u6807\u7b7e/.test(item.text)&&/(\u4f4d\u7f6e|\u8f93\u5165\u5730\u7406\u4f4d\u7f6e|\u6e38\u620f\u624b\u67c4|\u8d2d\u7269\u8f66|\u6dfb\u52a0\u4f5c\u54c1\u540c\u6b3e\u6e38\u620f)/.test(item.ctx+" "+item.text)});var rows=[];labels.forEach(function(item){var row=rowFor(item.el)||item.el;if(rows.indexOf(row)<0)rows.push(row)});var row=rows.sort(function(a,b){var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return(ar.width*ar.height)-(br.width*br.height)||ar.y-br.y})[0];if(row){for(var i=0;i<4;i++){try{row.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=row.getBoundingClientRect();if(r.top>=80&&r.bottom<=innerHeight-80)break;if(r.top<80)window.scrollBy(0,r.top-160);else if(r.bottom>innerHeight-80)window.scrollBy(0,r.bottom-innerHeight+160)}var rr=row.getBoundingClientRect();return{ok:true,text:textOf(row),x:Math.round(rr.x),y:Math.round(rr.y),w:Math.round(rr.width),h:Math.round(rr.height)}}return{ok:false}}',
      'function pickButton(pattern,root){return buttonPool(root).filter(function(item){return pattern.test(item.text+" "+item.ctx+" "+item.cls)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||b.y-a.y||b.x-a.x})[0]}',
      'function exactButton(text,root){return buttonPool(root).filter(function(item){return item.text===text}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x})[0]}',
      'var body=(document.body&&document.body.innerText||"").replace(/\\s+/g," ");',
      'if(stage==="fillMain"){var titleInput=items("input").filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u586b\\u5199\\u4f5c\\u54c1\\u6807\\u9898|\\u4f5c\\u54c1\\u6807\\u9898/.test(item.placeholder+" "+item.text)||item.placeholder==="\\u586b\\u5199\\u4f5c\\u54c1\\u6807\\u9898\\uff0c\\u4e3a\\u4f5c\\u54c1\\u83b7\\u5f97\\u66f4\\u591a\\u6d41\\u91cf")})[0];var editors=items("[contenteditable=true],textarea").filter(function(item){return item.visible&&!item.disabled&&item.w>220&&item.h>36});var editor=(editors.find(function(item){return /\\u4f5c\\u54c1\\u63cf\\u8ff0|#\\u6dfb\\u52a0\\u8bdd\\u9898|@\\u597d\\u53cb/.test(item.ctx)})||editors[0]||{}).el;var okTitle=titleInput?setInput(titleInput.el,mainCopy||title):true;var okCaption=tagsText?setEditable(editor,tagsText):true;return{ok:okTitle&&okCaption,title:okTitle,caption:okCaption,titleValue:titleInput&&titleInput.el.value||"",captionValue:editor&&textOf(editor)||"",mainCopy:mainCopy,tagsText:tagsText,editorCount:editors.length,url:location.href,tail:body.slice(-700)}}',
      'if(stage==="openCartSelect"){var focusedRow=focusTagRow();function fireEl(el,ratio){if(!el)return null;try{el.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=el.getBoundingClientRect(),x=r.x+r.width*(ratio||0.5),y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||el;["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click()}catch(e){}try{el.click()}catch(e){}return{text:textOf(el),ctx:ctx(el),x:Math.round(x),y:Math.round(y),hit:textOf(hit)}}function box(el){var r=el.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}function rowFor(el){var p=el;for(var i=0;i<8&&p;i++,p=p.parentElement){var r=p.getBoundingClientRect(),t=textOf(p);if(r.width>180&&r.width<760&&r.height>24&&r.height<170&&/\\u6dfb\\u52a0\\u6807\\u7b7e/.test(t)&&/(\\u4f4d\\u7f6e|\\u8f93\\u5165\\u5730\\u7406\\u4f4d\\u7f6e|\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f|\\u8d2d\\u7269\\u8f66)/.test(t))return p}return null}function rank(item){var text=item.text+" "+item.ctx+" "+String(item.el&&item.el.className||"");var select=/semi-select|combobox/i.test(String(item.el&&item.el.className||"")+" "+(item.el&&item.el.getAttribute&&item.el.getAttribute("role")||""))?0:2;var kind=/\\u8d2d\\u7269\\u8f66/.test(text)?0:/\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f/.test(text)?1:/\\u4f4d\\u7f6e|\\u8f93\\u5165\\u5730\\u7406\\u4f4d\\u7f6e/.test(text)?3:4;return kind+select}var labels=items("div,span,label").filter(function(item){return item.visible&&item.text==="\\u6dfb\\u52a0\\u6807\\u7b7e"});var candidates=[];labels.forEach(function(label){var row=rowFor(label.el);if(row){Array.from(row.querySelectorAll("[class*=semi-select],[role=combobox],button,[role=button],div,span")).forEach(function(el){var t=textOf(el),r=el.getBoundingClientRect();if(visible(el)&&!disabled(el)&&r.width>=30&&r.height>=16&&r.width<=260&&r.height<=90&&/(\\u4f4d\\u7f6e|\\u8f93\\u5165\\u5730\\u7406\\u4f4d\\u7f6e|\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f|\\u8d2d\\u7269\\u8f66)/.test(t+" "+String(el.className||"")))candidates.push({el:el,text:t,ctx:ctx(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)})})}});var pool=buttonPool();var target=candidates.sort(function(a,b){return rank(a)-rank(b)||(b.w*b.h)-(a.w*a.h)||a.y-b.y})[0]||pool.filter(function(item){return /^(\\u8d2d\\u7269\\u8f66|\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f|\\u4f4d\\u7f6e)$/.test(item.text)&&/\\u6269\\u5c55\\u4fe1\\u606f|\\u6dfb\\u52a0\\u6807\\u7b7e/.test(item.ctx)}).sort(function(a,b){var ak=/\\u8d2d\\u7269\\u8f66/.test(a.text)?0:/\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f/.test(a.text)?1:3,bk=/\\u8d2d\\u7269\\u8f66/.test(b.text)?0:/\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f/.test(b.text)?1:3;return ak-bk||(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x})[0];var clicked=target&&fireEl(target.el,/\\u4f4d\\u7f6e|\\u8f93\\u5165\\u5730\\u7406\\u4f4d\\u7f6e/.test(target.text+" "+target.ctx)?0.86:0.5);return{ok:!!clicked,clicked:clicked&&clicked.text,hit:clicked&&clicked.hit,candidates:candidates.slice(0,12).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h,box:box(item.el)}}),options:pool.filter(function(item){return /\\u6269\\u5c55\\u4fe1\\u606f|\\u6dfb\\u52a0\\u6807\\u7b7e|\\u4f4d\\u7f6e|\\u8f93\\u5165\\u5730\\u7406\\u4f4d\\u7f6e|\\u8d2d\\u7269\\u8f66|\\u6e38\\u620f\\u624b\\u67c4|\\u6dfb\\u52a0\\u4f5c\\u54c1\\u540c\\u6b3e\\u6e38\\u620f/.test(item.text+" "+item.ctx)}).slice(0,30).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}})}}',
      'if(stage==="chooseCart"){focusTagRow();function itemExact(item,text){return item.text===text}var opts=buttonPool().filter(function(item){return /\\u8d2d\\u7269\\u8f66/.test(item.text+" "+item.ctx)&&!/\\u5df2\\u6dfb\\u52a0/.test(item.text)}).sort(function(a,b){var ae=itemExact(a,"\\u8d2d\\u7269\\u8f66")?0:1,be=itemExact(b,"\\u8d2d\\u7269\\u8f66")?0:1;return ae-be||(a.w*a.h)-(b.w*b.h)||a.y-b.y});var target=opts[0];return{ok:!!fire(target),clicked:target&&target.text,options:opts.slice(0,24).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),tail:body.slice(-900)}}',
      'if(stage==="addProduct"){var dialog=inDialog();var root=dialog&&dialog.el||document;var fields=items("input,textarea",root).filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(item.placeholder+" "+item.text+" "+item.ctx)||item.w>260&&item.h>=24)}).sort(function(a,b){var as=/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(a.placeholder+" "+a.text+" "+a.ctx)?0:1;var bs=/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(b.placeholder+" "+b.text+" "+b.ctx)?0:1;return as-bs||b.w-a.w||a.y-b.y});var input=fields[0];var buttons=buttonPool(root).filter(function(item){return /\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1|\\u786e\\u8ba4\\u6dfb\\u52a0|^\\u6dfb\\u52a0$|^\\u786e\\u5b9a$|^\\u786e\\u8ba4$/.test(item.text)});if(!input){var opener=buttons.filter(function(item){return /\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1/.test(item.text+" "+item.ctx)}).sort(function(a,b){var ae=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1/.test(a.text)?0:1,be=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1/.test(b.text)?0:1;return ae-be||(a.w*a.h)-(b.w*b.h)||a.y-b.y})[0]||buttons[0];var opened=fire(opener);return{ok:false,opened:!!opened,input:false,clicked:opened&&opened.text,buttons:buttons.slice(0,12).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),fields:fields.slice(0,8).map(function(item){return{text:item.text,placeholder:item.placeholder,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}})}}var okInput=setInput(input.el,productUrl);var add=(input&&buttons.filter(function(item){return item.y>=input.y-18&&item.y<=input.y+input.h+24&&item.x>input.x+input.w-30}).sort(function(a,b){return a.x-b.x||a.y-b.y})[0])||buttons.sort(function(a,b){var ae=/\\u6dfb\\u52a0\\u94fe\\u63a5/.test(a.text)?0:1,be=/\\u6dfb\\u52a0\\u94fe\\u63a5/.test(b.text)?0:1;return ae-be||(a.w*a.h)-(b.w*b.h)||b.y-a.y})[0];var clicked=fire(add);return{ok:okInput&&!!add,input:okInput,clicked:clicked&&clicked.text,placeholder:input&&input.placeholder,buttons:buttons.slice(0,12).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),fields:fields.slice(0,8).map(function(item){return{text:item.text,placeholder:item.placeholder,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}})}}',
      'if(stage==="completeProduct"){var productEditorPattern=/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u5546\\u54c1\\u539f\\u6807\\u9898|\\u5b8c\\u6210\\u7f16\\u8f91|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/;var linkEntryPattern=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|https?:\\/\\//;if(/\\u5df2\\u6dfb\\u52a0\\u5546\\u54c1/.test(body))return{ok:true,alreadyAttached:true,tail:body.slice(-700)};var dialog=inDialog();if(!dialog&&!productEditorPattern.test(body))return{ok:false,waitingProductModal:true,linkEntryVisible:linkEntryPattern.test(body),tail:body.slice(-900)};var root=dialog&&dialog.el||document;function forceTypeShortTitle(){var nodes=items("input,textarea,[contenteditable=true],div",root).filter(function(item){return item.visible&&!item.disabled&&item.w>=80&&item.h>=18&&item.w<=420&&item.h<=80});var byCtx=nodes.filter(function(item){return /\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/.test(item.ctx+" "+item.placeholder+" "+item.text)&&!/\\u5b8c\\u6210\\u7f16\\u8f91|\\u53d6\\u6d88/.test(item.text)}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];var input=byCtx&&byCtx.el;if(input&&/INPUT|TEXTAREA/.test(input.tagName))return setInput(input,productText);if(input&&input.getAttribute&&input.getAttribute("contenteditable")==="true")return setEditable(input,productText);if(input){try{input.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=input.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;var hit=document.elementFromPoint(x,y)||input;hit.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}));try{document.execCommand&&document.execCommand("insertText",false,productText)}catch(e){}return true}return false}var fields=items("input,textarea,[contenteditable=true]",root).filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u77ed\\u6807\\u9898|\\u5546\\u54c1\\u6587\\u6848|\\u6587\\u6848|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/.test(item.placeholder+" "+item.text+" "+item.ctx)||item.w>120&&item.h>=20)}).sort(function(a,b){var as=/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/.test(a.placeholder+" "+a.text+" "+a.ctx)?0:1;var bs=/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/.test(b.placeholder+" "+b.text+" "+b.ctx)?0:1;return as-bs||a.y-b.y});var input=fields[0];var okShort=input?(/INPUT|TEXTAREA/.test(input.el.tagName)?setInput(input.el,productText):setEditable(input.el,productText)):forceTypeShortTitle();var done=buttonPool(root).filter(function(item){return /^(\\u5b8c\\u6210\\u7f16\\u8f91|\\u5b8c\\u6210|\\u786e\\u8ba4|\\u786e\\u5b9a|\\u4fdd\\u5b58)$/.test(item.text)}).sort(function(a,b){var ae=a.text==="\\u5b8c\\u6210\\u7f16\\u8f91"?0:1,be=b.text==="\\u5b8c\\u6210\\u7f16\\u8f91"?0:1;return ae-be||b.y-a.y||b.x-a.x})[0];var clicked=fire(done);return{ok:okShort&&!!done,shortTitle:okShort,clicked:clicked&&clicked.text,placeholder:input&&input.placeholder,fields:fields.slice(0,8).map(function(item){return{text:item.text,placeholder:item.placeholder,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),buttons:buttonPool(root).filter(function(item){return /\\u5b8c\\u6210|\\u786e\\u5b9a|\\u53d6\\u6d88|\\u7f16\\u8f91/.test(item.text)}).slice(0,12).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),tail:body.slice(-700)}}',
      'if(stage==="verifyReady"){var publish=buttonPool().filter(function(item){return item.text==="\\u53d1\\u5e03"&&item.w>=40&&item.w<=220&&item.h>=20&&item.h<=90}).sort(function(a,b){return b.y-a.y||b.x-a.x})[0];var productReady=/\\u5df2\\u6dfb\\u52a0\\u5546\\u54c1/.test(body);return{ok:productReady&&!!publish,commerce_ready:productReady,needs_confirm:true,final_publish_visible:!!publish,productText:productText,title:title,caption:caption.slice(0,200),tail:body.slice(-900),publishButton:publish&&{text:publish.text,ctx:publish.ctx,x:publish.x,y:publish.y,w:publish.w,h:publish.h}}}',
      'return{ok:false,reason:"unknown stage "+stage,tail:body.slice(-700)}',
      '})()'
    ].join('');
  }

  function douyinCommerceScriptSafe(row, commerce, stage) {
    const title = cleanText(row.title || row.video_name, 30);
    const caption = douyinCommerceCaption(row, commerce);
    const productUrl = cleanText(commerce && commerce.productUrl, 1000);
    const productText = cleanCommerceProductText(commerce && commerce.productText, commerce);
    return [
      '(function(){',
      'var stage=' + JSON.stringify(stage) + ';',
      'var title=' + jsUriLiteral(title) + ';',
      'var caption=' + jsUriLiteral(caption) + ';',
      'var productUrl=' + jsUriLiteral(productUrl) + ';',
      'var productText=' + jsUriLiteral(productText) + ';',
      'function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function disabled(el){return !!(el.disabled||el.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(el.className||"")))}',
      'function setInput(el,value){if(!el)return false;el.focus&&el.focus();var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,"value");if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));el.dispatchEvent(new Event("change",{bubbles:true}));return true}',
      'function setEditable(el,value){if(!el)return false;el.focus&&el.focus();try{document.execCommand&&document.execCommand("selectAll",false,null);document.execCommand&&document.execCommand("insertText",false,value)}catch(e){}if(textOf(el)!==value){el.textContent="";el.appendChild(document.createTextNode(value))}el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));el.dispatchEvent(new Event("change",{bubbles:true}));return true}',
      'function items(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return{el:el,index:i,text:textOf(el),cls:String(el.className||"").slice(0,180),placeholder:el.getAttribute&&el.getAttribute("placeholder")||"",type:el.getAttribute&&el.getAttribute("type")||"",disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'function clickItem(item){if(!item)return null;item.el.scrollIntoView({block:"center",inline:"center"});item.el.click();return{text:item.text,placeholder:item.placeholder,x:item.x,y:item.y,w:item.w,h:item.h}}',
      'function pick(list){return list.filter(function(item){return item.visible&&!item.disabled}).sort(function(a,b){return b.y-a.y||b.x-a.x})[0]}',
      'var body=(document.body&&document.body.innerText||"").replace(/\\s+/g," ");',
      'if(stage==="fillMain"){var titleInput=items("input").filter(function(item){return item.visible&&item.type!=="file"&&(/\\u4f5c\\u54c1\\u6807\\u9898|\\u586b\\u5199\\u4f5c\\u54c1\\u6807\\u9898|\\u6807\\u9898/.test(item.placeholder+" "+item.text)||item.y<360&&item.w>160&&item.w<900)})[0];var editors=items("[contenteditable=true],textarea").filter(function(item){return item.visible&&item.w>200&&item.h>36});var editor=(editors.find(function(item){return /\\u4f5c\\u54c1\\u63cf\\u8ff0|\\u63cf\\u8ff0/.test(item.placeholder+" "+item.text)})||editors[0]||{}).el;var okTitle=setInput(titleInput&&titleInput.el,title);var okCaption=setEditable(editor,caption);return{ok:okTitle&&okCaption,title:okTitle,caption:okCaption,titleValue:titleInput&&titleInput.el.value||"",captionValue:editor&&textOf(editor)||"",editorCount:editors.length,url:location.href,tail:body.slice(-600)}}',
      'if(stage==="openCartSelect"){var opts=items("button,[role=button],div,span,.semi-select,[class*=semi-select],[role=combobox]").filter(function(item){return item.visible&&!item.disabled&&/\\u6dfb\\u52a0\\u6807\\u7b7e|\\u4f4d\\u7f6e|\\u8d2d\\u7269\\u8f66|\\u6807\\u7b7e/.test(item.text+" "+item.cls)});var target=opts.find(function(item){return /\\u6dfb\\u52a0\\u6807\\u7b7e|\\u4f4d\\u7f6e/.test(item.text)})||opts[0];return{ok:!!clickItem(target),clicked:target&&target.text,options:opts.slice(0,12).map(function(i){return{text:i.text,x:i.x,y:i.y,w:i.w,h:i.h}})}}',
      'if(stage==="chooseCart"){var opts=items("button,[role=button],div,span,[class*=semi-select-option]").filter(function(item){return item.visible&&!item.disabled&&/\\u8d2d\\u7269\\u8f66/.test(item.text)});var target=opts[0];return{ok:!!clickItem(target),clicked:target&&target.text,options:opts.slice(0,12).map(function(i){return{text:i.text,x:i.x,y:i.y,w:i.w,h:i.h}})}}',
      'if(stage==="addProduct"){var fields=items("input,textarea").filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/i.test(item.placeholder+" "+item.text)||item.w>260&&item.h>=24)});var input=fields[0];var buttons=items("button,[role=button],a,div,span").filter(function(item){return item.visible&&!item.disabled&&/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1|\\u786e\\u8ba4|\\u786e\\u5b9a|\\u6dfb\\u52a0/.test(item.text)});if(!input){var opener=buttons[0];var opened=clickItem(opener);return{ok:false,opened:!!opened,input:false,clicked:opener&&opener.text,fields:fields.slice(0,8).map(function(i){return{text:i.text,placeholder:i.placeholder,x:i.x,y:i.y,w:i.w,h:i.h}}),buttons:buttons.slice(0,8).map(function(i){return{text:i.text,x:i.x,y:i.y,w:i.w,h:i.h}})}}var okInput=setInput(input.el,productUrl);var add=buttons[0];clickItem(add);return{ok:okInput&&!!add,input:okInput,clicked:add&&add.text,placeholder:input&&input.placeholder,fields:fields.slice(0,8).map(function(i){return{text:i.text,placeholder:i.placeholder,x:i.x,y:i.y,w:i.w,h:i.h}})}}',
      'if(stage==="completeProduct"){if(!/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u5546\\u54c1\\u539f\\u6807\\u9898|\\u5b8c\\u6210\\u7f16\\u8f91|\\u6700\\u591a\\u8f93\\u516510\\u4e2a\\u6c49\\u5b57/.test(body))return{ok:false,waitingProductModal:true,tail:body.slice(-800)};var fields=items("input,textarea").filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u77ed\\u6807\\u9898|\\u6587\\u6848/.test(item.placeholder+" "+item.text)||item.w>180&&item.h>=24)});var input=fields[0];var okShort=setInput(input&&input.el,productText);var buttons=items("button,[role=button],a,div,span").filter(function(item){return item.visible&&!item.disabled&&/\\u5b8c\\u6210\\u7f16\\u8f91|\\u5b8c\\u6210|\\u786e\\u8ba4|\\u786e\\u5b9a/.test(item.text)});var done=buttons[0];clickItem(done);return{ok:okShort&&!!done,shortTitle:okShort,clicked:done&&done.text,placeholder:input&&input.placeholder}}',
      'if(stage==="verifyReady"){var publish=items("button,[role=button],div,span").filter(function(item){return item.visible&&!item.disabled&&item.text==="\\u53d1\\u5e03"&&item.w>=40&&item.w<=200&&item.h>=20&&item.h<=80}).sort(function(a,b){return b.y-a.y||b.x-a.x})[0];var productReady=/\\u5df2\\u6dfb\\u52a0\\u5546\\u54c1/.test(body);return{ok:productReady&&!!publish,commerce_ready:productReady,needs_confirm:true,final_publish_visible:!!publish,productText:productText,title:title,caption:caption.slice(0,200),tail:body.slice(-800),publishButton:publish&&{text:publish.text,x:publish.x,y:publish.y,w:publish.w,h:publish.h}}}',
      'return{ok:false,reason:"unknown stage "+stage,tail:body.slice(-600)}',
      '})()'
    ].join('');
  }

  function douyinCommerceAddProductFallbackScript(productUrl) {
    return [
      '(function(){',
      'var productUrl=' + jsUriLiteral(productUrl) + ';',
      'function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function disabled(el){return !!(el.disabled||el.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(el.className||"")))}',
      'function ctx(el){var a=[],p=el;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(textOf(p));return a.join(" | ").slice(0,700)}',
      'function items(selector,root){return Array.from((root||document).querySelectorAll(selector)).map(function(el){var r=el.getBoundingClientRect();return{el:el,text:textOf(el),ctx:ctx(el),placeholder:el.getAttribute&&el.getAttribute("placeholder")||"",type:el.getAttribute&&el.getAttribute("type")||"",cls:String(el.className||"").slice(0,160),visible:visible(el),disabled:disabled(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'function fire(item){if(!item)return null;try{item.el.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=item.el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||item.el;["pointermove","mousemove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click&&hit.click()}catch(e){}try{item.el.click&&item.el.click()}catch(e){}return{text:item.text,ctx:item.ctx,placeholder:item.placeholder,x:Math.round(x),y:Math.round(y),hit:textOf(hit)}}',
      'function clickAt(x,y){x=Math.max(10,Math.min(innerWidth-10,x));y=Math.max(10,Math.min(innerHeight-10,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;["pointermove","mousemove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.focus&&hit.focus();hit.click&&hit.click()}catch(e){}return{text:textOf(hit),ctx:ctx(hit),x:Math.round(x),y:Math.round(y)}}',
      'function setInput(el,value){if(!el)return false;try{el.scrollIntoView({block:"center",inline:"center"})}catch(e){}el.focus&&el.focus();var proto=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,"value");if(desc&&desc.set)desc.set.call(el,"");else el.value="";el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"deleteContentBackward",data:null}));if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:value}));el.dispatchEvent(new Event("change",{bubbles:true}));return true}',
      'function dialog(){return items("[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]").filter(function(item){return item.visible&&item.w>260&&item.h>160}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0]}',
      'function fieldList(root){return items("input,textarea",root).filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&(/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(item.placeholder+" "+item.text+" "+item.ctx)||item.w>260&&item.h>=24)}).sort(function(a,b){var as=/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(a.placeholder+" "+a.text+" "+a.ctx)?0:1;var bs=/\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|http|https|\\u94fe\\u63a5/.test(b.placeholder+" "+b.text+" "+b.ctx)?0:1;return as-bs||b.w-a.w||a.y-b.y})}',
      'function addButtons(root,input){return items("button,[role=button],a,div,span",root).filter(function(item){return item.visible&&!item.disabled&&item.w>=24&&item.h>=14&&item.w<=320&&item.h<=120&&(/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1|\\u786e\\u8ba4\\u6dfb\\u52a0|^\\u6dfb\\u52a0$|^\\u786e\\u5b9a$|^\\u786e\\u8ba4$/.test(item.text))}).sort(function(a,b){var nearA=input&&a.y>=input.y-24&&a.y<=input.y+input.h+34&&a.x>input.x+input.w-40?0:1;var nearB=input&&b.y>=input.y-24&&b.y<=input.y+input.h+34&&b.x>input.x+input.w-40?0:1;var exactA=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u786e\\u8ba4\\u6dfb\\u52a0/.test(a.text)?0:1;var exactB=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u786e\\u8ba4\\u6dfb\\u52a0/.test(b.text)?0:1;return nearA-nearB||exactA-exactB||(a.w*a.h)-(b.w*b.h)||b.y-a.y})}',
      'var dlg=dialog();',
      'var roots=[dlg&&dlg.el,document].filter(Boolean);',
      'for(var ri=0;ri<roots.length;ri++){var fields=fieldList(roots[ri]);var input=fields[0];if(input){var okInput=setInput(input.el,productUrl);var add=addButtons(roots[ri],input)[0];var clicked=fire(add);return{ok:okInput&&!!add,input:okInput,clicked:clicked&&clicked.text,placeholder:input.placeholder,mode:"fill-existing-input",fields:fields.slice(0,6).map(function(item){return{text:item.text,placeholder:item.placeholder,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),buttons:addButtons(roots[ri],input).slice(0,8).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}})}}}',
      'var pageItems=items("button,[role=button],a,div,span");',
      'var cartRows=pageItems.filter(function(item){return item.visible&&!item.disabled&&item.w>=80&&item.h>=16&&item.w<=760&&item.h<=180&&/\\u8d2d\\u7269\\u8f66/.test(item.text)&&/\\u6dfb\\u52a0\\u94fe\\u63a5/.test(item.text)&&!/\\u5df2\\u6dfb\\u52a0/.test(item.text)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x});',
      'var cartRow=cartRows[0];',
      'if(cartRow){var scoped=pageItems.filter(function(item){return item.visible&&!item.disabled&&/^(\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1)$/.test(item.text)&&item.x>=cartRow.x-20&&item.x<=cartRow.x+cartRow.w+20&&item.y>=cartRow.y-20&&item.y<=cartRow.y+cartRow.h+20&&item.w>=20&&item.h>=12&&item.w<=220&&item.h<=80}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||b.x-a.x||a.y-b.y})[0];var scopedClicked=scoped?fire(scoped):clickAt(cartRow.x+cartRow.w*0.72,cartRow.y+cartRow.h/2);return{ok:false,opened:!!scopedClicked,clicked:scopedClicked,mode:"open-cart-link-scoped",cartRow:{text:cartRow.text,x:cartRow.x,y:cartRow.y,w:cartRow.w,h:cartRow.h},opener:scoped&&{text:scoped.text,x:scoped.x,y:scoped.y,w:scoped.w,h:scoped.h}}}',
      'var openers=pageItems.filter(function(item){var text=item.text+" "+item.ctx+" "+item.cls;return item.visible&&!item.disabled&&item.w>=24&&item.h>=14&&item.w<=360&&item.h<=140&&(/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1|\\u6dfb\\u52a0/.test(item.text)||(/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u6dfb\\u52a0\\u5546\\u54c1/.test(text)&&/\\u8d2d\\u7269\\u8f66|\\u6dfb\\u52a0\\u6807\\u7b7e/.test(text)))}).sort(function(a,b){var exactA=/^\\u6dfb\\u52a0\\u94fe\\u63a5$|^\\u6dfb\\u52a0\\u5546\\u54c1$/.test(a.text)?0:1;var exactB=/^\\u6dfb\\u52a0\\u94fe\\u63a5$|^\\u6dfb\\u52a0\\u5546\\u54c1$/.test(b.text)?0:1;var cartA=/\\u8d2d\\u7269\\u8f66/.test(a.ctx)?0:1;var cartB=/\\u8d2d\\u7269\\u8f66/.test(b.ctx)?0:1;return exactA-exactB||cartA-cartB||(a.w*a.h)-(b.w*b.h)||a.y-b.y})',
      'var opened=fire(openers[0]);',
      'return{ok:false,opened:!!opened,clicked:opened,mode:"open-link-entry",openers:openers.slice(0,10).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),tail:textOf(document.body).slice(-900)}})()'
    ].join('');
  }

  function douyinCommerceProductModalReadyScript() {
    return [
      '(function(){',
      'function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function disabled(el){return !!(el.disabled||el.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(el.className||"")))}',
      'function ctx(el){var a=[],p=el;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(textOf(p));return a.join(" | ").slice(0,700)}',
      'function items(selector){return Array.from(document.querySelectorAll(selector)).map(function(el){var r=el.getBoundingClientRect();return{el:el,text:textOf(el),ctx:ctx(el),placeholder:el.getAttribute&&el.getAttribute("placeholder")||"",type:el.getAttribute&&el.getAttribute("type")||"",cls:String(el.className||"").slice(0,160),visible:visible(el),disabled:disabled(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'var body=(document.body&&document.body.innerText||"").replace(/\\s+/g," ");',
      'var productEditorPattern=/\\u5546\\u54c1\\u77ed\\u6807\\u9898|\\u5546\\u54c1\\u539f\\u6807\\u9898|\\u5546\\u54c1\\u6807\\u9898|\\u77ed\\u6807\\u9898|\\u5546\\u54c1\\u6587\\u6848|\\u5356\\u70b9|\\u63a8\\u8350\\u8bed|\\u5b8c\\u6210\\u7f16\\u8f91|\\u6700\\u591a\\u8f93\\u5165\\d*\\u4e2a\\u6c49\\u5b57|\\u8bf7\\u8f93\\u5165.{0,12}\\u6807\\u9898/;',
      'var linkEntryPattern=/\\u6dfb\\u52a0\\u94fe\\u63a5|\\u5546\\u54c1\\u94fe\\u63a5|\\u7c98\\u8d34|https?:\\/\\//;',
      'var allDialogs=items("[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog],.dy-creator-content-modal-wrap,.dy-creator-content-modal").filter(function(item){return item.visible&&!item.disabled&&item.w>260&&item.h>160}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)});',
      'var dialogs=allDialogs.filter(function(item){var text=item.text+" "+item.ctx+" "+item.cls;return productEditorPattern.test(text)||(/\\u5546\\u54c1/.test(text)&&/\\u7f16\\u8f91|\\u5b8c\\u6210|\\u6807\\u9898|\\u6587\\u6848/.test(text))});',
      'var controls=items("input,textarea,[contenteditable=true]").filter(function(item){return item.visible&&!item.disabled&&item.type!=="file"&&productEditorPattern.test(item.placeholder+" "+item.text+" "+item.ctx)}).sort(function(a,b){return a.y-b.y||a.x-b.x});',
      'var genericControls=items("input,textarea,[contenteditable=true]").filter(function(item){var text=item.placeholder+" "+item.text+" "+item.ctx;return item.visible&&!item.disabled&&item.type!=="file"&&item.w>=80&&item.h>=18&&item.w<=520&&item.h<=120&&!linkEntryPattern.test(text)&&(/\\u5546\\u54c1|\\u7f16\\u8f91|\\u6807\\u9898|\\u6587\\u6848|\\u63a8\\u8350/.test(text)||allDialogs.some(function(dialog){return item.x>=dialog.x-30&&item.x<=dialog.x+dialog.w+30&&item.y>=dialog.y-30&&item.y<=dialog.y+dialog.h+30&&/\\u5546\\u54c1|\\u7f16\\u8f91|\\u5b8c\\u6210/.test(dialog.text+" "+dialog.ctx)}))}).sort(function(a,b){return a.y-b.y||a.x-b.x});',
      'var modalReady=!!dialogs[0]||!!controls[0]||!!genericControls[0];',
      'var attached=/\\u5df2\\u6dfb\\u52a0\\u5546\\u54c1/.test(body);',
      'return{ok:attached||modalReady,attached:attached,modalReady:modalReady,dialog:(dialogs[0]||allDialogs[0])&&{text:(dialogs[0]||allDialogs[0]).text.slice(0,120),ctx:(dialogs[0]||allDialogs[0]).ctx.slice(0,160),x:(dialogs[0]||allDialogs[0]).x,y:(dialogs[0]||allDialogs[0]).y,w:(dialogs[0]||allDialogs[0]).w,h:(dialogs[0]||allDialogs[0]).h},controls:controls.concat(genericControls).slice(0,6).map(function(item){return{text:item.text,placeholder:item.placeholder,ctx:item.ctx.slice(0,160),x:item.x,y:item.y,w:item.w,h:item.h}}),linkEntryVisible:linkEntryPattern.test(body),tail:body.slice(-900)}',
      '})()'
    ].join('');
  }

  function douyinCommerceCompleteProductDirectScript(productText) {
    return String.raw`(function(){
      var productText=__PRODUCT_TEXT__;
      function attr(el,name){try{return el&&el.getAttribute?el.getAttribute(name):''}catch(e){return''}}
      function prop(el,name){try{return el?el[name]:''}catch(e){return''}}
      function textOf(el){var value=prop(el,'innerText')||prop(el,'textContent')||prop(el,'value')||prop(el,'placeholder')||attr(el,'aria-label')||'';return String(value).trim().replace(/\s+/g,' ')}
      function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}
      function disabled(el){return !!(prop(el,'disabled')||attr(el,'aria-disabled')==='true'||/disabled|disable|loading/.test(String(prop(el,'className')||'')))}
      function ctx(el){var list=[],p=el;for(var i=0;i<5&&p;i++,p=p.parentElement)list.push(textOf(p));return list.join(' | ').slice(0,700)}
      function setInput(el,value){if(!el)return false;try{el.scrollIntoView({block:'center',inline:'center'})}catch(e){}try{el.focus&&el.focus()}catch(e){}var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,'value');if(desc&&desc.set)desc.set.call(el,'');else el.value='';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Process'}));return el.value===value}
      function fire(el){if(!el)return null;try{el.scrollIntoView({block:'center',inline:'center'})}catch(e){}var r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||el;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{el.click&&el.click()}catch(e){}return{text:textOf(el),hit:textOf(hit),x:Math.round(x),y:Math.round(y)}}
      var body=textOf(document.body);
      if(/\u5df2\u6dfb\u52a0\u5546\u54c1/.test(body))return{ok:true,alreadyAttached:true,tail:body.slice(-700)};
      var shortTitlePattern=/\u8bf7\u8f93\u5165\u5546\u54c1\u77ed\u6807\u9898|\u5546\u54c1\u77ed\u6807\u9898|\u6700\u591a\u8f93\u516510\u4e2a\u6c49\u5b57/;
      var linkPattern=/\u7c98\u8d34\u5546\u54c1\u94fe\u63a5|\u5546\u54c1\u94fe\u63a5|\u6dfb\u52a0\u94fe\u63a5|https?:\/\//;
      var inputs=Array.from(document.querySelectorAll('input,textarea')).filter(function(el){var text=(attr(el,'placeholder')+' '+textOf(el)+' '+ctx(el));return visible(el)&&!disabled(el)&&attr(el,'type')!=='file'&&shortTitlePattern.test(text)&&!linkPattern.test(text)}).sort(function(a,b){var ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return ar.y-br.y||ar.x-br.x});
      var input=inputs[0];
      if(!input)return{ok:false,directInput:false,tail:body.slice(-900)};
      var okInput=setInput(input,productText);
      var finishPattern=/^(\u5b8c\u6210\u7f16\u8f91|\u5b8c\u6210|\u786e\u5b9a|\u786e\u8ba4)$/;
      var buttons=Array.from(document.querySelectorAll('button,[role=button],div,span')).filter(function(el){return visible(el)&&!disabled(el)&&finishPattern.test(textOf(el))}).sort(function(a,b){var at=textOf(a)==='\u5b8c\u6210\u7f16\u8f91'?0:1,bt=textOf(b)==='\u5b8c\u6210\u7f16\u8f91'?0:1,ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return at-bt||br.y-ar.y||br.x-ar.x});
      var clicked=okInput?fire(buttons[0]):null;
      return{ok:okInput&&!!clicked,shortTitle:okInput,clicked:clicked&&clicked.text,placeholder:attr(input,'placeholder'),value:input.value,buttons:buttons.slice(0,8).map(function(el){var r=el.getBoundingClientRect();return{text:textOf(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}),tail:body.slice(-700)};
    })()`.replace('__PRODUCT_TEXT__', jsUriLiteral(productText));
  }
  async function runDouyinCommerceStage(row, commerce, prefix, session, combined, stage, timeoutMs) {
    if (stage === 'completeProduct') {
      const modalProbe = await evalBrowserJson(prefix, session, 'probe douyin commerce product modal', douyinCommerceProductModalReadyScript(), combined, 60000);
      const modalData = modalProbe.data || {};
      if (modalData.attached) {
        combined.code = 0;
        return {
          result: modalProbe.result,
          data: { ...modalData, ok: true, alreadyAttached: true }
        };
      }
      const productText = cleanCommerceProductText(commerce && commerce.productText, commerce);
      combined.code = 0;
      const direct = await evalBrowserJson(prefix, session, 'douyin commerce completeProduct direct short title', douyinCommerceCompleteProductDirectScript(productText), combined, timeoutMs || 60000);
      if (direct.data && direct.data.ok) {
        combined.code = 0;
        return direct;
      }
      if (!modalData.modalReady) {
        combined.code = 1;
        combined.stderr += '\n商品编辑弹窗尚未出现，已暂停填写商品文案，避免写入商品链接输入框：' + stringify(modalData);
        return {
          result: modalProbe.result,
          data: { ...modalData, ok: false, waitingProductModal: true, direct: direct.data || {} }
        };
      }
      combined.code = 0;
    }
    const probed = await evalBrowserJson(prefix, session, 'douyin commerce ' + stage, douyinCommerceScript(row, commerce, stage), combined, timeoutMs || 60000);
    if (stage === 'addProduct' && probed.data && !probed.data.ok) {
      const productUrl = cleanText(commerce && commerce.productUrl, 1000);
      if (probed.data.opened || /添加链接|添加商品/.test(String(probed.data.clicked || ''))) {
        const openerData = probed.data;
        combined.code = 0;
        await runBrowserStep(combined, 'wait product link input after addProduct opener', prefix.concat(['browser', session, 'wait', 'time', '1']), 8000);
        const retried = await evalBrowserJson(prefix, session, 'douyin commerce addProduct retry after opener', douyinCommerceScript(row, commerce, 'addProduct'), combined, timeoutMs || 60000);
        if (retried.data && retried.data.ok) {
          combined.code = 0;
          probed.data = retried.data;
          probed.data.opener = openerData;
        } else if (retried.data) {
          probed.data.retryAfterOpener = retried.data;
        }
      }
      if (!probed.data.ok) {
        const fallback = await evalBrowserJson(prefix, session, 'douyin commerce addProduct fallback', douyinCommerceAddProductFallbackScript(productUrl), combined, timeoutMs || 60000);
        if (fallback.data && fallback.data.ok) {
          combined.code = 0;
          probed.data.ok = true;
          probed.data.clicked = fallback.data.clicked;
          probed.data.placeholder = fallback.data.placeholder;
          probed.data.fallback = fallback.data;
        } else if (fallback.data && fallback.data.opened) {
          combined.code = 0;
          await runBrowserStep(combined, 'wait product link input after addProduct fallback', prefix.concat(['browser', session, 'wait', 'time', '1']), 8000);
          const retried = await evalBrowserJson(prefix, session, 'douyin commerce addProduct retry after fallback opener', douyinCommerceScript(row, commerce, 'addProduct'), combined, timeoutMs || 60000);
          if (retried.data && retried.data.ok) {
            combined.code = 0;
            probed.data = retried.data;
            probed.data.fallback = fallback.data;
          } else {
            const second = await evalBrowserJson(prefix, session, 'douyin commerce addProduct second fallback', douyinCommerceAddProductFallbackScript(productUrl), combined, timeoutMs || 60000);
            if (second.data && second.data.ok) {
              combined.code = 0;
              probed.data = second.data;
              probed.data.fallbackOpened = fallback.data;
              probed.data.retryAfterOpener = retried.data || {};
            } else {
              probed.data.fallback = {
                opened: fallback.data || {},
                retried: retried.data || {},
                second: second.data || {}
              };
            }
          }
        } else if (fallback.data) {
          probed.data.fallback = fallback.data;
        }
      }
    }
    if (stage === 'openCartSelect' && probed.data && !probed.data.ok) {
      const fallbackScript = `(function(){function txt(e){return(e&&((e.innerText||e.textContent)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function clickAt(x,y){x=Math.max(10,Math.min(innerWidth-10,x));y=Math.max(10,Math.min(innerHeight-10,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;['pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){hit.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click&&hit.click()}catch(e){}return{text:txt(hit),x:Math.round(x),y:Math.round(y)}}var body=txt(document.body);var raw=Array.from(document.querySelectorAll('div,section,span,label,button,[role=button],[role=combobox],[class*=semi-select]')).filter(vis).map(function(e){var r=e.getBoundingClientRect();return{e:e,t:txt(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(e.className||'').slice(0,120)}});var row=raw.filter(function(o){return /添加标签/.test(o.t)&&/(位置|游戏手柄|购物车|输入地理位置|添加作品同款游戏)/.test(o.t)&&o.w>160&&o.h>20}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||a.y-b.y})[0];var target=null;if(row){target=raw.filter(function(o){return o.x>=row.x-20&&o.x<=row.x+row.w+20&&o.y>=row.y-20&&o.y<=row.y+row.h+20&&/(位置|游戏手柄|购物车|输入地理位置|添加作品同款游戏)/.test(o.t+' '+o.cls)&&o.w>=30&&o.h>=14&&o.w<=280&&o.h<=100}).sort(function(a,b){var ac=/semi-select|combobox/i.test(a.cls)?0:1,bc=/semi-select|combobox/i.test(b.cls)?0:1;return ac-bc||(a.w*a.h)-(b.w*b.h)||b.x-a.x})[0]}var clicked=target?clickAt(target.x+target.w/2,target.y+target.h/2):(row?clickAt(row.x+Math.min(row.w-40,Math.max(220,row.w*.42)),row.y+Math.min(row.h-10,Math.max(30,row.h*.55))):null);return{ok:!!clicked,clicked:clicked,row:row&&{text:row.t,x:row.x,y:row.y,w:row.w,h:row.h},target:target&&{text:target.t,x:target.x,y:target.y,w:target.w,h:target.h,cls:target.cls},tail:body.slice(-900)}})()`;
      const fallback = await evalBrowserJson(prefix, session, 'douyin commerce openCartSelect coordinate fallback', fallbackScript, combined, timeoutMs || 60000);
      if (fallback.data && fallback.data.ok) {
        probed.data.ok = true;
        probed.data.fallback = fallback.data;
        combined.code = 0;
      } else {
        probed.data.fallback = fallback.data || {};
      }
    }
    if (stage === 'chooseCart' && probed.data && !probed.data.ok) {
      const reopened = await evalBrowserJson(prefix, session, 'douyin commerce reopen cart dropdown', douyinCommerceScript(row, commerce, 'openCartSelect'), combined, timeoutMs || 60000);
      await runBrowserStep(combined, 'wait cart dropdown retry', prefix.concat(['browser', session, 'wait', 'time', '2']), 10000);
      const retried = await evalBrowserJson(prefix, session, 'douyin commerce chooseCart retry', douyinCommerceScript(row, commerce, 'chooseCart'), combined, timeoutMs || 60000);
      if (retried.data && retried.data.ok) {
        probed.data = retried.data;
      } else if (reopened.data) {
        probed.data.reopened = reopened.data;
        probed.data.retried = retried.data || {};
      }
      if (!probed.data.ok) {
        const fallbackScript = `(function(){function txt(e){return(e&&((e.innerText||e.textContent)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function clickAt(x,y){x=Math.max(10,Math.min(innerWidth-10,x));y=Math.max(10,Math.min(innerHeight-10,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;['pointermove','mousemove','mousedown','pointerdown','mouseup','pointerup','click'].forEach(function(t){hit.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click&&hit.click()}catch(e){}return{text:txt(hit),x:Math.round(x),y:Math.round(y)}}var body=txt(document.body);var raw=Array.from(document.querySelectorAll('div,section,span,label,button,[role=button],[role=option],[role=combobox],[class*=semi-select]')).filter(vis).map(function(e){var r=e.getBoundingClientRect();return{e:e,t:txt(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(e.className||'').slice(0,120)}});var cart=raw.filter(function(o){return /购物车/.test(o.t)&&!/已添加商品/.test(o.t)&&o.w>=20&&o.h>=12&&o.w<=320&&o.h<=120}).sort(function(a,b){var ae=/^购物车$/.test(a.t)?0:1,be=/^购物车$/.test(b.t)?0:1;return ae-be||(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x})[0];if(cart)return{ok:true,stage:'click-cart-option',clicked:clickAt(cart.x+cart.w/2,cart.y+cart.h/2),cart:{text:cart.t,x:cart.x,y:cart.y,w:cart.w,h:cart.h}};var row=raw.filter(function(o){return /添加标签/.test(o.t)&&/(位置|输入地理位置|游戏手柄|添加作品同款游戏|购物车)/.test(o.t)&&o.w>160&&o.h>20}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||a.y-b.y})[0]||raw.filter(function(o){return /(位置|输入地理位置|游戏手柄|添加作品同款游戏)/.test(o.t)&&o.w>=50&&o.h>=20&&o.w<=320&&o.h<=120}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];var clicked=null;if(row){var points=/位置|输入地理位置/.test(row.t)?[[.86,.50],[.74,.50],[.62,.50],[.50,.50],[.38,.50],[.26,.50]]:[[.50,.50],[.66,.50],[.82,.50],[.34,.50]];for(var i=0;i<points.length;i++){var p=points[i];clicked=clickAt(row.x+row.w*p[0],row.y+row.h*p[1]);var after=txt(document.body);if(/购物车/.test(after)&&!/已添加商品/.test(after))break}}return{ok:!!clicked,stage:'open-row-dropdown',clicked:clicked,row:row&&{text:row.t,x:row.x,y:row.y,w:row.w,h:row.h},tail:body.slice(-900)}})()`;
        const opened = await evalBrowserJson(prefix, session, 'douyin commerce chooseCart open row fallback', fallbackScript, combined, timeoutMs || 60000);
        await runBrowserStep(combined, 'wait cart dropdown coordinate fallback', prefix.concat(['browser', session, 'wait', 'time', '1']), 8000);
        const picked = await evalBrowserJson(prefix, session, 'douyin commerce chooseCart pick fallback', fallbackScript, combined, timeoutMs || 60000);
        if (picked.data && picked.data.stage === 'click-cart-option') {
          probed.data.ok = true;
          probed.data.fallback = { opened: opened.data || {}, picked: picked.data || {} };
          combined.code = 0;
        } else {
          probed.data.fallbackChooseCart = { opened: opened.data || {}, picked: picked.data || {} };
        }
      }
    }
    if (stage === 'completeProduct' && probed.data && !probed.data.ok && /商品短标题|完成编辑/.test(String(probed.data.tail || ''))) {
      const productText = cleanCommerceProductText(commerce && commerce.productText, commerce);
      const fallbackScript = `(function(){var productText=${jsUriLiteral(productText)};function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute('aria-label'))||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}function rectOf(item){return item&&{x:item.x,y:item.y,w:item.w,h:item.h};}function clickAt(x,y){x=Math.max(8,Math.min(innerWidth-8,x));y=Math.max(8,Math.min(innerHeight-8,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.focus&&hit.focus();hit.click&&hit.click()}catch(e){}return {el:hit,text:textOf(hit),tag:hit.tagName,cls:String(hit.className||'').slice(0,120),x:Math.round(x),y:Math.round(y)};}function typeText(value){var el=document.activeElement;try{document.execCommand&&document.execCommand('selectAll',false,null);document.execCommand&&document.execCommand('delete',false,null);document.execCommand&&document.execCommand('insertText',false,value)}catch(e){}if(el&&('value' in el)){var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,'value');if(desc&&desc.set)desc.set.call(el,'');else el.value='';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteContentBackward',data:null}));if(desc&&desc.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));}else if(el&&el.isContentEditable){el.textContent=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));}try{navigator.clipboard&&navigator.clipboard.writeText&&navigator.clipboard.writeText(value)}catch(e){}}var body=textOf(document.body);var raw=Array.from(document.querySelectorAll('button,[role=button],div,span,label,input,textarea,[contenteditable=true],[class*=modal],[role=dialog]')).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,i:i,text:textOf(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(el.className||'').slice(0,140),tag:el.tagName}});var dialogs=raw.filter(function(item){return item.visible&&item.w>360&&item.h>220&&/商品短标题|完成编辑|商品原标题/.test(item.text)}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)});var dialog=dialogs[0]||{x:Math.round(innerWidth*0.25),y:Math.round(innerHeight*0.14),w:Math.round(innerWidth*0.5),h:Math.round(innerHeight*0.72)};var inputs=raw.filter(function(item){return item.visible&&/INPUT|TEXTAREA/.test(item.tag)&&item.w>=50&&item.h>=14&&item.x>=dialog.x-20&&item.x<=dialog.x+dialog.w+20&&item.y>=dialog.y-20&&item.y<=dialog.y+dialog.h+20}).sort(function(a,b){return a.y-b.y||a.x-b.x});var shortLabel=raw.filter(function(item){return item.visible&&/商品短标题|最多输入10个汉字/.test(item.text)&&item.w>20&&item.h>10&&item.x>=dialog.x-20&&item.x<=dialog.x+dialog.w+20&&item.y>=dialog.y-20&&item.y<=dialog.y+dialog.h+20}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];var points=[];inputs.forEach(function(item){points.push({kind:'input',x:item.x+Math.min(item.w-8,Math.max(12,item.w/2)),y:item.y+item.h/2,ref:rectOf(item)})});if(shortLabel){points.push({kind:'label-right',x:shortLabel.x+Math.min(shortLabel.w-12,Math.max(150,shortLabel.w*0.58)),y:shortLabel.y+Math.min(shortLabel.h-6,Math.max(26,shortLabel.h*0.55)),ref:rectOf(shortLabel)});points.push({kind:'label-below',x:shortLabel.x+Math.min(shortLabel.w-12,Math.max(150,shortLabel.w*0.58)),y:shortLabel.y+shortLabel.h+18,ref:rectOf(shortLabel)})}[[0.58,0.52],[0.58,0.58],[0.58,0.64],[0.50,0.60],[0.66,0.60]].forEach(function(p){points.push({kind:'dialog-'+p[0]+'-'+p[1],x:dialog.x+dialog.w*p[0],y:dialog.y+dialog.h*p[1],ref:rectOf(dialog)})});var tried=[],typed=false;for(var i=0;i<points.length;i++){var p=points[i];var clicked=clickAt(p.x,p.y);typeText(productText);var active=document.activeElement;var activeText=textOf(active);var now=textOf(document.body);var okActive=active&&((('value' in active)&&active.value===productText)||activeText===productText||now.indexOf(productText)>=0);tried.push({kind:p.kind,clicked:clicked&&{text:clicked.text,tag:clicked.tag,cls:clicked.cls,x:clicked.x,y:clicked.y},active:active&&active.tagName,activeText:activeText.slice(0,40),okActive:!!okActive});if(okActive){typed=true;break;}}var done=raw.filter(function(item){return item.visible&&/完成编辑|完成|确定|确认/.test(item.text)&&!/取消/.test(item.text)&&item.w>=28&&item.h>=16&&item.w<=280&&item.h<=140&&item.x>=dialog.x-40&&item.x<=dialog.x+dialog.w+60&&item.y>=dialog.y-40&&item.y<=dialog.y+dialog.h+60}).sort(function(a,b){var ae=/完成编辑/.test(a.text)?0:1,be=/完成编辑/.test(b.text)?0:1;return ae-be||b.y-a.y||b.x-a.x})[0];var clickedDone=null;if(typed){if(done){clickedDone=clickAt(done.x+done.w/2,done.y+done.h/2)}else{clickedDone=clickAt(dialog.x+dialog.w-72,dialog.y+dialog.h-32)}}return {ok:typed&&!!clickedDone,typed:typed,clicked:clickedDone&&clickedDone.text,dialog:rectOf(dialog),done:rectOf(done),tried:tried,tail:body.slice(-800),buttons:raw.filter(function(item){return /商品短标题|完成编辑|取消|完成|确定/.test(item.text)}).slice(0,30).map(function(item){return {text:item.text,x:item.x,y:item.y,w:item.w,h:item.h,cls:item.cls}})};})()`;
      const fallback = await evalBrowserJson(prefix, session, 'douyin commerce completeProduct fallback', fallbackScript, combined, 60000);
      if (fallback.data && fallback.data.ok) {
        await runBrowserStep(combined, 'wait product attach after complete fallback', prefix.concat(['browser', session, 'wait', 'time', '3']), 12000);
        const verifyScript = `(function(){var productText=${jsUriLiteral(productText)};var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var modal=/商品短标题|完成编辑|商品原标题/.test(body);var attached=/已添加商品/.test(body)||(productText&&body.indexOf(productText)>=0&&!modal);return{ok:attached&&!modal,attached:attached,modal:modal,tail:body.slice(-900)}})()`;
        const verified = await evalBrowserJson(prefix, session, 'douyin commerce completeProduct verify fallback', verifyScript, combined, 60000);
        if (verified.data && verified.data.ok) {
          probed.data.ok = true;
          probed.data.clicked = fallback.data.clicked;
          probed.data.fallback = fallback.data;
          probed.data.verified = verified.data;
        } else {
          probed.data.fallback = fallback.data;
          probed.data.verifyAfterFallback = verified.data || {};
        }
      }
      if (probed.data && !probed.data.ok) {
        combined.code = 0;
        const coordinateScript = `(function(){var productText=${jsUriLiteral(productText)};function txt(e){return(e&&((e.innerText||e.textContent||e.value||e.placeholder||e.getAttribute&&e.getAttribute('aria-label'))||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function clickAt(x,y){x=Math.max(10,Math.min(innerWidth-10,x));y=Math.max(10,Math.min(innerHeight-10,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;['pointermove','mousemove','pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){hit.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.focus&&hit.focus();hit.click&&hit.click()}catch(e){}return {text:txt(hit),tag:hit.tagName,cls:String(hit.className||'').slice(0,100),x:Math.round(x),y:Math.round(y)}}function typeActive(){var el=document.activeElement;if(!el)return false;try{document.execCommand&&document.execCommand('selectAll',false,null);document.execCommand&&document.execCommand('delete',false,null);document.execCommand&&document.execCommand('insertText',false,productText)}catch(e){}if('value' in el){var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var desc=Object.getOwnPropertyDescriptor(proto,'value');if(desc&&desc.set)desc.set.call(el,productText);else el.value=productText;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:productText}));el.dispatchEvent(new Event('change',{bubbles:true}));return el.value===productText}if(el.isContentEditable){el.textContent=productText;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:productText}));el.dispatchEvent(new Event('change',{bubbles:true}));return txt(el)===productText}return txt(document.body).indexOf(productText)>=0}var body=txt(document.body);var raw=Array.from(document.querySelectorAll('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog],div,span,button,input,textarea,[contenteditable=true]')).filter(vis).map(function(e){var r=e.getBoundingClientRect();return{e:e,t:txt(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),tag:e.tagName,cls:String(e.className||'').slice(0,100)}});var dialog=raw.filter(function(o){return o.w>360&&o.h>220&&/商品短标题|商品原标题|完成编辑/.test(o.t)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)})[0]||{x:Math.round(innerWidth*.25),y:Math.round(innerHeight*.16),w:Math.round(innerWidth*.5),h:Math.round(innerHeight*.68)};var label=raw.filter(function(o){return /商品短标题|最多输入10个汉字/.test(o.t)&&o.x>=dialog.x-30&&o.x<=dialog.x+dialog.w+30&&o.y>=dialog.y-30&&o.y<=dialog.y+dialog.h+30}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];var points=[];raw.filter(function(o){return /INPUT|TEXTAREA/.test(o.tag)&&o.x>=dialog.x-30&&o.x<=dialog.x+dialog.w+30&&o.y>=dialog.y-30&&o.y<=dialog.y+dialog.h+30}).forEach(function(o){points.push({k:'input',x:o.x+Math.max(12,Math.min(o.w/2,o.w-8)),y:o.y+o.h/2})});if(label){points.push({k:'label-right',x:label.x+Math.max(150,Math.min(label.w-12,label.w*.58)),y:label.y+Math.max(26,Math.min(label.h-6,label.h*.55))});points.push({k:'label-below',x:label.x+Math.max(150,Math.min(label.w-12,label.w*.58)),y:label.y+label.h+18})}[[.56,.50],[.56,.56],[.56,.62],[.62,.56],[.50,.56],[.70,.56]].forEach(function(p){points.push({k:'fixed',x:dialog.x+dialog.w*p[0],y:dialog.y+dialog.h*p[1]})});var tried=[],typed=false;for(var i=0;i<points.length;i++){var p=points[i],clicked=clickAt(p.x,p.y),ok=typeActive();tried.push({k:p.k,clicked:clicked,active:document.activeElement&&document.activeElement.tagName,activeText:txt(document.activeElement).slice(0,30),ok:ok});if(ok||txt(document.body).indexOf(productText)>=0){typed=true;break}}return{ok:typed,typed:typed,dialog:{x:dialog.x,y:dialog.y,w:dialog.w,h:dialog.h},label:label&&{x:label.x,y:label.y,w:label.w,h:label.h,text:label.t.slice(0,80)},tried:tried,tail:body.slice(-800)}})()`;
        const coordinateType = await evalBrowserJson(prefix, session, 'douyin commerce type product short title by coordinates', coordinateScript, combined, 60000);
        if (coordinateType.data && coordinateType.data.ok) {
          probed.data.coordinateType = coordinateType.data;
        } else {
          probed.data.coordinateType = coordinateType.data || {};
        }
        const finishScript = `(function(){function txt(e){return(e&&((e.innerText||e.textContent)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function clickAt(x,y){x=Math.max(10,Math.min(innerWidth-10,x));y=Math.max(10,Math.min(innerHeight-10,y));var hit=document.elementFromPoint(x,y);if(!hit)return null;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){hit.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click&&hit.click()}catch(e){}return{text:txt(hit),x:Math.round(x),y:Math.round(y)}}var raw=Array.from(document.querySelectorAll('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog],div,span,button')).filter(vis).map(function(e){var r=e.getBoundingClientRect();return{e:e,t:txt(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}});var dialog=raw.filter(function(o){return o.w>360&&o.h>220&&/商品短标题|商品原标题|完成编辑/.test(o.t)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)})[0]||{x:Math.round(innerWidth*.25),y:Math.round(innerHeight*.16),w:Math.round(innerWidth*.5),h:Math.round(innerHeight*.68)};var done=raw.filter(function(o){return /完成编辑|完成|确定|确认/.test(o.t)&&!/取消/.test(o.t)&&o.w>=20&&o.h>=12&&o.w<=280&&o.h<=140&&o.x>=dialog.x-40&&o.x<=dialog.x+dialog.w+60&&o.y>=dialog.y-40&&o.y<=dialog.y+dialog.h+60}).sort(function(a,b){var ae=/完成编辑/.test(a.t)?0:1,be=/完成编辑/.test(b.t)?0:1;return ae-be||b.y-a.y||b.x-a.x})[0];return done?{ok:true,clicked:clickAt(done.x+done.w/2,done.y+done.h/2),done:{text:done.t,x:done.x,y:done.y,w:done.w,h:done.h}}:{ok:false,clicked:clickAt(dialog.x+dialog.w-72,dialog.y+dialog.h-32),dialog:dialog};})()`;
        await evalBrowserJson(prefix, session, 'douyin commerce click finish product edit by coordinates', finishScript, combined, 60000);
        await runBrowserStep(combined, 'wait product attach after browser type', prefix.concat(['browser', session, 'wait', 'time', '3']), 12000);
        const verifyScript = `(function(){var productText=${jsUriLiteral(productText)};var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var modal=/商品短标题|完成编辑|商品原标题/.test(body);var attached=/已添加商品/.test(body)||(productText&&body.indexOf(productText)>=0&&!modal);return{ok:attached&&!modal,attached:attached,modal:modal,tail:body.slice(-900)}})()`;
        const verified = await evalBrowserJson(prefix, session, 'douyin commerce completeProduct verify browser type', verifyScript, combined, 60000);
        if (verified.data && verified.data.ok) {
          probed.data.ok = true;
          probed.data.browserType = true;
          probed.data.verified = verified.data;
          combined.code = 0;
        } else {
          probed.data.browserTypeVerify = verified.data || {};
        }
      }
    }
    const allowManualConfirm = stage === 'verifyReady' && probed.data && probed.data.commerce_ready;
    if (!probed.data.ok && !allowManualConfirm) {
      combined.code = 1;
      combined.stderr += '\nDouyin commerce stage failed (' + stage + '): ' + stringify(probed.data);
    }
    return probed;
  }

  function douyinCommerceUploadReadyScript() {
    return String.raw`(function(){function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute('aria-label'))||'')||'').trim().replace(/\s+/g,' ')}function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')))}function ctx(el){var a=[],p=el;for(var i=0;i<4&&p;i++,p=p.parentElement)a.push(textOf(p));return a.join(' ').slice(0,500)}function itemize(sel){return Array.from(document.querySelectorAll(sel)).map(function(el){var r=el.getBoundingClientRect();return{el:el,text:textOf(el),ctx:ctx(el),visible:visible(el),disabled:disabled(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function clickItem(el){try{el.scrollIntoView({block:'center',inline:'center'})}catch(e){}var r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||el;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{el.click()}catch(e){}return{text:textOf(el),x:Math.round(x),y:Math.round(y),hit:textOf(hit)}}var body=(document.body&&document.body.innerText||'').replace(/\s+/g,' ');var resume=/\u4f60\u8fd8\u6709\u4e0a\u6b21\u672a\u53d1\u5e03|\u7ee7\u7eed\u7f16\u8f91|\u653e\u5f03/.test(body)&&!/\u4f5c\u54c1\u63cf\u8ff0|\u8bbe\u7f6e\u5c01\u9762|\u6dfb\u52a0\u6807\u7b7e/.test(body);if(resume){var resumeItems=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=18&&item.h>=14&&item.w<=280&&item.h<=110});var abandon=resumeItems.filter(function(item){return /^(\u653e\u5f03|\u91cd\u65b0\u4e0a\u4f20|\u4e0d\u7ee7\u7eed|\u53d6\u6d88\u7ee7\u7eed)$/.test(item.text)||/\u653e\u5f03|\u91cd\u65b0\u4e0a\u4f20/.test(item.text)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||b.x-a.x})[0];if(abandon)return{ok:false,resumeDraft:true,clickedAbandon:true,action:'abandon-previous-draft',target:clickItem(abandon.el),tail:body.slice(-600)};return{ok:false,resumeDraft:true,reason:'存在上次未发布弹窗，但没有找到放弃按钮',choices:resumeItems.slice(0,20).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),tail:body.slice(-800)}}var inputs=Array.from(document.querySelectorAll('input,textarea')).filter(visible);var title=inputs.find(function(el){return el.type!=='file'&&/\u4f5c\u54c1\u6807\u9898|\u586b\u5199\u4f5c\u54c1\u6807\u9898|\u6807\u9898/.test(textOf(el))});var editor=Array.from(document.querySelectorAll('[contenteditable=true],textarea')).find(function(el){var r=el.getBoundingClientRect();return visible(el)&&r.width>200&&r.height>36});var buttons=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=30&&item.h>=18&&item.w<=280&&item.h<=110});var publishButton=buttons.find(function(item){return item.text==='\u53d1\u5e03'});var uploadRunning=/\u53d6\u6d88\u4e0a\u4f20|\u5f53\u524d\u901f\u5ea6|\u5269\u4f59\u65f6\u95f4|\u4e0a\u4f20\u4e2d|\u5df2\u4e0a\u4f20[：:]/.test(body)&&!/\u91cd\u65b0\u4e0a\u4f20|\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762|\u4f5c\u54c1\u63cf\u8ff0|\u8bbe\u7f6e\u5c01\u9762/.test(body);if(/\u4e0a\u4f20\u4e2d\s*\d{1,3}%/.test(body)&&!/\u91cd\u65b0\u4e0a\u4f20|\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762|\u4f5c\u54c1\u63cf\u8ff0|\u8bbe\u7f6e\u5c01\u9762/.test(body))uploadRunning=true;var formReady=Boolean(title||editor||publishButton||/\u4f5c\u54c1\u63cf\u8ff0|\u8bbe\u7f6e\u5c01\u9762|\u9009\u62e9\u5c01\u9762|\u5c01\u9762\u7f3a\u5931|\u6a2a\u5c01\u9762|\u7ad6\u5c01\u9762|\u53d1\u5e03\u8bbe\u7f6e|\u6dfb\u52a0\u6807\u7b7e|\u63a8\u8350|\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762|\u91cd\u65b0\u4e0a\u4f20|\u53d1\u6587\u52a9\u624b/.test(body));return{ok:formReady&&!uploadRunning,formReady:formReady,uploadRunning:uploadRunning,titleFound:Boolean(title),editorFound:Boolean(editor),publishButtonFound:Boolean(publishButton),evidence:{hasCover:/\u8bbe\u7f6e\u5c01\u9762|\u9009\u62e9\u5c01\u9762|\u5c01\u9762\u7f3a\u5931|\u6a2a\u5c01\u9762|\u7ad6\u5c01\u9762/.test(body),hasPreview:/\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762/.test(body),hasReupload:/\u91cd\u65b0\u4e0a\u4f20/.test(body),hasDescription:/\u4f5c\u54c1\u63cf\u8ff0/.test(body)},tail:body.slice(-700)}})()`;
  }

  function douyinRecommendedTopicScript() {
    return `(function(){function txt(e){return(e&&((e.innerText||e.textContent)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}var body=txt(document.body);var nodes=Array.from(document.querySelectorAll('div,section,span')).filter(vis).map(function(e){var r=e.getBoundingClientRect();return{text:txt(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}});var topic=nodes.filter(function(n){return /\\u63a8\\u8350/.test(n.text)&&/#/.test(n.text)&&n.text.length<900&&n.w>180&&n.h>=18}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];var fallback=/\\u6dfb\\u52a0\\u8bdd\\u9898[\\s\\S]{0,260}\\u63a8\\u8350[\\s\\S]{0,260}#/.test(body)||/\\u4f5c\\u54c1\\u63cf\\u8ff0[\\s\\S]{0,500}\\u63a8\\u8350[\\s\\S]{0,260}#/.test(body);return{ok:Boolean(topic||fallback),recommendedTopic:Boolean(topic||fallback),topic:topic||null,tail:body.slice(-700)}})()`;
  }

  function douyinCommerceUploadReadyScript() {
    return String.raw`(function(){
      function textOf(el){return (el&&((el.innerText||el.textContent||el.value||el.placeholder||el.getAttribute&&el.getAttribute('aria-label'))||'')||'').trim().replace(/\s+/g,' ')}
      function visible(el){if(!el)return false;var r=el.getBoundingClientRect(),s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}
      function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')))}
      function ctx(el){var a=[],p=el;for(var i=0;i<4&&p;i++,p=p.parentElement)a.push(textOf(p));return a.join(' ').slice(0,500)}
      function itemize(sel){return Array.from(document.querySelectorAll(sel)).map(function(el){var r=el.getBoundingClientRect();return{el:el,text:textOf(el),ctx:ctx(el),visible:visible(el),disabled:disabled(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}
      function clickItem(el){try{el.scrollIntoView({block:'center',inline:'center'})}catch(e){}var r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y)||el;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{el.click()}catch(e){}return{text:textOf(el),x:Math.round(x),y:Math.round(y),hit:textOf(hit)}}
      var body=(document.body&&document.body.innerText||'').replace(/\s+/g,' ');
      var resume=/\u4f60\u8fd8\u6709\u4e0a\u6b21\u672a\u53d1\u5e03|\u7ee7\u7eed\u7f16\u8f91|\u653e\u5f03/.test(body)&&!/\u4f5c\u54c1\u63cf\u8ff0|\u8bbe\u7f6e\u5c01\u9762|\u6dfb\u52a0\u6807\u7b7e/.test(body);
      if(resume){
        var resumeItems=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=18&&item.h>=14&&item.w<=280&&item.h<=110});
        var abandon=resumeItems.filter(function(item){return /^(\u653e\u5f03|\u91cd\u65b0\u4e0a\u4f20|\u4e0d\u7ee7\u7eed|\u53d6\u6d88\u7ee7\u7eed)$/.test(item.text)||/\u653e\u5f03|\u91cd\u65b0\u4e0a\u4f20/.test(item.text)}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||b.x-a.x})[0];
        if(abandon)return{ok:false,resumeDraft:true,clickedAbandon:true,action:'abandon-previous-draft',target:clickItem(abandon.el),tail:body.slice(-600)};
        return{ok:false,resumeDraft:true,reason:'存在上次未发布弹窗，但没有找到放弃按钮',choices:resumeItems.slice(0,20).map(function(item){return{text:item.text,ctx:item.ctx,x:item.x,y:item.y,w:item.w,h:item.h}}),tail:body.slice(-800)};
      }
      var inputs=Array.from(document.querySelectorAll('input,textarea')).filter(visible);
      var title=inputs.find(function(el){return el.type!=='file'&&/\u4f5c\u54c1\u6807\u9898|\u586b\u5199\u4f5c\u54c1\u6807\u9898|\u6807\u9898/.test(textOf(el))});
      var editor=Array.from(document.querySelectorAll('[contenteditable=true],textarea')).find(function(el){var r=el.getBoundingClientRect();return visible(el)&&r.width>200&&r.height>36});
      var buttons=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=30&&item.h>=18&&item.w<=280&&item.h<=110});
      var publishButton=buttons.find(function(item){return item.text==='\u53d1\u5e03'});
      var uploadComplete=/\u91cd\u65b0\u4e0a\u4f20|\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762|\u6781\u901f\u4e0a\u4f20\u6210\u529f|\u4e0a\u4f20\u6210\u529f/.test(body);
      var rawUploading=/\u53d6\u6d88\u4e0a\u4f20|\u5f53\u524d\u901f\u5ea6|\u5269\u4f59\u65f6\u95f4|\u4e0a\u4f20\u4e2d|\u4e0a\u4f20\u8fc7\u7a0b\u4e2d\u8bf7\u4e0d\u8981|\u4e0a\u4f20\u8fc7\u7a0b\u4e2d|\u6587\u4ef6\u89e3\u6790\u4e2d|\u89e3\u6790\u4e2d|\u5df2\u4e0a\u4f20[：:]|(?:\u4e0a\u4f20|\u89e3\u6790|\u6587\u4ef6)[\s\S]{0,40}\d{1,3}\s*%|\d{1,3}\s*%[\s\S]{0,40}(?:\u4e0a\u4f20|\u89e3\u6790|\u6587\u4ef6)/.test(body)&&!uploadComplete;
      var stillUploadEntry=/\u70b9\u51fb\u4e0a\u4f20|\u6216\u76f4\u63a5\u5c06\u89c6\u9891\u6587\u4ef6\u62d6\u5165\u6b64\u533a\u57df/.test(body)&&!uploadComplete;
      var formSignals=Boolean(title||editor||publishButton||/\u4f5c\u54c1\u63cf\u8ff0|\u57fa\u7840\u4fe1\u606f|\u8bbe\u7f6e\u5c01\u9762|\u9009\u62e9\u5c01\u9762|\u5c01\u9762\u7f3a\u5931|\u6a2a\u5c01\u9762|\u7ad6\u5c01\u9762|\u53d1\u5e03\u8bbe\u7f6e|\u6dfb\u52a0\u6807\u7b7e|\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762|\u91cd\u65b0\u4e0a\u4f20|\u53d1\u6587\u52a9\u624b/.test(body));
      var uploadRunning=rawUploading||stillUploadEntry;
      var strongReady=Boolean(uploadComplete||publishButton);
      var formReady=Boolean(formSignals);
      return{ok:formReady&&!uploadRunning&&strongReady,formReady:formReady,uploadRunning:uploadRunning,titleFound:Boolean(title),editorFound:Boolean(editor),publishButtonFound:Boolean(publishButton),evidence:{rawUploading:rawUploading,uploadComplete:uploadComplete,stillUploadEntry:stillUploadEntry,strongReady:strongReady,hasCover:/\u8bbe\u7f6e\u5c01\u9762|\u9009\u62e9\u5c01\u9762|\u5c01\u9762\u7f3a\u5931|\u6a2a\u5c01\u9762|\u7ad6\u5c01\u9762/.test(body),hasPreview:/\u9884\u89c8\u89c6\u9891|\u9884\u89c8\u5c01\u9762/.test(body),hasReupload:/\u91cd\u65b0\u4e0a\u4f20/.test(body),hasDescription:/\u4f5c\u54c1\u63cf\u8ff0/.test(body)},tail:body.slice(-700)}
    })()`;
  }

  async function waitDouyinCommerceUploadReady(prefix, session, combined, options) {
    const settleCoverAssets = !options || options.settleCoverAssets !== false;
    const extraWaitLoops = Math.max(0, Number(options && options.extraWaitLoops) || 0);
    let last = null;
    let stableReady = 0;
    let sawUploadRunning = false;
    for (let i = 0; i < 36 + extraWaitLoops; i += 1) {
      const probeCodeBefore = combined.code;
      const probeStderrBefore = combined.stderr || '';
      last = await evalBrowserJson(prefix, session, 'probe douyin commerce upload ready ' + (i + 1), douyinCommerceUploadReadyScript(), combined, 60000);
      if (last.result && last.result.code !== 0 && /TIMEOUT/i.test(String(last.result.stderr || ''))) {
        combined.code = probeCodeBefore;
        combined.stderr = probeStderrBefore + '\n上传后页面检测第 ' + (i + 1) + ' 次超时，页面可能仍在上传/转码，继续等待。';
        last.data = last.data || {};
        last.data.uploadProbeTimeout = true;
      }
      const data = last.data || {};
      if (combined.browser_crashed) return last;
      const topicCodeBefore = combined.code;
      const topicStderrBefore = combined.stderr || '';
      const topic = await evalBrowserJson(prefix, session, 'probe douyin recommended topic ' + (i + 1), douyinRecommendedTopicScript(), combined, 30000);
      if (combined.browser_crashed) return last;
      if (topic.result && topic.result.code !== 0 && /TIMEOUT/i.test(String(topic.result.stderr || ''))) {
        combined.code = topicCodeBefore;
        combined.stderr = topicStderrBefore + '\n推荐话题检测第 ' + (i + 1) + ' 次超时，继续等待页面完成。';
      }
      if (topic.data && topic.data.ok) {
        combined.code = 0;
        data.recommendedTopic = true;
        last.data = data;
      }
      if (data.uploadRunning) sawUploadRunning = true;
      if (data.ok && (!settleCoverAssets || data.recommendedTopic)) {
        stableReady += 1;
        if (stableReady >= 2 || sawUploadRunning) {
          if (settleCoverAssets) {
            if (combined.job_id) await updateJobProgress(combined.job_id, '封面素材就绪', '封面素材已出现，准备打开封面选择');
            combined.stdout += '\n$ douyin commerce cover assets ready, click cover now\n';
          } else if (combined.job_id) {
            await updateJobProgress(combined.job_id, '上传完成', '视频已上传完成，当前账号跳过封面等待');
          }
          return last;
        }
      } else {
        stableReady = 0;
      }
      await runBrowserStep(combined, 'wait douyin commerce upload ready ' + (i + 1), prefix.concat(['browser', session, 'wait', 'time', '3']), 10000);
    }
    combined.code = 1;
    combined.stderr += '\n抖音上传后发布表单仍未就绪：' + stringify(last && last.data || {});
    return last;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function textOf(el){return (el&&((el.innerText||el.textContent||el.alt||el.title)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}function contextText(el){var parts=[];var p=el;for(var i=0;i<5&&p;i+=1,p=p.parentElement){parts.push(textOf(p));}return parts.join(' ').slice(0,500);}function itemize(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),ctx:contextText(el),cls:String(el.className||'').slice(0,180),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});}function clickItem(item){item.el.scrollIntoView({block:'center',inline:'center'});item.el.click();return {index:item.index,tag:item.tag,text:item.text,ctx:item.ctx,cls:item.cls,x:item.x,y:item.y,w:item.w,h:item.h};}var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var knows=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.text==='鎴戠煡閬撲簡'&&item.w<140&&item.h<80;}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h);})[0];if(knows)knows.el.click();var hasCoverSection=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|绔栧皝闈妯皝闈?.test(body);var coverMissing=/灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け|璁剧疆灏侀潰\\s*\\*\\s*\\(蹇呭～\\)/.test(body);var dialog=itemize('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(item){return item.visible&&/灏侀潰|绔栧皝闈妯皝闈瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆妯皝闈?.test(item.text);}).sort(function(a,b){return (b.w*b.h)-(a.w*a.h);})[0];var buttons=itemize('button,[role=button],a,div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=30&&item.h>=18&&item.w<=260&&item.h<=90;});if(dialog){var horizontal=buttons.filter(function(item){return item.text==='璁剧疆妯皝闈?||item.text==='閫夋嫨灏侀潰'&&/妯皝闈妯増/.test(item.ctx);}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||b.y-a.y;})[0];if(horizontal)return {ok:false,action:'open-horizontal-cover',coverMissing:coverMissing,target:clickItem(horizontal)};var confirm=buttons.filter(function(item){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(item.text);}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];if(confirm)return {ok:false,action:'confirm-cover-dialog',coverMissing:coverMissing,target:clickItem(confirm)};var candidate=itemize('img,canvas,video').filter(function(item){return item.visible&&!item.disabled&&item.x>=dialog.x-40&&item.x<=dialog.x+dialog.w+40&&item.y>=dialog.y-40&&item.y<=dialog.y+dialog.h+40&&item.w>=50&&item.h>=50&&item.w<=620&&item.h<=620;}).sort(function(a,b){return a.y-b.y||a.x-b.x;})[0];if(candidate)return {ok:false,action:'select-cover-frame',coverMissing:coverMissing,target:clickItem(candidate)};return {ok:false,action:'cover-dialog-waiting',coverMissing:coverMissing,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|璁剧疆|鏆備笉/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}if(!hasCoverSection)return {ok:true,skipped:'no cover section'};if(!coverMissing)return {ok:true,coverMissing:false,reason:'cover ready'};var chooseButtons=buttons.filter(function(item){return item.text==='閫夋嫨灏侀潰'||/閫夋嫨灏侀潰/.test(item.text)&&/璁剧疆灏侀潰|绔栧皝闈妯皝闈灏侀潰缂哄け/.test(item.ctx);}).sort(function(a,b){return a.y-b.y||a.x-b.x;});if(chooseButtons.length){window.__douyinCommerceCoverChoiceIndex=window.__douyinCommerceCoverChoiceIndex||0;var target=chooseButtons[window.__douyinCommerceCoverChoiceIndex%chooseButtons.length];window.__douyinCommerceCoverChoiceIndex+=1;return {ok:false,action:'open-cover-picker',coverMissing:coverMissing,target:clickItem(target),choices:chooseButtons.map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}return {ok:false,coverMissing:coverMissing,reason:'閫夋嫨灏侀潰鎸夐挳鏈壘鍒?,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|鍙戝竷/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};}),tail:body.slice(0,1200)};})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function textOf(el){return (el&&((el.innerText||el.textContent||el.alt||el.title)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}function contextText(el){var parts=[];var p=el;for(var i=0;i<5&&p;i+=1,p=p.parentElement){parts.push(textOf(p));}return parts.join(' ').slice(0,500);}function itemize(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),ctx:contextText(el),cls:String(el.className||'').slice(0,180),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});}function clickItem(item){item.el.scrollIntoView({block:'center',inline:'center'});item.el.click();return {index:item.index,tag:item.tag,text:item.text,ctx:item.ctx,cls:item.cls,x:item.x,y:item.y,w:item.w,h:item.h};}var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var knows=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.text==='鎴戠煡閬撲簡'&&item.w<140&&item.h<80;}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h);})[0];if(knows)knows.el.click();var hasCoverSection=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|绔栧皝闈妯皝闈?.test(body);var coverMissing=/灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け|璁剧疆灏侀潰\\s*\\*\\s*\\(蹇呭～\\)/.test(body);var dialog=itemize('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(item){return item.visible&&/灏侀潰|绔栧皝闈妯皝闈瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆妯皝闈AI灏侀潰/.test(item.text);}).sort(function(a,b){return (b.w*b.h)-(a.w*a.h);})[0];var buttons=itemize('button,[role=button],a,div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=30&&item.h>=18&&item.w<=260&&item.h<=90;});if(dialog){var confirm=buttons.filter(function(item){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(item.text);}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];if(confirm)return {ok:false,action:'confirm-cover-dialog',coverMissing:coverMissing,target:clickItem(confirm)};var horizontal=buttons.filter(function(item){return item.text==='璁剧疆妯皝闈?||item.text==='閫夋嫨灏侀潰'&&/妯皝闈妯増/.test(item.ctx);}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||b.y-a.y;})[0];if(horizontal)return {ok:false,action:'open-horizontal-cover',coverMissing:coverMissing,target:clickItem(horizontal)};var candidate=itemize('img,canvas,video').filter(function(item){return item.visible&&!item.disabled&&item.x>=dialog.x-40&&item.x<=dialog.x+dialog.w+40&&item.y>=dialog.y-40&&item.y<=dialog.y+dialog.h+40&&item.w>=50&&item.h>=50&&item.w<=620&&item.h<=620;}).sort(function(a,b){return a.y-b.y||a.x-b.x;})[0];if(candidate)return {ok:false,action:'select-cover-frame',coverMissing:coverMissing,target:clickItem(candidate)};return {ok:false,action:'cover-dialog-waiting',coverMissing:coverMissing,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|璁剧疆|鏆備笉/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}if(!hasCoverSection)return {ok:true,skipped:'no cover section'};if(!coverMissing)return {ok:true,coverMissing:false,reason:'cover ready'};var chooseButtons=buttons.filter(function(item){return item.text==='閫夋嫨灏侀潰'||/閫夋嫨灏侀潰/.test(item.text)&&/璁剧疆灏侀潰|绔栧皝闈妯皝闈灏侀潰缂哄け/.test(item.ctx);}).sort(function(a,b){return a.y-b.y||a.x-b.x;});if(chooseButtons.length){window.__douyinCommerceCoverChoiceIndex=window.__douyinCommerceCoverChoiceIndex||0;var target=chooseButtons[window.__douyinCommerceCoverChoiceIndex%chooseButtons.length];window.__douyinCommerceCoverChoiceIndex+=1;return {ok:false,action:'open-cover-picker',coverMissing:coverMissing,target:clickItem(target),choices:chooseButtons.map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}return {ok:false,coverMissing:coverMissing,reason:'閫夋嫨灏侀潰鎸夐挳鏈壘鍒?,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|鍙戝竷/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};}),tail:body.slice(0,1200)};})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function textOf(el){return (el&&((el.innerText||el.textContent||el.alt||el.title)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}function contextText(el){var parts=[];var p=el;for(var i=0;i<5&&p;i+=1,p=p.parentElement){parts.push(textOf(p));}return parts.join(' ').slice(0,500);}function itemize(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),ctx:contextText(el),cls:String(el.className||'').slice(0,180),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});}function clickItem(item){item.el.scrollIntoView({block:'center',inline:'center'});item.el.click();return {index:item.index,tag:item.tag,text:item.text,ctx:item.ctx,cls:item.cls,x:item.x,y:item.y,w:item.w,h:item.h};}var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var knows=itemize('button,[role=button],div,span').filter(function(item){return item.visible&&!item.disabled&&item.text==='鎴戠煡閬撲簡'&&item.w<140&&item.h<80;}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h);})[0];if(knows)knows.el.click();var hasCoverSection=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|绔栧皝闈妯皝闈?.test(body);var coverMissing=/灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け|璁剧疆灏侀潰\\s*\\*\\s*\\(蹇呭～\\)/.test(body);var dialog=itemize('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(item){return item.visible&&/灏侀潰|绔栧皝闈妯皝闈瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆妯皝闈AI灏侀潰/.test(item.text);}).sort(function(a,b){return (b.w*b.h)-(a.w*a.h);})[0];var buttons=itemize('button,[role=button],a,div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=30&&item.h>=18&&item.w<=260&&item.h<=90;});if(dialog){var confirm=buttons.filter(function(item){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(item.text);}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];if(confirm)return {ok:false,action:'confirm-cover-dialog',coverMissing:coverMissing,target:clickItem(confirm)};var horizontal=buttons.filter(function(item){return item.text==='璁剧疆妯皝闈?||item.text==='閫夋嫨灏侀潰'&&/妯皝闈妯増/.test(item.ctx);}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||b.y-a.y;})[0];if(horizontal)return {ok:false,action:'open-horizontal-cover',coverMissing:coverMissing,target:clickItem(horizontal)};var candidate=itemize('img,canvas,video').filter(function(item){return item.visible&&!item.disabled&&item.x>=dialog.x-40&&item.x<=dialog.x+dialog.w+40&&item.y>=dialog.y-40&&item.y<=dialog.y+dialog.h+40&&item.w>=50&&item.h>=50&&item.w<=620&&item.h<=620;}).sort(function(a,b){return a.y-b.y||a.x-b.x;})[0];if(candidate)return {ok:false,action:'select-cover-frame',coverMissing:coverMissing,target:clickItem(candidate)};return {ok:false,action:'cover-dialog-waiting',coverMissing:coverMissing,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|璁剧疆|鏆備笉/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}if(!hasCoverSection)return {ok:true,skipped:'no cover section'};if(!coverMissing)return {ok:true,coverMissing:false,reason:'cover ready'};var chooseButtons=buttons.filter(function(item){return item.text==='閫夋嫨灏侀潰'||/閫夋嫨灏侀潰/.test(item.text)&&/璁剧疆灏侀潰|绔栧皝闈妯皝闈灏侀潰缂哄け/.test(item.ctx);}).sort(function(a,b){return a.y-b.y||a.x-b.x;});if(chooseButtons.length){window.__douyinCommerceCoverChoiceIndex=window.__douyinCommerceCoverChoiceIndex||0;var target=chooseButtons[window.__douyinCommerceCoverChoiceIndex%chooseButtons.length];window.__douyinCommerceCoverChoiceIndex+=1;return {ok:false,action:'open-cover-picker',coverMissing:coverMissing,target:clickItem(target),choices:chooseButtons.map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}var tabTarget=buttons.filter(function(item){return /妯皝闈?:3|妯皝闈?.test(item.text)&&/妯皝闈㈢己澶眧妯猏\/绔栧弻灏侀潰缂哄け|灏侀潰缂哄け/.test(body);}).sort(function(a,b){return a.y-b.y||a.x-b.x;})[0];if(tabTarget)return {ok:false,action:'open-horizontal-tab',coverMissing:coverMissing,target:clickItem(tabTarget)};return {ok:false,coverMissing:coverMissing,reason:'閫夋嫨灏侀潰鎸夐挳鏈壘鍒?,buttons:buttons.filter(function(i){return /灏侀潰|纭畾|纭|瀹屾垚|鍙戝竷/.test(i.text+' '+i.ctx);}).slice(0,30).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};}),tail:body.slice(0,1200)};})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function textOf(el){return (el&&((el.innerText||el.textContent||el.alt||el.title)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}function contextText(el){var parts=[];var p=el;for(var i=0;i<6&&p;i+=1,p=p.parentElement){parts.push(textOf(p));}return parts.join(' ').slice(0,700);}function itemize(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),ctx:contextText(el),cls:String(el.className||'').slice(0,180),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});}function clickItem(item){item.el.scrollIntoView({block:'center',inline:'center'});item.el.click();return {index:item.index,tag:item.tag,text:item.text,ctx:item.ctx,cls:item.cls,x:item.x,y:item.y,w:item.w,h:item.h};}function pick(list){return list.filter(function(item){return item.visible&&!item.disabled&&item.w>=24&&item.h>=16;}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h)||b.y-a.y||b.x-a.x;})[0];}var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var knows=pick(itemize('button,[role=button],div,span').filter(function(item){return item.text==='鎴戠煡閬撲簡'&&item.w<150&&item.h<90;}));if(knows)knows.el.click();var hasCoverSection=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|绔栧皝闈妯皝闈妯珫灏侀潰/.test(body);var coverMissing=/灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け|璁剧疆灏侀潰\\s*\\*\\s*\\(蹇呭～\\)|璁剧疆灏侀潰/.test(body);var buttons=itemize('button,[role=button],a,div,span').filter(function(item){return item.visible&&!item.disabled&&item.w>=24&&item.h>=16&&item.w<=320&&item.h<=110;});var dialog=itemize('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(item){return item.visible&&/灏侀潰|绔栧皝闈妯皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(item.text);}).sort(function(a,b){return (b.w*b.h)-(a.w*a.h);})[0];if(dialog){var scoped=buttons.filter(function(item){return item.x>=dialog.x-50&&item.x<=dialog.x+dialog.w+50&&item.y>=dialog.y-50&&item.y<=dialog.y+dialog.h+50;});var setBoth=pick(scoped.filter(function(item){return /璁剧疆妯珫灏侀潰|妯珫灏侀潰|璁剧疆妯皝闈璁剧疆绔栧皝闈妯皝闈绔栧皝闈?.test(item.text)&&!/宸茶缃畖瀹屾垚/.test(item.text);}))||pick(buttons.filter(function(item){return /璁剧疆妯珫灏侀潰|妯珫灏侀潰|璁剧疆妯皝闈璁剧疆绔栧皝闈?.test(item.text);}));
if(setBoth)return {ok:false,action:'open-horizontal-vertical-cover',coverMissing:coverMissing,target:clickItem(setBoth)};
var candidate=itemize('img,canvas,video').filter(function(item){return item.visible&&!item.disabled&&item.x>=dialog.x-40&&item.x<=dialog.x+dialog.w+40&&item.y>=dialog.y-40&&item.y<=dialog.y+dialog.h+40&&item.w>=50&&item.h>=50&&item.w<=720&&item.h<=720;}).sort(function(a,b){return a.y-b.y||a.x-b.x;})[0];if(candidate&&!window.__douyinCommerceCoverFramePicked){window.__douyinCommerceCoverFramePicked=true;return {ok:false,action:'select-cover-frame',coverMissing:coverMissing,target:clickItem(candidate)}}var confirm=pick(scoped.filter(function(item){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(item.text);}))||pick(buttons.filter(function(item){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(item.text);}));if(confirm){window.__douyinCommerceCoverFramePicked=false;return {ok:false,action:'confirm-cover-dialog',coverMissing:coverMissing,target:clickItem(confirm)}}return {ok:false,action:'cover-dialog-waiting',coverMissing:coverMissing,buttons:scoped.filter(function(i){return /灏侀潰|妯珫|纭畾|纭|瀹屾垚|璁剧疆|鏆備笉/.test(i.text+' '+i.ctx);}).slice(0,40).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};})};}if(!hasCoverSection)return {ok:true,skipped:'no cover section'};if(!coverMissing&&!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return {ok:true,coverMissing:false,reason:'cover ready'};var openCover=pick(buttons.filter(function(item){return /^(璁剧疆灏侀潰|閫夋嫨灏侀潰)$/.test(item.text)||/璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(item.text)&&/灏侀潰缂哄け|妯皝闈绔栧皝闈璁剧疆灏侀潰/.test(item.ctx);}))||pick(buttons.filter(function(item){return /璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(item.text+' '+item.ctx);}));if(openCover){window.__douyinCommerceCoverFramePicked=false;return {ok:false,action:'open-cover-picker',coverMissing:coverMissing,target:clickItem(openCover)}}return {ok:false,coverMissing:coverMissing,reason:'璁剧疆灏侀潰鎸夐挳鏈壘鍒?,buttons:buttons.filter(function(i){return /灏侀潰|妯珫|纭畾|纭|瀹屾垚|鍙戝竷/.test(i.text+' '+i.ctx);}).slice(0,40).map(function(i){return {text:i.text,ctx:i.ctx,x:i.x,y:i.y,w:i.w,h:i.h};}),tail:body.slice(0,1200)};})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}function dis(e){return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(e.className||'')))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(' ').slice(0,600)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function pick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=24&&o.h>=16}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||b.y-a.y||b.x-a.x})[0]}function click(o){o.e.scrollIntoView({block:'center',inline:'center'});o.e.click();return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}var body=txt(document.body);var btns=all('button,[role=button],a,div,span').filter(function(o){return o.v&&!o.d&&o.w>=24&&o.h>=16&&o.w<=340&&o.h<=120});var known=pick(btns.filter(function(o){return o.t==='鎴戠煡閬撲簡'}));if(known)known.e.click();var has=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈妯珫灏侀潰/.test(body);if(!has)return{ok:true,skipped:'no cover section'};var dialog=all('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];if(dialog){var scoped=btns.filter(function(o){return o.x>=dialog.x-60&&o.x<=dialog.x+dialog.w+60&&o.y>=dialog.y-60&&o.y<=dialog.y+dialog.h+60});var set=pick(scoped.filter(function(o){return /璁剧疆妯珫灏侀潰|妯珫灏侀潰|璁剧疆妯皝闈璁剧疆绔栧皝闈?.test(o.t)&&!/宸茶缃畖瀹屾垚/.test(o.t)}))||pick(btns.filter(function(o){return /璁剧疆妯珫灏侀潰|妯珫灏侀潰|璁剧疆妯皝闈璁剧疆绔栧皝闈?.test(o.t)}));if(set)return{ok:false,action:'set-both-cover',target:click(set)};var img=all('img,canvas,video').filter(function(o){return o.v&&o.x>=dialog.x-40&&o.x<=dialog.x+dialog.w+40&&o.y>=dialog.y-40&&o.y<=dialog.y+dialog.h+40&&o.w>=50&&o.h>=50&&o.w<=760&&o.h<=760}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];if(img&&!window.__dyCoverPicked){window.__dyCoverPicked=true;return{ok:false,action:'pick-frame',target:click(img)}}var ok=pick(scoped.filter(function(o){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(o.t)}))||pick(btns.filter(function(o){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(o.t)}));if(ok){window.__dyCoverPicked=false;return{ok:false,action:'confirm-cover',target:click(ok)}}return{ok:false,action:'cover-dialog-wait',buttons:scoped.filter(function(o){return /灏侀潰|妯珫|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+' '+o.c)}).slice(0,30).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}})}}var open=pick(btns.filter(function(o){return /^(璁剧疆灏侀潰|閫夋嫨灏侀潰)$/.test(o.t)||/璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(o.t)&&/灏侀潰缂哄け|妯皝闈绔栧皝闈璁剧疆灏侀潰/.test(o.c)}))||pick(btns.filter(function(o){return /璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(o.t+' '+o.c)}));if(open){window.__dyCoverPicked=false;return{ok:false,action:'open-cover',target:click(open)}}if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:'cover ready'};return{ok:false,reason:'璁剧疆灏侀潰鎸夐挳鏈壘鍒?,buttons:btns.filter(function(o){return /灏侀潰|妯珫|纭畾|纭|瀹屾垚|鍙戝竷/.test(o.t+' '+o.c)}).slice(0,30).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}),tail:body.slice(0,1200)}})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}function dis(e){return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(e.className||'')))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(' ').slice(0,700)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function pick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.x-b.x||a.y-b.y})[0]}function click(o){o.e.scrollIntoView({block:'center',inline:'center'});o.e.click();return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}var body=txt(document.body);var btns=all('button,[role=button],a,div,span').filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14&&o.w<=360&&o.h<=140});var known=pick(btns.filter(function(o){return o.t==='鎴戠煡閬撲簡'}));if(known)known.e.click();var has=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰/.test(body);if(!has)return{ok:true,skipped:'no cover section'};var dialog=all('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];if(dialog){var scoped=btns.filter(function(o){return o.x>=dialog.x-70&&o.x<=dialog.x+dialog.w+70&&o.y>=dialog.y-70&&o.y<=dialog.y+dialog.h+70});var horizontal=pick(scoped.filter(function(o){return /^妯皝闈?|妯皝闈\s*4:3|妯皝闈?.test(o.t)&&!/宸茶缃畖瀹屾垚|鐢熸垚/.test(o.t)}))||pick(scoped.filter(function(o){return /妯皝闈?.test(o.t+' '+o.c)&&!/宸茶缃畖瀹屾垚|鐢熸垚/.test(o.t)}));if(horizontal&&!window.__dyHorizontalCoverDone){window.__dyHorizontalCoverDone=true;window.__dyCoverPicked=false;return{ok:false,action:'click-horizontal-cover',target:click(horizontal)}}var genVertical=pick(scoped.filter(function(o){return /鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈绔栧皝闈?.test(o.t)&&!/宸茬敓鎴恷瀹屾垚/.test(o.t)}))||pick(scoped.filter(function(o){return /鐢熸垚绔栧皝闈绔栧皝闈?.test(o.t+' '+o.c)&&!/宸茬敓鎴恷瀹屾垚/.test(o.t)}));if(genVertical&&!window.__dyVerticalCoverDone){window.__dyVerticalCoverDone=true;return{ok:false,action:'generate-vertical-cover',target:click(genVertical)}}var img=all('img,canvas,video').filter(function(o){return o.v&&o.x>=dialog.x-40&&o.x<=dialog.x+dialog.w+40&&o.y>=dialog.y-40&&o.y<=dialog.y+dialog.h+40&&o.w>=50&&o.h>=50&&o.w<=760&&o.h<=760}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];if(img&&!window.__dyCoverPicked){window.__dyCoverPicked=true;return{ok:false,action:'pick-frame',target:click(img)}}var ok=pick(scoped.filter(function(o){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(o.t)}))||pick(btns.filter(function(o){return /^(纭畾|纭|瀹屾垚|淇濆瓨|涓嬩竴姝浣跨敤|搴旂敤)$/.test(o.t)}));if(ok){window.__dyCoverPicked=false;return{ok:false,action:'confirm-cover',target:click(ok)}}return{ok:false,action:'cover-dialog-wait',buttons:scoped.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+' '+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}})}}var open=pick(btns.filter(function(o){return /^(璁剧疆灏侀潰|閫夋嫨灏侀潰)$/.test(o.t)||/璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(o.t)&&/灏侀潰缂哄け|妯皝闈绔栧皝闈璁剧疆灏侀潰/.test(o.c)}))||pick(btns.filter(function(o){return /璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(o.t+' '+o.c)}));if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:'open-cover',target:click(open)}}if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:'cover ready'};return{ok:false,reason:'璁剧疆灏侀潰鎸夐挳鏈壘鍒?,buttons:btns.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|鍙戝竷/.test(o.t+' '+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}),tail:body.slice(0,1200)}})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0}function dis(e){return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(e.className||'')))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(' ').slice(0,700)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function click(o){o.e.scrollIntoView({block:'center',inline:'center'});o.e.click();return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}function smallPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.x-b.x||a.y-b.y})[0]}function actionPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=40&&o.h>=24}).sort(function(a,b){return b.y-a.y||b.x-a.x||b.w*b.h-a.w*a.h})[0]}var body=txt(document.body);var btns=all('button,[role=button],a,div,span').filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14&&o.w<=380&&o.h<=150});var known=smallPick(btns.filter(function(o){return o.t==='鎴戠煡閬撲簡'}));if(known)known.e.click();var has=/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰/.test(body);if(!has)return{ok:true,skipped:'no cover section'};var dialog=all('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];if(dialog){var scoped=btns.filter(function(o){return o.x>=dialog.x-70&&o.x<=dialog.x+dialog.w+70&&o.y>=dialog.y-70&&o.y<=dialog.y+dialog.h+70});var done=actionPick(scoped.filter(function(o){return /^(瀹屾垚|纭畾|纭|淇濆瓨|浣跨敤|搴旂敤)$/.test(o.t)}));if(done){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:'finish-cover',target:click(done)}}var toVertical=actionPick(scoped.filter(function(o){return /^(璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?$/.test(o.t)}))||actionPick(scoped.filter(function(o){return /璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?.test(o.t)&&o.y>dialog.y+dialog.h*0.55}));if(toVertical){window.__dyVerticalCoverDone=true;return{ok:false,action:'set-vertical-cover',target:click(toVertical)}}var horizontal=smallPick(scoped.filter(function(o){return /^(妯皝闈璁剧疆妯皝闈?$/.test(o.t)||/妯皝闈\s*4:3/.test(o.t)}));if(horizontal&&!window.__dyHorizontalCoverDone){window.__dyHorizontalCoverDone=true;return{ok:false,action:'select-horizontal-tab',target:click(horizontal)}}var img=all('img,canvas,video').filter(function(o){return o.v&&o.x>=dialog.x-40&&o.x<=dialog.x+dialog.w+40&&o.y>=dialog.y-40&&o.y<=dialog.y+dialog.h+40&&o.w>=50&&o.h>=50&&o.w<=760&&o.h<=760}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];if(img&&!window.__dyCoverPicked){window.__dyCoverPicked=true;return{ok:false,action:'pick-frame',target:click(img)}}return{ok:false,action:'cover-dialog-wait',buttons:scoped.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+' '+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}})}}var open=smallPick(btns.filter(function(o){return /^(璁剧疆灏侀潰|閫夋嫨灏侀潰)$/.test(o.t)&&/妯皝闈4:3|灏侀潰缂哄け|璁剧疆灏侀潰/.test(o.c)}))||smallPick(btns.filter(function(o){return /^(璁剧疆灏侀潰|閫夋嫨灏侀潰)$/.test(o.t)||/璁剧疆灏侀潰|閫夋嫨灏侀潰/.test(o.t)&&/灏侀潰缂哄け|妯皝闈绔栧皝闈璁剧疆灏侀潰/.test(o.c)}));if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:'open-horizontal-cover',target:click(open)}}if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:'cover ready'};return{ok:false,reason:'璁剧疆灏侀潰鎸夐挳鏈壘鍒?,buttons:btns.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|鍙戝竷/.test(o.t+' '+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h}}),tail:body.slice(0,1200)}})()`;
  }

  function douyinCommerceCoverScript() {
    return `(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function dis(e){return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(e.className||'')))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(' | ').slice(0,700)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),cls:String(e.className||''),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function recalc(o){var r=o.e.getBoundingClientRect();o.x=Math.round(r.x);o.y=Math.round(r.y);o.w=Math.round(r.width);o.h=Math.round(r.height);o.v=vis(o.e);return o}function fire(o){o.e.scrollIntoView({block:'center',inline:'center'});recalc(o);var x=o.x+o.w/2,y=o.y+o.h/2;var hit=document.elementFromPoint(x,y)||o.e;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});if(hit!==o.e)try{o.e.click()}catch(e){}return{text:o.t,ctx:o.c,cls:o.cls.slice(0,120),x:Math.round(x),y:Math.round(y),hit:txt(hit),hitCls:String(hit.className||'').slice(0,120),box:{x:o.x,y:o.y,w:o.w,h:o.h}}}function actionPick(a){return a.filter(function(o){return !o.d&&o.w>=40&&o.h>=24}).sort(function(a,b){return b.y-a.y||b.x-a.x||b.w*b.h-a.w*a.h})[0]}var body=txt(document.body);var btns=all('button,[role=button],a,div,span').filter(function(o){return !o.d&&o.w>=20&&o.h>=14&&o.w<=420&&o.h<=180});if(!/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰/.test(body))return{ok:true,skipped:'no cover section'};var dialog=all('[role=dialog],.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];if(dialog){var scoped=btns.filter(function(o){return o.x>=dialog.x-80&&o.x<=dialog.x+dialog.w+80&&o.y>=dialog.y-80&&o.y<=dialog.y+dialog.h+80});var done=actionPick(scoped.filter(function(o){return /^(瀹屾垚|纭畾|纭|淇濆瓨|浣跨敤|搴旂敤)$/.test(o.t)}));if(done){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:'finish-cover',target:fire(done)}}var toVertical=actionPick(scoped.filter(function(o){return /^(璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?$/.test(o.t)}))||actionPick(scoped.filter(function(o){return /璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?.test(o.t)&&o.y>dialog.y+dialog.h*0.55}));if(toVertical)return{ok:false,action:'set-vertical-cover',target:fire(toVertical)};return{ok:false,action:'cover-dialog-wait',buttons:scoped.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+' '+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,80)}})}}var cards=all('div').filter(function(o){return /coverControl/i.test(o.cls)&&/閫夋嫨灏侀潰\\s*妯皝闈?:3/.test(o.t)&&o.w>=120&&o.h>=100}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)});var open=cards[0];if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:'open-horizontal-cover',target:fire(open)}}if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:'cover ready'};return{ok:false,reason:'妯皝闈㈠崱鐗囨湭鎵惧埌',scrollY:scrollY,cards:all('div').filter(function(o){return /cover|灏侀潰/i.test(o.cls+' '+o.t+' '+o.c)}).slice(0,40).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,100)}}),tail:body.slice(0,1200)}})()`;
  }

  function douyinCommerceCoverScript() {
    return [
      '(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||"")||"").trim().replace(/\\s+/g," ")}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function dis(e){return !!(e.disabled||e.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(e.className||"")))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(" | ").slice(0,500)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),cls:String(e.className||""),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function recalc(o){var r=o.e.getBoundingClientRect();o.x=Math.round(r.x);o.y=Math.round(r.y);o.w=Math.round(r.width);o.h=Math.round(r.height);o.v=vis(o.e);return o}function fire(o){o.e.scrollIntoView({block:"center",inline:"center"});recalc(o);var x=o.x+o.w/2,y=o.y+o.h/2;var hit=document.elementFromPoint(x,y)||o.e;["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{o.e.click()}catch(e){}return{text:o.t,ctx:o.c,cls:o.cls.slice(0,120),x:Math.round(x),y:Math.round(y),hit:txt(hit),hitCls:String(hit.className||"").slice(0,120),box:{x:o.x,y:o.y,w:o.w,h:o.h}}}function smallPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.x-b.x||a.y-b.y})[0]}function actionPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=40&&o.h>=24}).sort(function(a,b){return b.y-a.y||b.x-a.x||b.w*b.h-a.w*a.h})[0]}function inBox(o,b,p){p=p||80;return o.x>=b.x-p&&o.x<=b.x+b.w+p&&o.y>=b.y-p&&o.y<=b.y+b.h+p}var body=txt(document.body);var btns=all("button,[role=button],a,div,span").filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14&&o.w<=430&&o.h<=180});var known=smallPick(btns.filter(function(o){return o.t==="鎴戠煡閬撲簡"}));if(known)known.e.click();if(/灏侀潰鏁堟灉妫€娴嬮€氳繃|缂栬緫灏侀潰/.test(body)&&!/閫夋嫨灏侀潰|灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け/.test(body))return{ok:true,coverReady:true,reason:"cover ready"};if(!/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰/.test(body))return{ok:true,skipped:"no cover section"};',
      'var dialog=all("[role=dialog],.dy-creator-content-modal-wrap,.dy-creator-content-modal,.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]").filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];if(dialog){var scoped=btns.filter(function(o){return inBox(o,dialog,90)});var modalText=dialog.t+" "+scoped.map(function(o){return o.t+" "+o.c}).join(" ");var bottomVertical=actionPick(scoped.filter(function(o){return /^(璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?$/.test(o.t)&&o.y>dialog.y+dialog.h*0.55}));if(bottomVertical&&!window.__dyVerticalCoverDone){window.__dyVerticalCoverDone=true;return{ok:false,action:"set-vertical-cover",target:fire(bottomVertical)}}var verticalTab=smallPick(scoped.filter(function(o){return o.t==="璁剧疆绔栧皝闈?&&o.y<dialog.y+80&&!/active/.test(o.cls)}));if(verticalTab&&!window.__dyVerticalCoverDone){window.__dyVerticalCoverDone=true;return{ok:false,action:"set-vertical-cover-tab",target:fire(verticalTab)}}var done=actionPick(scoped.filter(function(o){return /^(瀹屾垚|纭畾|纭|淇濆瓨|浣跨敤|搴旂敤)$/.test(o.t)}));if(done){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"finish-cover",target:fire(done)}}var generating=/鐢熸垚涓瓅姝ｅ湪鐢熸垚|澶勭悊涓瓅璇风◢鍊檤鍔犺浇涓?.test(modalText);if(generating)return{ok:false,action:"wait-vertical-cover-generating",generating:true};return{ok:false,action:"cover-dialog-wait",buttons:scoped.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+" "+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,80)}})}};',
      'var cards=all("div").filter(function(o){return /閫夋嫨灏侀潰\\s*妯皝闈?:3/.test(o.t)&&o.w>=120&&o.h>=100&&o.w<=220&&o.h<=190}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)});var open=cards.find(function(o){return /coverControl|cover|wrapper|content-upload/i.test(o.cls)})||cards[0];if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover",target:fire(open)}}if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:"cover ready"};return{ok:false,reason:"妯皝闈㈠崱鐗囨湭鎵惧埌",scrollY:scrollY,cards:all("div").filter(function(o){return /妯皝闈绔栧皝闈閫夋嫨灏侀潰|cover/i.test(o.cls+" "+o.t+" "+o.c)}).slice(0,24).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,100)}}),tail:body.slice(0,800)}})()'
    ].join('');
  }

  function douyinCommerceCoverScript() {
    return [
      '(function(){',
      'function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title)||"")||"").trim().replace(/\\s+/g," ")}',
      'function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function dis(e){return !!(e.disabled||e.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(e.className||"")))}',
      'function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(" | ").slice(0,700)}',
      'function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),cls:String(e.className||""),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'function recalc(o){var r=o.e.getBoundingClientRect();o.x=Math.round(r.x);o.y=Math.round(r.y);o.w=Math.round(r.width);o.h=Math.round(r.height);o.v=vis(o.e);return o}',
      'function fire(o){try{o.e.scrollIntoView({block:"center",inline:"center"})}catch(e){}recalc(o);var x=o.x+o.w/2,y=o.y+o.h/2;var hit=document.elementFromPoint(x,y)||o.e;["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{o.e.click()}catch(e){}return{text:o.t,ctx:o.c,cls:o.cls.slice(0,120),x:Math.round(x),y:Math.round(y),hit:txt(hit),hitCls:String(hit.className||"").slice(0,120),box:{x:o.x,y:o.y,w:o.w,h:o.h}}}',
      'function fixedClick(x,y){var hit=document.elementFromPoint(x,y);if(!hit)return null;["pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click()}catch(e){}return{text:txt(hit),cls:String(hit.className||"").slice(0,120),x:x,y:y}}',
      'function actionPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=34&&o.h>=20}).sort(function(a,b){return b.y-a.y||b.x-a.x||b.w*b.h-a.w*a.h})[0]}',
      'function smallPick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=20&&o.h>=14}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x})[0]}',
      'function inBox(o,b,p){p=p||80;return o.x>=b.x-p&&o.x<=b.x+b.w+p&&o.y>=b.y-p&&o.y<=b.y+b.h+p}',
      'var body=txt(document.body);',
      'var buttons=all("button,[role=button],a,div,span").filter(function(o){return o.v&&!o.d&&o.w>=18&&o.h>=12&&o.w<=460&&o.h<=190});',
      'var known=smallPick(buttons.filter(function(o){return o.t==="鎴戠煡閬撲簡"}));if(known)known.e.click();',
      'if(/灏侀潰鏁堟灉妫€娴嬮€氳繃|缂栬緫灏侀潰/.test(body)&&!/閫夋嫨灏侀潰|璁剧疆灏侀潰|灏侀潰缂哄け|妯猏\/绔栧弻灏侀潰缂哄け/.test(body))return{ok:true,coverReady:true,reason:"cover ready"};',
      'if(!/璁剧疆灏侀潰|閫夋嫨灏侀潰|灏侀潰缂哄け|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰/.test(body))return{ok:true,skipped:"no cover section"};',
      'var dialog=all("[role=dialog],.dy-creator-content-modal-wrap,.dy-creator-content-modal,.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]").filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈鐢熸垚绔栧皝闈妯珫灏侀潰|瑁佸壀|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];',
      'if(dialog){var scoped=buttons.filter(function(o){return inBox(o,dialog,90)});var done=actionPick(scoped.filter(function(o){return /^(瀹屾垚|纭畾|纭|淇濆瓨|浣跨敤|搴旂敤)$/.test(o.t)}));if(done){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"finish-cover",target:fire(done)}}var vertical=actionPick(scoped.filter(function(o){return /^(璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?$/.test(o.t)}))||actionPick(scoped.filter(function(o){return /璁剧疆绔栧皝闈鐢熸垚绔栧皝闈鑷姩鐢熸垚绔栧皝闈?.test(o.t)&&o.y>dialog.y+dialog.h*0.45}));if(vertical){window.__dyVerticalCoverDone=true;return{ok:false,action:"set-vertical-cover",target:fire(vertical)}}var img=all("img,canvas,video").filter(function(o){return o.v&&inBox(o,dialog,40)&&o.w>=50&&o.h>=50&&o.w<=760&&o.h<=760}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];if(img&&!window.__dyCoverPicked){window.__dyCoverPicked=true;return{ok:false,action:"pick-frame",target:fire(img)}}return{ok:false,action:"cover-dialog-wait",buttons:scoped.filter(function(o){return /灏侀潰|妯獆绔東鐢熸垚|纭畾|纭|瀹屾垚|璁剧疆/.test(o.t+" "+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,80)}})}}',
      'var cards=all("div,button,[role=button]").filter(function(o){var s=o.t+" "+o.c+" "+o.cls;return /(閫夋嫨灏侀潰|璁剧疆灏侀潰|灏侀潰|cover|content-upload|wrapper)/i.test(s)&&/(妯皝闈4\\s*:?\\s*3|coverControl|cover)/i.test(s)&&o.w>=60&&o.h>=40&&o.w<=660&&o.h<=300}).sort(function(a,b){var ac=/coverControl|cover|content-upload/i.test(a.cls)?0:1;var bc=/coverControl|cover|content-upload/i.test(b.cls)?0:1;return ac-bc||(a.w*a.h)-(b.w*b.h)||a.y-b.y});',
      'var open=cards[0];if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover",target:fire(open)}}',
      'var direct=actionPick(buttons.filter(function(o){var s=o.t+" "+o.c;return /(閫夋嫨灏侀潰|璁剧疆灏侀潰)/.test(s)&&/(妯皝闈4\\s*:?\\s*3|灏侀潰缂哄け|璁剧疆灏侀潰)/.test(s)}));if(direct){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover",target:fire(direct)}}',
      'var fx=Math.min(430,innerWidth-80),fy=Math.min(245,innerHeight-80);var fixed=fixedClick(fx,fy);if(fixed){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover-fixed-point",target:fixed}}',
      'if(!/灏侀潰缂哄け|璁剧疆灏侀潰/.test(body))return{ok:true,coverMissing:false,reason:"cover ready"};',
      'return{ok:false,reason:"cover entry not found",cards:all("div,button,[role=button]").filter(function(o){return /妯皝闈绔栧皝闈閫夋嫨灏侀潰|璁剧疆灏侀潰|cover/i.test(o.cls+" "+o.t+" "+o.c)}).slice(0,36).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,100)}}),tail:body.slice(0,900)}})()'
    ].join('');
  }

  function douyinCommerceCoverScript() {
    return [
      '(function(){',
      'function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title||e.getAttribute&&e.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function dis(e){return !!(e.disabled||e.getAttribute("aria-disabled")==="true"||/disabled|disable|loading/.test(String(e.className||"")))}',
      'function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(" | ").slice(0,700)}',
      'function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),cls:String(e.className||""),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}',
      'function fire(o){try{o.e.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=o.e.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);var hit=document.elementFromPoint(x,y)||o.e;["pointermove","mousemove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{o.e.click()}catch(e){}return{text:o.t,ctx:o.c,cls:o.cls.slice(0,120),x:x,y:y,hit:txt(hit),hitCls:String(hit.className||"").slice(0,120),box:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}}',
      'function pick(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=18&&o.h>=12}).sort(function(a,b){return b.y-a.y||b.x-a.x||b.w*b.h-a.w*a.h})[0]}',
      'function small(a){return a.filter(function(o){return o.v&&!o.d&&o.w>=18&&o.h>=12}).sort(function(a,b){return(a.w*a.h)-(b.w*b.h)||a.y-b.y||a.x-b.x})[0]}',
      'function inside(o,b,p){p=p||80;return o.x>=b.x-p&&o.x<=b.x+b.w+p&&o.y>=b.y-p&&o.y<=b.y+b.h+p}',
      'var body=txt(document.body);',
      'var editCoverCount=(body.match(/\\u7f16\\u8f91\\u5c01\\u9762/g)||[]).length;',
      'if(editCoverCount>=2&&!/\\u6a2a\\/\\u7ad6\\u53cc\\u5c01\\u9762\\u7f3a\\u5931|\\u5c01\\u9762\\u7f3a\\u5931/.test(body))return{ok:true,coverReady:true,reason:"both cover entries editable",editCoverCount:editCoverCount};',
      'if(!/\\u8bbe\\u7f6e\\u5c01\\u9762|\\u9009\\u62e9\\u5c01\\u9762|\\u5c01\\u9762\\u7f3a\\u5931|\\u6a2a\\u5c01\\u9762|\\u7ad6\\u5c01\\u9762|\\u7f16\\u8f91\\u5c01\\u9762/.test(body))return{ok:true,skipped:"no cover section"};',
      'var buttons=all("button,[role=button],a,div,span").filter(function(o){return o.v&&!o.d&&o.w>=18&&o.h>=12&&o.w<=520&&o.h<=220});',
      'var dialog=all("[role=dialog],.dy-creator-content-modal-wrap,.dy-creator-content-modal,.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]").filter(function(o){return o.v&&/\\u5c01\\u9762|\\u6a2a\\u5c01\\u9762|\\u7ad6\\u5c01\\u9762|\\u88c1\\u526a|\\u786e\\u5b9a|\\u786e\\u8ba4|\\u5b8c\\u6210|\\u8bbe\\u7f6e|\\u751f\\u6210/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)})[0];',
      'if(dialog){var scoped=buttons.filter(function(o){return inside(o,dialog,90)});var vertical=pick(scoped.filter(function(o){return /\\u8bbe\\u7f6e\\u7ad6\\u5c01\\u9762|\\u751f\\u6210\\u7ad6\\u5c01\\u9762|\\u81ea\\u52a8\\u751f\\u6210\\u7ad6\\u5c01\\u9762/.test(o.t+" "+o.c)}));if(vertical&&!window.__dyVerticalCoverDone){window.__dyVerticalCoverDone=true;return{ok:false,action:"set-vertical-cover",target:fire(vertical)}}var img=all("img,canvas,video").filter(function(o){return o.v&&inside(o,dialog,40)&&o.w>=50&&o.h>=50&&o.w<=760&&o.h<=760}).sort(function(a,b){return a.y-b.y||a.x-b.x})[0];if(img&&!window.__dyCoverPicked){window.__dyCoverPicked=true;return{ok:false,action:"pick-frame",target:fire(img)}}var done=pick(scoped.filter(function(o){return /^(\\u5b8c\\u6210|\\u786e\\u5b9a|\\u786e\\u8ba4|\\u4fdd\\u5b58|\\u4f7f\\u7528|\\u5e94\\u7528)$/.test(o.t)}));if(done&&(window.__dyVerticalCoverDone||!vertical)){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"finish-cover",target:fire(done)}}return{ok:false,action:"cover-dialog-wait",buttons:scoped.filter(function(o){return /\\u5c01\\u9762|\\u6a2a|\\u7ad6|\\u751f\\u6210|\\u786e\\u5b9a|\\u786e\\u8ba4|\\u5b8c\\u6210|\\u8bbe\\u7f6e/.test(o.t+" "+o.c)}).slice(0,35).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,80)}})}}',
      'var cards=all("div,button,[role=button]").filter(function(o){var s=o.t+" "+o.c+" "+o.cls;return /\\u9009\\u62e9\\u5c01\\u9762|\\u8bbe\\u7f6e\\u5c01\\u9762|\\u7f16\\u8f91\\u5c01\\u9762|cover|content-upload|wrapper/i.test(s)&&/\\u6a2a\\u5c01\\u9762|4\\s*:?\\s*3|coverControl|content-upload/i.test(s)&&o.x<620&&o.y<420&&o.w>=50&&o.h>=35&&o.w<=360&&o.h<=240}).sort(function(a,b){var ac=/coverControl|content-upload|upload/i.test(a.cls)?0:1;var bc=/coverControl|content-upload|upload/i.test(b.cls)?0:1;return ac-bc||(a.w*a.h)-(b.w*b.h)||a.y-b.y});',
      'var open=cards[0];if(open){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover",target:fire(open)}}',
      'var direct=small(buttons.filter(function(o){var s=o.t+" "+o.c;return /\\u9009\\u62e9\\u5c01\\u9762|\\u8bbe\\u7f6e\\u5c01\\u9762|\\u7f16\\u8f91\\u5c01\\u9762/.test(s)&&/\\u6a2a\\u5c01\\u9762|4\\s*:?\\s*3|\\u5c01\\u9762\\u7f3a\\u5931/.test(s)&&o.x<620&&o.y<420}));if(direct){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:false,action:"open-horizontal-cover",target:fire(direct)}}',
      'if(!/\\u5c01\\u9762\\u7f3a\\u5931|\\u8bbe\\u7f6e\\u5c01\\u9762/.test(body))return{ok:true,coverMissing:false,reason:"cover ready"};',
      'return{ok:false,reason:"cover entry not found",editCoverCount:editCoverCount,cards:all("div,button,[role=button]").filter(function(o){return /\\u6a2a\\u5c01\\u9762|\\u7ad6\\u5c01\\u9762|\\u9009\\u62e9\\u5c01\\u9762|\\u8bbe\\u7f6e\\u5c01\\u9762|cover/i.test(o.cls+" "+o.t+" "+o.c)}).slice(0,36).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,100)}}),tail:body.slice(0,900)}})()'
    ].join('');
  }

  function douyinCommerceForceCoverEntryScript() {
    return [
      '(function(){',
      'function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title||e.getAttribute&&e.getAttribute("aria-label"))||"")||"").trim().replace(/\\s+/g," ")}',
      'function box(e){var r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}}',
      'function visible(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}',
      'function fireAt(x,y){var hit=document.elementFromPoint(x,y);if(!hit)return null;var chain=[],p=hit;for(var i=0;i<5&&p;i++,p=p.parentElement)chain.push({text:txt(p),cls:String(p.className||"").slice(0,140),box:box(p)});["pointermove","mousemove","pointerdown","mousedown","pointerup","mouseup","click"].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{hit.click()}catch(e){}return{hitText:txt(hit),hitCls:String(hit.className||"").slice(0,160),hitBox:box(hit),chain:chain}}',
      'function fireEl(el){try{el.scrollIntoView({block:"center",inline:"center"})}catch(e){}var r=el.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);return fireAt(x,y)}',
      'var elems=Array.from(document.querySelectorAll("div,button,[role=button],img,canvas,video")).filter(visible).map(function(e){var r=e.getBoundingClientRect();var s=txt(e)+" "+String(e.className||"");return{el:e,text:txt(e),cls:String(e.className||""),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),score:(/cover|upload|preview|card|wrapper|control/i.test(s)?0:20)+Math.abs((r.x+r.width/2)-430)/30+Math.abs((r.y+r.height/2)-245)/30}});',
      'var card=elems.filter(function(o){return o.x>=250&&o.x<=560&&o.y>=90&&o.y<=360&&o.w>=90&&o.h>=80&&o.w<=320&&o.h<=260}).sort(function(a,b){return a.score-b.score||b.w*b.h-a.w*a.h})[0];',
      'if(card)return{ok:false,action:"force-open-cover-card",method:"element-near-fixed-card",target:{text:card.text,cls:card.cls.slice(0,160),x:card.x,y:card.y,w:card.w,h:card.h},clicked:fireEl(card.el),url:location.href,tail:txt(document.body).slice(-500)};',
      'var points=[[430,245],[430,270],[380,245],[500,245],[430,210]];var clicked=[];for(var i=0;i<points.length;i++){var p=points[i];clicked.push({point:p,result:fireAt(Math.min(p[0],innerWidth-20),Math.min(p[1],innerHeight-20))});}',
      'return{ok:false,action:"force-open-cover-card",method:"fixed-points",clicked:clicked,url:location.href,tail:txt(document.body).slice(-500)}',
      '})()'
    ].join('');
  }

  async function ensureDouyinCommerceCover(prefix, session, combined) {
    let last = null;
    let stuckCount = 0;
    if (combined.job_id) await updateJobProgress(combined.job_id, '等待封面入口', '视频上传完成，等待页面稳定后打开封面选择');
    combined.stdout += '\n$ wait douyin commerce cover settle local sleep 20s\n';
    await waitMs(20000);
    await evalBrowserJson(prefix, session, 'douyin commerce force click cover card', douyinCommerceForceCoverEntryScript(), combined, 60000);
    if (combined.job_id) await updateJobProgress(combined.job_id, '等待封面弹窗', '封面入口已点击，等待弹窗响应');
    combined.stdout += '\n$ wait douyin commerce cover card after force click local sleep 10s\n';
    await waitMs(10000);
    for (let i = 0; i < 18; i += 1) {
      last = await evalBrowserJson(prefix, session, 'douyin commerce select cover ' + (i + 1), douyinCommerceCoverScript(), combined, 60000);
      if (combined.browser_crashed) return last;
      const data = last.data || {};
      if (data.ok) return last;
      const action = String(data.action || data.reason || '');
      if (action === 'finish-cover') {
        combined.stdout += '\ncover finished by clicking complete button\n';
        return last;
      }
      if (/generating|cover-dialog-wait|waiting|wait/.test(action)) stuckCount += 1;
      else stuckCount = 0;
      if (stuckCount >= 5) {
        await resetDouyinCommerceCoverDialog(prefix, session, combined, i + 1, data);
        stuckCount = 0;
      }
      const waitSeconds = /generate|generating|cover-dialog-wait|waiting|wait/.test(String(data.action || '')) ? '30' : '10';
      if (combined.job_id) await updateJobProgress(combined.job_id, '等待封面处理 ' + (i + 1), '封面处理中，等待 ' + waitSeconds + ' 秒');
      combined.stdout += '\n$ wait douyin commerce cover step ' + (i + 1) + ' local sleep ' + waitSeconds + 's\n';
      await waitMs(Number(waitSeconds) * 1000);
    }
    combined.code = 1;
    combined.cover_warning = stringify(last && last.data || {});
    combined.stderr += '\n抖音封面自动选择未完成：' + combined.cover_warning;
    return last;
  }

  async function refocusDouyinCommerceForm(prefix, session, combined) {
    const script = String.raw`(function(){
      function txt(e){return(e&&((e.innerText||e.textContent)||'')||'').trim().replace(/\s+/g,' ')}
      var body=txt(document.body);
      var anchor=Array.from(document.querySelectorAll('div,section,label,span')).find(function(el){return /作品描述|添加标签|扩展信息/.test(txt(el));});
      if(anchor){try{anchor.scrollIntoView({block:'center',inline:'center'})}catch(e){}}
      window.scrollTo(0, Math.max(0, document.documentElement.scrollTop - 260));
      body=txt(document.body);
      return {ok:/作品描述|添加标签|扩展信息/.test(body), tail:body.slice(-900), url:location.href};
    })()`;
    for (let i = 0; i < 5; i += 1) {
      const result = await evalBrowserJson(prefix, session, 'refocus douyin commerce form ' + (i + 1), script, combined, 60000);
      if (result.data && result.data.ok) return result;
      await runBrowserStep(combined, 'wait refocus douyin commerce form ' + (i + 1), prefix.concat(['browser', session, 'wait', 'time', '2']), 10000);
    }
    return null;
  }

  async function resetDouyinCommerceCoverDialog(prefix, session, combined, attempt, data) {
    combined.stderr += '\n封面弹窗疑似卡住，正在关闭后重新打开，第 ' + attempt + ' 步：' + stringify(data || {});
    const script = `(function(){function txt(e){return(e&&((e.innerText||e.textContent||e.alt||e.title||e.getAttribute&&e.getAttribute('aria-label'))||'')||'').trim().replace(/\\s+/g,' ')}function vis(e){if(!e)return false;var r=e.getBoundingClientRect(),s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}function dis(e){return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||/disabled|disable/.test(String(e.className||'')))}function ctx(e){var a=[],p=e;for(var i=0;i<5&&p;i++,p=p.parentElement)a.push(txt(p));return a.join(' | ').slice(0,500)}function all(q){return Array.from(document.querySelectorAll(q)).map(function(e,i){var r=e.getBoundingClientRect();return{e:e,i:i,t:txt(e),c:ctx(e),cls:String(e.className||''),v:vis(e),d:dis(e),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}})}function fire(o){try{o.e.scrollIntoView({block:'center',inline:'center'})}catch(e){}var r=o.e.getBoundingClientRect();var x=r.x+r.width/2,y=r.y+r.height/2;var hit=document.elementFromPoint(x,y)||o.e;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(type){hit.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window,clientX:x,clientY:y}))});try{o.e.click()}catch(e){}return{text:o.t,ctx:o.c,x:Math.round(x),y:Math.round(y),hit:txt(hit),cls:o.cls.slice(0,100)}}var body=txt(document.body);var dialogs=all('[role=dialog],.dy-creator-content-modal-wrap,.dy-creator-content-modal,.semi-modal,.semi-modal-content,[class*=modal],[class*=dialog]').filter(function(o){return o.v&&/灏侀潰|妯皝闈绔栧皝闈瑁佸壀|鐢熸垚|瀹屾垚|纭畾|纭/.test(o.t)}).sort(function(a,b){return(b.w*b.h)-(a.w*a.h)});var dialog=dialogs[0]||{x:0,y:0,w:innerWidth,h:innerHeight};var items=all('button,[role=button],a,div,span,svg').filter(function(o){return o.v&&!o.d&&o.w>=10&&o.h>=10&&o.w<=280&&o.h<=140});function inDialog(o,p){p=p||70;return o.x>=dialog.x-p&&o.x<=dialog.x+dialog.w+p&&o.y>=dialog.y-p&&o.y<=dialog.y+dialog.h+p}var scoped=items.filter(function(o){return inDialog(o,90)});var explicit=scoped.filter(function(o){return /^(鍙栨秷|鍏抽棴|杩斿洖|鏆備笉璁剧疆|鏆備笉|鏀惧純|閫€鍑簗脳|x|X)$/.test(o.t)||/close|modal-close|icon-close|semi-modal-close|suffix|clear/i.test(o.cls)||(/鍙栨秷|鍏抽棴|杩斿洖/.test(o.t+' '+o.c)&&/灏侀潰|妯獆绔東鐢熸垚|瑁佸壀/.test(o.c+body));}).sort(function(a,b){var ar=/close|modal-close|icon-close|semi-modal-close/i.test(a.cls)?0:1;var br=/close|modal-close|icon-close|semi-modal-close/i.test(b.cls)?0:1;return ar-br||b.y-a.y||b.x-a.x})[0];if(explicit){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:true,clicked:fire(explicit),method:'explicit-close'}}var lowerRight=scoped.filter(function(o){return o.x>dialog.x+dialog.w*0.55&&o.y>dialog.y+dialog.h*0.55&&(o.w<=90&&o.h<=90)&&(/脳|x|X|鍏抽棴|鍙栨秷/.test(o.t+' '+o.c)||/icon|close|svg|circle|remove/i.test(o.cls)||!o.t);}).sort(function(a,b){return b.y-a.y||b.x-a.x||a.w*a.h-b.w*b.h})[0];if(lowerRight){window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:true,clicked:fire(lowerRight),method:'bottom-right-close'}}document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));document.dispatchEvent(new KeyboardEvent('keyup',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true}));window.__dyHorizontalCoverDone=false;window.__dyVerticalCoverDone=false;window.__dyCoverPicked=false;return{ok:true,method:'escape',tail:body.slice(-600),dialog:dialog,buttons:scoped.filter(function(o){return /鍙栨秷|鍏抽棴|杩斿洖|灏侀潰|瀹屾垚|纭畾|鐢熸垚|脳|x/i.test(o.t+' '+o.c+' '+o.cls)}).slice(0,30).map(function(o){return{text:o.t,ctx:o.c,x:o.x,y:o.y,w:o.w,h:o.h,cls:o.cls.slice(0,80)}})}})()`;
    const reset = await evalBrowserJson(prefix, session, 'reset douyin commerce cover dialog ' + attempt, script, combined, 60000);
    await runBrowserStep(combined, 'wait douyin commerce cover reset ' + attempt, prefix.concat(['browser', session, 'wait', 'time', '3']), 12000);
    return reset;
  }

  async function clickDouyinCommercePublish(prefix, session, combined) {
    const script = `(function(){function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}var body=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');if(!/\\u5df2\\u6dfb\\u52a0\\u5546\\u54c1/.test(body))return {ok:false,reason:'product is not attached yet',url:location.href};var items=Array.from(document.querySelectorAll('button,[role=button],div,span')).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,text:textOf(el),cls:String(el.className||'').slice(0,160),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var target=items.filter(function(item){return item.visible&&!item.disabled&&item.text==='\\u53d1\\u5e03'&&item.w>=40&&item.w<=180&&item.h>=20&&item.h<=70;}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];if(!target)return {ok:false,reason:'publish button not found or disabled',url:location.href,buttons:items.filter(function(item){return /\\u53d1\\u5e03|\\u4fdd\\u5b58|\\u53d6\\u6d88|\\u5ba1\\u6838|\\u4e0a\\u4f20/.test(item.text)||/button|btn|publish|fixed/.test(item.cls);}).slice(-80).map(function(item){return {index:item.index,text:item.text,cls:item.cls,disabled:item.disabled,visible:item.visible,x:item.x,y:item.y,w:item.w,h:item.h};})};target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked_publish:true,commerce_ready:true,clicked:target.text,index:target.index,x:target.x,y:target.y,url:location.href};})()`;
    const clicked = await evalBrowserJson(prefix, session, 'douyin commerce click publish', script, combined, 60000);
    if (!clicked.data.ok) {
      combined.code = 1;
      combined.stderr += '\nDouyin commerce publish button click failed: ' + stringify(clicked.data);
    }
    return clicked;
  }

  function douyinCommercePublishConfirmScript() {
    return String.raw`(function(){
      function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\s+/g,' ');}
      function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}
      function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|disable|loading/.test(String(el.className||'')));}
      function itemize(selector){return Array.from(document.querySelectorAll(selector)).map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,text:textOf(el),cls:String(el.className||'').slice(0,160),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});}
      var body=(document.body&&document.body.innerText||'').replace(/\s+/g,' ');
      var url=location.href;
      var success=/发布成功|提交成功|作品已发布|审核中|发布已提交|发布完成|发布任务已提交|已发布/.test(body);
      var onManage=/\/content\/manage/.test(url)&&/作品管理|全部作品|已发布/.test(body);
      var publishEditor=/作品标题|填写作品标题|作品描述|设置封面|选择封面|添加标签|已添加商品/.test(body);
      var coverMissing=/封面缺失|横\/竖双封面缺失|设置封面\s*\*\s*\(必填\)|请选择封面/.test(body);
      var items=itemize('button,[role=button],div,span');
      var confirm=items.filter(function(item){return item.visible&&!item.disabled&&/^(确认发布|确定发布|继续发布|确认|确定|我知道了)$/.test(item.text)&&item.w>=40&&item.h>=20&&item.w<=220&&item.h<=90;}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];
      if(confirm){confirm.el.scrollIntoView({block:'center',inline:'center'});confirm.el.click();return {ok:false,action:'clicked-confirm-dialog',wait:true,url:url,clicked:confirm.text};}
      var publish=items.filter(function(item){return item.visible&&!item.disabled&&item.text==='发布'&&item.w>=40&&item.w<=180&&item.h>=20&&item.h<=70;}).sort(function(a,b){return b.y-a.y||b.x-a.x;})[0];
      if(success||onManage)return {ok:true,published:true,reason:onManage?'manage page':'success text',url:url};
      if(!publishEditor&&!publish)return {ok:true,published:true,reason:'left publish editor',url:url,tail:body.slice(-500)};
      if(coverMissing)return {ok:false,recoverable:true,coverMissing:true,reason:'发布后仍提示封面缺失',url:url,tail:body.slice(-800)};
      if(publish)return {ok:false,recoverable:true,stillOnPublish:true,reason:'发布后仍停在发布页，发布按钮仍可见',url:url,publishButton:{text:publish.text,x:publish.x,y:publish.y,w:publish.w,h:publish.h},tail:body.slice(-800)};
      return {ok:false,wait:true,reason:'等待发布结果',url:url,tail:body.slice(-800)};
    })()`;
  }

  async function confirmDouyinCommercePublished(prefix, session, combined) {
    let last = null;
    for (let i = 0; i < 8; i += 1) {
      await runBrowserStep(combined, 'wait douyin commerce publish confirm ' + (i + 1), prefix.concat(['browser', session, 'wait', 'time', i === 0 ? '5' : '4']), 12000);
      last = await evalBrowserJson(prefix, session, 'douyin commerce confirm publish ' + (i + 1), douyinCommercePublishConfirmScript(), combined, 60000);
      const data = last.data || {};
      if (data.ok && data.published) return last;
      if (data.coverMissing || (data.recoverable && data.stillOnPublish)) return last;
    }
    return last;
  }

  async function publishAndConfirmDouyinCommerce(row, commerce, prefix, session, combined) {
    let last = null;
    for (let publishTry = 1; publishTry <= 2; publishTry += 1) {
      if (publishTry > 1) {
        combined.stdout += '\n鍙戝竷鍚庝粛鍋滃湪缂栬緫椤碉紝寮€濮嬬 ' + publishTry + ' 娆″畨鍏ㄥ彂甯冪‘璁わ細鍏堥噸鏂扮‘璁ゅ皝闈㈠拰鎸傝溅鐘舵€侊紝鍐嶇偣涓€娆″彂甯冦€俓n';
        await runBrowserStep(combined, 'recover douyin commerce publish stall ' + publishTry, prefix.concat(['browser', session, 'wait', 'time', '3']), 12000);
        combined.code = 0;
        await ensureDouyinCommerceCover(prefix, session, combined);
        if (combined.code !== 0) return last;
        await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'verifyReady', 60000);
        if (combined.code !== 0) return last;
        await runBrowserStep(combined, 'retry douyin commerce final publish ' + publishTry, prefix.concat(['browser', session, 'wait', 'time', '2']), 10000);
      }
      const clicked = await clickDouyinCommercePublish(prefix, session, combined);
      if (combined.browser_crashed) return clicked;
      if (combined.code !== 0) return clicked;
      last = await confirmDouyinCommercePublished(prefix, session, combined);
      const data = last && last.data || {};
      if (data.ok && data.published) {
        combined.final_publish_clicked = true;
        combined.needs_confirm = false;
        combined.published = true;
        combined.result_url = data.url || combined.result_url || '';
        return last;
      }
      if (!(data.coverMissing || (data.recoverable && data.stillOnPublish)) || publishTry >= 2) break;
      combined.stderr += '\n发布后仍停留在发布页，允许一次安全重试：' + stringify(data);
    }
    const data = last && last.data || {};
    combined.final_publish_attempted = true;
    combined.code = 1;
    combined.published = false;
    combined.needs_confirm = true;
    combined.stderr += '\n最终发布已点击但未确认成功，已停止本条任务，避免重复点击或重复上传：' + stringify(data);
    return last;
  }

  async function runDouyinCommerceAttempt(row, videoPath, profileAlias, commerce, session, prefix, attempt, combined) {
    if (attempt > 1) {
      combined.code = 0;
      combined.stdout += '\n开始第 ' + attempt + ' 次完整发布尝试：重新打开发布页并重新上传视频。\n';
      await runBrowserStep(combined, 'reset douyin commerce page before retry ' + attempt, prefix.concat(['browser', session, 'open', platformIdleUrl('douyin')]), 60000);
      await runBrowserStep(combined, 'wait blank before retry ' + attempt, prefix.concat(['browser', session, 'wait', 'time', '2']), 10000);
      await runBrowserStep(combined, 'restart douyin commerce attempt ' + attempt, prefix.concat(['browser', session, 'open', platformUrl('douyin')]), 120000);
      await runBrowserStep(combined, 'wait restart page ' + attempt, prefix.concat(['browser', session, 'wait', 'time', '5']), 30000);
    }
    async function step(label, args, timeoutMs) {
      const result = await runBrowserStep(combined, label, args, timeoutMs);
      return result.code === 0;
    }
    if (attempt === 1) {
      await step('reset douyin commerce page before upload', prefix.concat(['browser', session, 'open', platformIdleUrl('douyin')]), 60000);
      await step('wait blank before upload', prefix.concat(['browser', session, 'wait', 'time', '2']), 10000);
      if (!await step('open douyin upload', prefix.concat(['browser', session, 'open', platformUrl('douyin')]), 120000)) return combined;
      if (!await step('wait page', prefix.concat(['browser', session, 'wait', 'time', '5']), 30000)) return combined;
    }
    const needsCover = shouldSetDouyinCommerceCover(row, profileAlias);
    const sizeExtraWaitLoops = videoSizeExtraWaitLoops(row, videoPath);
    if (sizeExtraWaitLoops > 0 && combined.job_id) {
      const extraSeconds = sizeExtraWaitLoops * 5;
      await updateJobProgress(row.id, '大视频等待', '视频超过 40MB，按文件大小额外等待约 ' + Math.ceil(extraSeconds / 60) + ' 分钟');
    }
    const platformUpload = await preparePlatformUploadVideo(root, row, videoPath);
    try {
      combined.stdout += '\n$ platform upload file prepared ' + platformUpload.path + ' ' + stringify(platformUpload.meta || {}) + '\n';
      const uploadResult = await runBrowserStep(combined, 'upload video', prefix.concat(['browser', session, 'upload', 'input[type=file]', platformUpload.path]), videoUploadTimeoutMs(row, videoPath));
      if (uploadResult.code !== 0) {
        combined.stdout += '\n上传命令返回异常，继续检查抖音发布页是否已经完成上传。\n';
        combined.code = 0;
      }
      await waitDouyinCommerceUploadReady(prefix, session, combined, {
        settleCoverAssets: needsCover,
        extraWaitLoops: sizeExtraWaitLoops + (attempt > 1 ? 6 : 0)
      });
    } finally {
      await platformUpload.cleanup();
    }
    if (combined.code !== 0) return combined;
    if (needsCover) {
      await ensureDouyinCommerceCover(prefix, session, combined);
      if (combined.code !== 0) return combined;
      await refocusDouyinCommerceForm(prefix, session, combined);
    } else {
      combined.stdout += '\n当前账号不需要自动设置封面，跳过封面选择步骤。\n';
      await updateJobProgress(row.id, '跳过封面', '当前账号不需要自动设置封面，继续填写文案和挂车');
    }
    await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'fillMain', 60000);
    if (combined.code !== 0) return combined;
    await refocusDouyinCommerceForm(prefix, session, combined);
    await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'openCartSelect', 60000);
    if (combined.code !== 0) return combined;
    await step('wait cart dropdown', prefix.concat(['browser', session, 'wait', 'time', '1']), 10000);
    await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'chooseCart', 60000);
    if (combined.code !== 0) return combined;
    await step('wait product link input', prefix.concat(['browser', session, 'wait', 'time', '1']), 8000);
    await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'addProduct', 60000);
    if (combined.code !== 0) return combined;
    let completedProduct = null;
    for (let productTry = 1; productTry <= 6; productTry += 1) {
      const modalWaitSeconds = productTry <= 3 ? '1' : (productTry <= 5 ? '2' : '3');
      await step('wait product modal ' + productTry, prefix.concat(['browser', session, 'wait', 'time', modalWaitSeconds]), (Number(modalWaitSeconds) + 6) * 1000);
      combined.code = 0;
      completedProduct = await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'completeProduct', 60000);
      if (combined.code === 0) break;
      if (productTry >= 6) return combined;
      if (completedProduct && completedProduct.data && completedProduct.data.waitingProductModal && completedProduct.data.linkEntryVisible) {
        combined.stderr += '\n商品编辑弹窗未出现，页面仍停在添加链接入口，重新点击添加链接后重试。';
        combined.code = 0;
        await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'addProduct', 60000);
        if (combined.code !== 0) return combined;
      } else {
        combined.stderr += '\n商品弹窗或商品卡片尚未稳定，短暂等待后重试。';
      }
    }
    await step('wait product attached', prefix.concat(['browser', session, 'wait', 'time', '3']), 15000);
    const ready = await runDouyinCommerceStage(row, commerce, prefix, session, combined, 'verifyReady', 60000);
    combined.commerce_ready = Boolean(ready.data && ready.data.commerce_ready);
    combined.result_url = ready.data && ready.data.url || '';
    if (combined.code !== 0) return combined;
    const skipFinalPublish = Boolean(commerce.skipFinalPublish || commerce.testOnly || commerce.dryRun);
    if (skipFinalPublish) {
      combined.needs_confirm = true;
      return combined;
    }
    await publishAndConfirmDouyinCommerce(row, commerce, prefix, session, combined);
    if (combined.published === true) {
      await runBrowserStep(combined, 'reset douyin commerce page after publish', prefix.concat(['browser', session, 'open', platformIdleUrl('douyin')]), 60000);
    }
    return combined;
  }

  function shouldSetDouyinCommerceCover(row, profileAlias) {
    const accountText = [
      profileAlias,
      row && row.profile_alias,
      row && row.account_id,
      row && row.account_name,
      row && row.platform_handle
    ].filter(Boolean).join(' ');
    return /dvabrcmr|楗崄涓億椋崄涓億fanshiqii|fan.?shi.?qi|youxia-bengbeng|vpu8aysj|游侠蹦蹦/i.test(accountText);
  }

  function canRestartDouyinCommerceAttempt(combined) {
    if (combined.final_publish_clicked) return false;
    const restartGuardText = String(combined.stderr || '') + '\n' + String(combined.stdout || '');
    if (/封面|灏侀潰|cover|上传完成|发布表单|作品描述|已挂车|已添加商品|commerce_ready|cover assets ready|Upload is ready|formReady/i.test(restartGuardText)) return false;
    const text = String(combined.stderr || '') + '\n' + String(combined.stdout || '');
    if (/最终发布已点击|避免重复|Final publish was clicked|avoid duplicate|may already be published/i.test(text)) return false;
    return /upload command failed before form ready|open douyin upload|wait page|timeout|OpenCLI|network|socket|Target closed/i.test(text);
  }

  function isDouyinCommercePageCrashed(combined) {
    const text = String(combined && combined.stderr || '') + '\n' + String(combined && combined.stdout || '');
    return /Target closed|Execution context was destroyed|Cannot find context|browser has been closed|Browser connection dropped|Page crashed|crash|WebSocket.*closed|Protocol error|Session closed|No current window|TIMEOUT|Browser profile .*not connected|chrome-error:\/\/|页面崩溃|标签页已崩溃/i.test(text);
  }

  async function recoverDouyinCommerceProfile(row, profileAlias, session, prefix, combined, attempt, reason) {
    const profileDirectory = chromeProfileDirectory(row.account_id, profileAlias);
    if (combined.job_id) {
      await updateJobProgress(combined.job_id, 'Profile 恢复', '检测到发布页异常，正在关闭整个 Profile 后从当前任务重新上传');
    }
    combined.stderr += '\n检测到发布页异常，关闭整个 Profile 后重新打开上传页（第 ' + attempt + ' 次尝试）：' + (reason || '');
    await closeBrowserSession(prefix, session, combined, 'close crashed douyin commerce session');
    const killed = await closeProfileDirectory(profileDirectory, 'recover douyin commerce job #' + (row.id || ''));
    combined.stdout += '\n$ kill chrome profile ' + (profileDirectory || '') + '\n' + stringify(killed) + '\n';
    await waitMs(3000);
    const launched = await ensureChromeProfileWindow(row.account_id, row.platform_id, profileAlias, { force: true });
    combined.stdout += '\n$ relaunch chrome profile after crash\n' + stringify(launched) + '\n';
    await waitMs(5000);
  }

  async function runDouyinCommerceJob(row, videoPath, profileAlias, commerce) {
    if (!cleanText(commerce && commerce.productUrl, 1000)) throw new Error('Commerce mode is missing product URL');
    if (!cleanCommerceProductText(commerce && commerce.productText, commerce)) throw new Error('Commerce mode is missing product copy');
    const session = ['commerce', row.platform_id, profileAlias || row.account_id || row.account_name || 'account', row.id || Date.now(), Date.now()]
      .join('-')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80);
    const prefix = [];
    prefix.push(...openCliProfileArgs(profileAlias));
    const combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: [], commerce_flow: true, job_id: row.id };
    combined.stdout += '\n甯﹁揣鍙戝竷涓婁笅鏂囷細account=' + (row.account_name || row.account_id || '') + ' profile=' + (profileAlias || '') + ' session=' + session + '\n';
    try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      combined.browser_crashed = false;
      await runDouyinCommerceAttempt(row, videoPath, profileAlias, commerce, session, prefix, attempt, combined);
      if (combined.code === 0 || combined.final_publish_clicked || attempt >= 2) break;
      const crashed = combined.browser_crashed || isDouyinCommercePageCrashed(combined);
      if (crashed && combined.final_publish_attempted) {
        combined.stderr += '\n最终发布动作后检测到浏览器崩坏，停止自动重传，避免重复发布。';
        break;
      }
      if (!crashed && !canRestartDouyinCommerceAttempt(combined)) break;
      const reason = crashed ? '页面崩溃/超时/Profile 未连接' : '发布前置流程失败';
      combined.stderr += '\n' + reason + '，关闭整个 Profile 后允许从当前任务重新上传重试一次。';
      await recoverDouyinCommerceProfile(row, profileAlias, session, prefix, combined, attempt + 1, reason);
    }
    } finally {
      if (combined.published === true) {
        await closeBrowserSession(prefix, session, combined, 'close douyin commerce session');
      } else {
        combined.stdout += '\n发布未确认成功，保留抖音发布页，方便继续检查或人工接管。\n';
      }
    }
    if (combined.code !== 0) return combined;
    if (!combined.needs_confirm) combined.published = true;
    return combined;
  }

  function publishButtonTexts(platformId, publishTime) {
    if (publishTime === 'draft') return ['Draft', 'Save draft'];
    if (platformId === 'bilibili') return ['Publish', 'Submit'];
    if (platformId === 'xiaohongshu') return ['Publish', 'Submit'];
    if (platformId === 'wechatVideo') return ['Publish', 'Submit'];
    return ['Publish', 'Submit'];
  }

  function uploadArgsForPlatform(platformId, prefix, session, videoPath) {
    if (platformId === 'bilibili') {
      return prefix.concat(['browser', session, 'upload', 'input[type=file]', '--nth', '0', videoPath]);
    }
    if (platformId === 'kuaishou' || platformId === 'xiaohongshu') {
      return prefix.concat(['browser', session, 'upload', 'input[type=file]', videoPath]);
    }
    return prefix.concat(['browser', session, 'upload', '--label', '涓婁紶', videoPath]);
  }

  async function runBrowserStep(combined, label, args, timeoutMs) {
    if (combined.job_id && isJobCancelled(combined.job_id)) {
      combined.code = -2;
      combined.stderr += '\nCANCELLED';
      return { code: -2, stdout: '', stderr: 'CANCELLED', duration_ms: 0, args };
    }
    if (combined.job_id) {
      await updateJobProgress(combined.job_id, label, stageLabel(label, combined));
    }
    combined.args.push(args || [label]);
    const running = combined.job_id ? runningJobState(combined.job_id) : null;
    const result = args
      ? await runOpenCli(args, {
        timeoutMs: timeoutMs || 5 * 60 * 1000,
        cwd: root,
        cancelCheck: combined.job_id ? () => isJobCancelled(combined.job_id) : null,
        onProcess: running ? proc => {
          running.procs.add(proc);
          proc.once('close', () => running.procs.delete(proc));
          proc.once('error', () => running.procs.delete(proc));
        } : null
      })
      : { code: 0, stdout: '', stderr: '', duration_ms: 0 };
    combined.stdout += '\n$ ' + label + (args ? ' ' + formatOpenCliCommand(args) : '') + '\n' + (result.stdout || '');
    combined.stderr += result.stderr ? '\n' + result.stderr : '';
    combined.duration_ms += result.duration_ms || 0;
    if (isBrowserCrashText((result.stdout || '') + '\n' + (result.stderr || ''))) {
      combined.browser_crashed = true;
      combined.code = result.code || 1;
      combined.stderr += '\n检测到浏览器页面/标签页崩坏，已停止当前自动发布步骤。';
      if (combined.job_id) {
        await updateJobProgress(combined.job_id, '浏览器页面崩坏', '检测到发布页或 Chrome 标签页已崩坏，请重新打开对应 Profile 后再继续');
      }
    }
    if (result.code !== 0) combined.code = result.code;
    return result;
  }

  async function closeBrowserSession(prefix, session, combined, label) {
    if (!session) return;
    const args = prefix.concat(['browser', session, 'close']);
    const result = await runOpenCli(args, { timeoutMs: 30000, cwd: root });
    if (combined) {
      combined.args = combined.args || [];
      combined.args.push(args);
      combined.stdout = (combined.stdout || '') + '\n$ ' + formatOpenCliCommand(args) + '\n' + (result.stdout || '');
      combined.stderr = (combined.stderr || '') + (result.stderr ? '\n' + result.stderr : '');
      combined.duration_ms = (combined.duration_ms || 0) + (result.duration_ms || 0);
      if (result.code !== 0) combined.stderr += '\n' + (label || 'browser session close') + ' failed: ' + openCliErrorText(result);
    }
  }

  async function evalBrowserJson(prefix, session, label, script, combined, timeoutMs) {
    const args = prefix.concat(['browser', session, 'eval', script]);
    const result = await runBrowserStep(combined, label, args, timeoutMs || 60000);
    const data = parseOpenCliJson(result.stdout) || {};
    const pageText = [
      data.url,
      data.title,
      data.reason,
      data.tail,
      data.text
    ].filter(Boolean).join('\n');
    if (isBrowserCrashText(pageText)) {
      combined.browser_crashed = true;
      combined.code = 1;
      combined.stderr += '\n检测到浏览器页面内容异常/崩坏：' + cleanText(pageText, 500);
      if (combined.job_id) {
        await updateJobProgress(combined.job_id, '浏览器页面崩坏', '发布页内容异常或标签页崩坏，已停止当前自动发布步骤');
      }
    }
    if (combined.job_id) await updateJobProgress(combined.job_id, label, stageLabel(label, combined, data));
    return { result, data };
  }

  function uploadReadyScript(platformId) {
    return `(function(){var platform=${JSON.stringify(platformId)};var text=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ');var running=/涓婁紶涓瓅褰撳墠閫熷害|鍓╀綑鏃堕棿|鍙栨秷涓婁紶/.test(text)||/宸茬粡涓婁紶锛歕\s*[\\d.]+MB\\s*\\/\\s*[\\d.]+MB/.test(text);var percent=(text.match(/(\\d{1,3})\\s*%/)||[])[1]||'';var ready=false;if(platform==='bilibili')ready=/绔嬪嵆鎶曠|瀛樿崏绋?.test(text)&&!running;if(platform==='kuaishou')ready=/鍙戝竷\\s*鍙栨秷|閲嶆柊涓婁紶/.test(text)&&!running;if(platform==='xiaohongshu')ready=/閲嶆柊涓婁紶|妫€娴嬩负楂樻竻瑙嗛|寮€濮嬫娴?.test(text)&&!running;return {ok:ready&&!running,uploadRunning:running,percent:percent,tail:text.slice(-500)};})()`;
  }

  async function waitPlatformUploadReady(platformId, prefix, session, combined, maxAttempts, waitSeconds) {
    let last = null;
    const attempts = maxAttempts || 80;
    const seconds = waitSeconds || 10;
    for (let i = 0; i < attempts; i += 1) {
      last = await evalBrowserJson(prefix, session, 'probe ' + platformId + ' upload ready ' + (i + 1), uploadReadyScript(platformId), combined, 60000);
      const data = last.data || {};
      if (data.ok) return last;
      if (i < attempts - 1) {
        await runBrowserStep(combined, 'wait ' + platformId + ' upload ready ' + (i + 1), prefix.concat(['browser', session, 'wait', 'time', String(seconds)]), (seconds + 5) * 1000);
      }
    }
    combined.code = 1;
    combined.stderr += '\n' + platformId + ' 涓婁紶鏈畬鎴愶紝宸茬瓑寰呰秴鏃讹細' + stringify(last && last.data || {});
    return last;
  }

  function setFieldScript(selector, value, contentEditable) {
    const safeValue = JSON.stringify(value || '');
    const set = contentEditable
      ? `el.innerHTML='';el.textContent=value;`
      : `if('value' in el) el.value=value; else el.textContent=value;`;
    return `var el=${selector};var ok=Boolean(el);if(el){var value=${safeValue};el.focus&&el.focus();${set}el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));}return ok;`;
  }

  async function fillBilibiliFields(row, prefix, session, combined) {
    const title = cleanText(row.title || row.video_name, 80);
    const caption = captionFor(row) || title;
    const tag = safeJson(row.tags, [])[0] || '鐢熸椿璁板綍';
    const script = `(function(){function pick(list, fn){for(var i=0;i<list.length;i++){if(fn(list[i]))return list[i];}return null;}function set(el,value){if(!el||!value)return false;el.focus&&el.focus();if('value'in el)el.value=value;else el.textContent=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}var inputs=Array.from(document.querySelectorAll('input'));var titleInput=pick(inputs,function(el){return /绋夸欢鏍囬|鏍囬/.test(el.placeholder||'')&&el.type!=='file';});var tagInput=pick(inputs,function(el){return /鍥炶溅閿畖鏍囩/.test(el.placeholder||'')&&el.type!=='file';});var editors=Array.from(document.querySelectorAll('[contenteditable=true]')).filter(function(el){var r=el.getBoundingClientRect();return r.width>100&&r.height>40;});var desc=editors[0];var okTitle=set(titleInput,${JSON.stringify(title)});var okDesc=set(desc,${JSON.stringify(caption)});var okTag=set(tagInput,${JSON.stringify(tag)});if(okTag&&tagInput){tagInput.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));tagInput.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',which:13,keyCode:13,bubbles:true}));}return {ok:okTitle,title:okTitle,description:okDesc,tag:okTag,titlePlaceholder:titleInput&&titleInput.placeholder,descFound:Boolean(desc),tagPlaceholder:tagInput&&tagInput.placeholder};})()`;
    const filled = await evalBrowserJson(prefix, session, 'fill bilibili fields', script, combined, 60000);
    if (!filled.data.ok) {
      combined.code = 1;
      combined.stderr += '\nB绔欐爣棰樺～鍐欏け璐ワ細' + stringify(filled.data);
    }
    return filled;
  }

  async function clickBilibiliSubmit(prefix, session, combined) {
    const script = `(function(){function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|forbid/.test(String(el.className||'')));}var raw=Array.from(document.querySelectorAll('button,[role=button],a,div,span'));var items=raw.map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),cls:String(el.className||'').slice(0,120),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var target=items.find(function(item){return item.visible&&!item.disabled&&item.text==='绔嬪嵆鎶曠'&&/submit-add|button|primary/.test(item.cls);})||items.find(function(item){return item.visible&&!item.disabled&&item.text==='绔嬪嵆鎶曠'&&item.w>=40&&item.w<=180&&item.h>=20&&item.h<=60;});if(!target){return {ok:false,reason:'B绔欑珛鍗虫姇绋挎寜閽湭鍑虹幇鎴栦笉鍙偣鍑?,buttons:items.filter(function(item){return /鎶曠|鑽夌|纭|纭畾|涓婁紶涓瓅鍙戝竷/.test(item.text)||/submit|button|btn/.test(item.cls);}).slice(-80).map(function(item){return {index:item.index,tag:item.tag,text:item.text.slice(0,120),cls:item.cls,disabled:item.disabled,visible:item.visible,x:item.x,y:item.y,w:item.w,h:item.h};})};}target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked:target.text,index:target.index};})()`;
    const submitted = await evalBrowserJson(prefix, session, 'click bilibili submit', script, combined, 60000);
    if (!submitted.data.ok) {
      combined.code = 1;
      combined.stderr += '\nB绔欐彁浜ゆ寜閽偣鍑诲け璐ワ細' + (submitted.data.reason || openCliErrorText(submitted.result)) + (submitted.data.buttons ? '\n' + stringify(submitted.data.buttons) : '');
    }
    return submitted;
  }

  async function fillXiaohongshuFields(row, prefix, session, combined) {
    const rawTitle = cleanTextChars(row.title || row.video_name, 120);
    const title = cleanTextChars(rawTitle, 20);
    const caption = captionFor(row) || rawTitle || title;
    const script = `(function(){function set(el,value){if(!el||!value)return false;el.focus&&el.focus();if('value'in el)el.value=value;else el.textContent=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));el.dispatchEvent(new Event('change',{bubbles:true}));return true;}var titleInput=Array.from(document.querySelectorAll('input')).find(function(el){return /鏍囬|鏇村璧?.test(el.placeholder||'')&&el.type!=='file';});var editor=document.querySelector('.tiptap.ProseMirror,[contenteditable=true]');var okTitle=set(titleInput,${JSON.stringify(title)});var okDesc=set(editor,${JSON.stringify(caption)});return {ok:okTitle,title:okTitle,description:okDesc,titlePlaceholder:titleInput&&titleInput.placeholder,editorFound:Boolean(editor)};})()`;
    const filled = await evalBrowserJson(prefix, session, 'fill xiaohongshu fields', script, combined, 60000);
    if (!filled.data.ok) {
      combined.code = 1;
      combined.stderr += '\n灏忕孩涔︽爣棰樺～鍐欏け璐ワ細' + stringify(filled.data);
    }
    return filled;
  }

  function xiaohongshuProbeScript(options) {
    const clickStartAudit = Boolean(options && options.clickStartAudit);
    return `(function(){var clickStartAudit=${clickStartAudit ? 'true' : 'false'};function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|forbid|disable/.test(String(el.className||'')));}var bodyText=document.body&&document.body.innerText||'';var uploadRunning=/涓婁紶涓瓅褰撳墠閫熷害|鍓╀綑鏃堕棿|鍙栨秷涓婁紶/.test(bodyText);var page=document.querySelector('.publish-page');if(page)page.scrollTop=page.scrollHeight;var audit=document.querySelector('#previewAuditPluginContainer,.pre-audit-plugin-container,.publish-page-assistant');var auditText=textOf(audit);var raw=Array.from(document.querySelectorAll('button,[role=button],a,div,span'));var items=raw.map(function(el,i){var r=el.getBoundingClientRect();var text=textOf(el);var cls=String(el.className||'');var actionable=el.tagName==='BUTTON'||el.getAttribute('role')==='button'||/button|btn|submit|publish|d-button|cancel|pass|audit/.test(cls);return {el:el,index:i,tag:el.tagName,text:text,cls:cls.slice(0,120),disabled:disabled(el),visible:visible(el),actionable:actionable,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var start=items.filter(function(item){return item.visible&&!item.disabled&&/^(寮€濮嬫娴媩閲嶆柊妫€娴?$/.test(item.text)&&item.w>0&&item.w<180&&item.h>0&&item.h<80;}).sort(function(a,b){return (a.w*a.h)-(b.w*b.h);})[0];var startedAudit=false;if(clickStartAudit&&!uploadRunning&&start){start.el.click();startedAudit=true;}var submitTexts=/^(鍙戝竷|鍙戣〃|鍙戝竷绗旇|绔嬪嵆鍙戝竷)$/;var targets=items.filter(function(item){return item.visible&&!uploadRunning&&item.x>220&&submitTexts.test(item.text)&&!/鍙戝竷绗旇\\s*棣栭〉/.test(item.text)&&item.w>20&&item.w<180&&item.h>20&&item.h<80;});var ready=targets.find(function(item){return !item.disabled;})||null;var blocked=targets.find(function(item){return item.disabled;})||null;var report=items.filter(function(item){return (item.text&&/鍙戝竷|鍙戣〃|妫€娴媩鍙栨秷|鎻愪氦|纭|涓婁紶|閲嶆柊涓婁紶/.test(item.text))||/submit|publish|audit|button|btn/.test(item.cls);}).slice(-120).map(function(item){return {index:item.index,tag:item.tag,text:item.text.slice(0,120),cls:item.cls,disabled:item.disabled,visible:item.visible,actionable:item.actionable,x:item.x,y:item.y,w:item.w,h:item.h};});var editor=document.querySelector('.tiptap.ProseMirror,[contenteditable=true]');var titleInput=Array.from(document.querySelectorAll('input')).find(function(el){return /鏍囬|鏇村璧?.test(el.placeholder||'')&&el.type!=='file';});return {ok:true,url:location.href,uploadRunning:uploadRunning,hasVideo:/閲嶆柊涓婁紶|妫€娴嬩负楂樻竻瑙嗛|\\.mp4|\\.mov/.test(bodyText),title:titleInput&&(titleInput.value||textOf(titleInput))||'',description:textOf(editor),auditText:auditText.slice(0,500),auditRunning:/妫€娴嬩腑|鑰愬績绛夊緟|鍙栨秷妫€娴?.test(auditText),auditPassed:/妫€娴嬪畬鎴恷妫€娴嬮€氳繃|鏈彂鐜伴棶棰榺鏆傛棤闂|閫氳繃/.test(auditText)&&!/妫€娴嬩腑|鑰愬績绛夊緟|鍙栨秷妫€娴?.test(auditText),auditBlocked:/杩濊|椋庨櫓|澶辫触|寮傚父|涓嶇鍚坾璇蜂慨鏀?.test(auditText),startedAudit:startedAudit,submitReady:Boolean(ready),submitDisabled:Boolean(blocked),submitCandidate:ready&&{index:ready.index,text:ready.text,cls:ready.cls,x:ready.x,y:ready.y,w:ready.w,h:ready.h},disabledSubmit:blocked&&{index:blocked.index,text:blocked.text,cls:blocked.cls,x:blocked.x,y:blocked.y,w:blocked.w,h:blocked.h},buttons:report};})()`;
  }

  async function waitXiaohongshuSubmitReady(prefix, session, combined) {
    let last = null;
    for (let i = 0; i < 13; i++) {
      last = await evalBrowserJson(prefix, session, 'probe xiaohongshu submit ' + (i + 1), xiaohongshuProbeScript({ clickStartAudit: i === 0 }), combined, 60000);
      const data = last.data || {};
      if (data.submitReady || data.auditBlocked) return last;
      if (i < 12 && (data.uploadRunning || data.startedAudit || data.auditRunning || !data.submitReady)) {
        await runBrowserStep(combined, 'wait xiaohongshu audit ' + (i + 1), prefix.concat(['browser', session, 'wait', 'time', data.uploadRunning || data.startedAudit || data.auditRunning ? '15' : '5']), 30000);
      }
    }
    return last;
  }

  async function clickXiaohongshuSubmit(prefix, session, combined) {
    const customScript = `(function(){function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}var el=document.querySelector('xhs-publish-btn');if(!el)return {ok:false,reason:'xhs-publish-btn not found'};var r=el.getBoundingClientRect();var disabled=el.getAttribute('submit-disabled')==='true'||el.getAttribute('submit-disabled')===''||el._props&&el._props.submitDisabled===true;if(!visible(el)||disabled)return {ok:false,reason:'xhs-publish-btn disabled or hidden',disabled:disabled,visible:visible(el),attrs:Array.from(el.attributes).map(function(a){return [a.name,a.value];}),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};if(typeof el._onPublish==='function'){el._onPublish();return {ok:true,clicked:'xhs-publish-btn._onPublish',x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}el.dispatchEvent(new CustomEvent('publish',{bubbles:true,composed:true}));return {ok:true,clicked:'xhs-publish-btn.publish-event',x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()`;
    const customSubmitted = await evalBrowserJson(prefix, session, 'click xiaohongshu custom submit', customScript, combined, 60000);
    if (customSubmitted.data && customSubmitted.data.ok) return customSubmitted;
    const script = `(function(){function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|forbid|disable/.test(String(el.className||'')));}var page=document.querySelector('.publish-page');if(page)page.scrollTop=page.scrollHeight;var raw=Array.from(document.querySelectorAll('button,[role=button],a,div,span'));var items=raw.map(function(el,i){var r=el.getBoundingClientRect();var text=textOf(el);var cls=String(el.className||'');var actionable=el.tagName==='BUTTON'||el.getAttribute('role')==='button'||/button|btn|submit|publish|d-button/.test(cls);return {el:el,index:i,tag:el.tagName,text:text,cls:cls.slice(0,120),disabled:disabled(el),visible:visible(el),actionable:actionable,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var target=items.find(function(item){return item.visible&&!item.disabled&&item.x>220&&/^(鍙戝竷|鍙戣〃|鍙戝竷绗旇|绔嬪嵆鍙戝竷)$/.test(item.text)&&item.w>20&&item.w<180&&item.h>20&&item.h<80;});if(!target){var audit=document.querySelector('#previewAuditPluginContainer,.pre-audit-plugin-container,.publish-page-assistant');var buttons=items.filter(function(item){return (item.text&&/鍙戝竷|鍙戣〃|妫€娴媩鍙栨秷|鎻愪氦|纭/.test(item.text))||/submit|publish|audit|button|btn/.test(item.cls);}).slice(-80).map(function(item){return {index:item.index,tag:item.tag,text:item.text.slice(0,120),cls:item.cls,disabled:item.disabled,visible:item.visible,actionable:item.actionable,x:item.x,y:item.y,w:item.w,h:item.h};});return {ok:false,reason:'灏忕孩涔﹀彂甯冩寜閽湭鍑虹幇鎴栦粛涓嶅彲鐐瑰嚮',auditText:textOf(audit).slice(0,500),buttons:buttons};}target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked:target.text,index:target.index,x:target.x,y:target.y};})()`;
    const submitted = await evalBrowserJson(prefix, session, 'click xiaohongshu submit', script, combined, 60000);
    if (!submitted.data.ok) {
      combined.code = 1;
      combined.stderr += '\n灏忕孩涔︽彁浜ゆ寜閽偣鍑诲け璐ワ細' + (submitted.data.reason || openCliErrorText(submitted.result)) + '\n' + stringify({
        auditText: submitted.data.auditText || '',
        buttons: submitted.data.buttons || []
      });
    }
    return submitted;
  }

  async function runBilibiliBrowserJob(row, videoPath, prefix, session) {
    const combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: [] };
    if ((await runBrowserStep(combined, 'open', prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]), 120000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait page', prefix.concat(['browser', session, 'wait', 'time', '3']), 30000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'upload video', uploadArgsForPlatform(row.platform_id, prefix, session, videoPath), 5 * 60 * 1000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait upload form', prefix.concat(['browser', session, 'wait', 'time', '12']), 30000)).code !== 0) return combined;
    await fillBilibiliFields(row, prefix, session, combined);
    if (combined.code !== 0 || row.publish_time === 'draft') return combined;
    await waitPlatformUploadReady(row.platform_id, prefix, session, combined, 80, 10);
    if (combined.code !== 0) return combined;
    await clickBilibiliSubmit(prefix, session, combined);
    return combined;
  }

  async function runXiaohongshuBrowserJob(row, videoPath, prefix, session) {
    const combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: [] };
    if ((await runBrowserStep(combined, 'open', prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]), 120000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait page', prefix.concat(['browser', session, 'wait', 'time', '5']), 30000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'upload video', uploadArgsForPlatform(row.platform_id, prefix, session, videoPath), 5 * 60 * 1000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait upload form', prefix.concat(['browser', session, 'wait', 'time', '20']), 30000)).code !== 0) return combined;
    await waitPlatformUploadReady(row.platform_id, prefix, session, combined, 80, 10);
    if (combined.code !== 0) return combined;
    await fillXiaohongshuFields(row, prefix, session, combined);
    if (combined.code !== 0 || row.publish_time === 'draft') return combined;
    const ready = await waitXiaohongshuSubmitReady(prefix, session, combined);
    const readyData = ready && ready.data || {};
    if (readyData.auditBlocked || (readyData.auditRunning && !readyData.submitReady)) {
      combined.code = 1;
      combined.stderr += '\nXiaohongshu pre-publish check failed: ' + stringify({
        auditText: readyData.auditText || '',
        submitReady: Boolean(readyData.submitReady),
        submitDisabled: Boolean(readyData.submitDisabled),
        buttons: readyData.buttons || []
      });
      return combined;
    }
    await clickXiaohongshuSubmit(prefix, session, combined);
    return combined;
  }

  async function clickKuaishouSubmit(prefix, session, combined) {
    const script = `(function(){function textOf(el){return (el&&((el.innerText||el.textContent)||'')||'').trim().replace(/\\s+/g,' ');}function visible(el){if(!el)return false;var r=el.getBoundingClientRect();var s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}function disabled(el){return !!(el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled|ant-btn-disabled|ant-btn-loading/.test(String(el.className||'')));}var raw=Array.from(document.querySelectorAll('button,[role=button],a,div,span'));var items=raw.map(function(el,i){var r=el.getBoundingClientRect();return {el:el,index:i,tag:el.tagName,text:textOf(el),cls:String(el.className||'').slice(0,140),disabled:disabled(el),visible:visible(el),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var target=items.find(function(item){return item.visible&&!item.disabled&&item.text==='\\u53d1\\u5e03'&&item.w>=70&&item.w<=140&&item.h>=28&&item.h<=52&&item.x>100;});if(!target){return {ok:false,reason:'Kuaishou publish button not found or disabled',buttons:items.filter(function(item){return /\\u53d1\\u5e03|\\u53d6\\u6d88|\\u7acb\\u5373\\u53d1\\u5e03|\\u5b9a\\u65f6\\u53d1\\u5e03|\\u4e0a\\u4f20|\\u91cd\\u65b0\\u4e0a\\u4f20/.test(item.text)||/button|btn|publish/.test(item.cls);}).slice(-100).map(function(item){return {index:item.index,tag:item.tag,text:item.text.slice(0,120),cls:item.cls,disabled:item.disabled,visible:item.visible,x:item.x,y:item.y,w:item.w,h:item.h};})};}target.el.scrollIntoView({block:'center',inline:'center'});target.el.click();return {ok:true,clicked:target.text,index:target.index};})()`;
    const submitted = await evalBrowserJson(prefix, session, 'click kuaishou submit', script, combined, 60000);
    if (!submitted.data.ok) {
      combined.code = 1;
      combined.stderr += '\nKuaishou submit button click failed: ' + (submitted.data.reason || openCliErrorText(submitted.result)) + (submitted.data.buttons ? '\n' + stringify(submitted.data.buttons) : '');
    }
    return submitted;
  }

  async function runKuaishouBrowserJob(row, videoPath, prefix, session) {
    const combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: [] };
    if ((await runBrowserStep(combined, 'open', prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]), 120000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait page', prefix.concat(['browser', session, 'wait', 'time', '3']), 30000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'upload video', uploadArgsForPlatform(row.platform_id, prefix, session, videoPath), 5 * 60 * 1000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'wait upload form', prefix.concat(['browser', session, 'wait', 'text', '涓婁紶鎴愬姛']), 5 * 60 * 1000)).code !== 0) return combined;
    if ((await runBrowserStep(combined, 'fill kuaishou description', prefix.concat(['browser', session, 'fill', '#work-description-edit', [cleanText(row.title || row.video_name, 80), captionFor(row)].filter(Boolean).join('\n\n')]), 60000)).code !== 0) return combined;
    if (row.publish_time === 'draft') return combined;
    await waitPlatformUploadReady(row.platform_id, prefix, session, combined, 60, 10);
    if (combined.code !== 0) return combined;
    await clickKuaishouSubmit(prefix, session, combined);
    return combined;
  }

  function browserPublishSteps(row, prefix, session, videoPath) {
    if (row.platform_id === 'kuaishou') {
      const steps = [
        prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]),
        prefix.concat(['browser', session, 'wait', 'time', '3']),
        uploadArgsForPlatform(row.platform_id, prefix, session, videoPath),
        prefix.concat(['browser', session, 'wait', 'text', '涓婁紶鎴愬姛']),
        prefix.concat(['browser', session, 'fill', '#work-description-edit', [cleanText(row.title || row.video_name, 80), captionFor(row)].filter(Boolean).join('\n\n')])
      ];
      if (row.publish_time !== 'draft') steps.push(prefix.concat(['browser', session, 'click', '--text', 'Publish']));
      return steps;
    }
    return [
      prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]),
      prefix.concat(['browser', session, 'wait', 'time', '3']),
      uploadArgsForPlatform(row.platform_id, prefix, session, videoPath),
      prefix.concat(['browser', session, 'wait', 'time', '8']),
      prefix.concat(['browser', session, 'fill', '--label', 'Title', cleanText(row.title || row.video_name, 80)]),
      prefix.concat(['browser', session, 'fill', '--label', 'Description', captionFor(row)])
    ];
  }

  async function runWechatVideoBrowserJob(row, videoPath, prefix, session) {
    const combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: [] };
    async function step(label, args, timeoutMs) {
      const result = await runBrowserStep(combined, label, args, timeoutMs);
      return result.code === 0;
    }

    if (!await step('open', prefix.concat(['browser', session, 'open', platformUrl(row.platform_id)]), 120000)) return combined;
    if (!await step('wait page', prefix.concat(['browser', session, 'wait', 'time', '10']), 30000)) return combined;

    let probe = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      probe = await probeWechatVideoPage(prefix, session);
      combined.args.push(['probeWechatVideoPage', attempt + 1]);
      combined.stdout += '\n$ probe wechatVideo page #' + (attempt + 1) + '\n' + stringify(probe.data);
      combined.stderr += probe.result.stderr ? '\n' + probe.result.stderr : '';
      combined.duration_ms += probe.result.duration_ms || 0;
      if (probe.ready || probe.data.hasLoginText) break;
      await step('wait upload input', prefix.concat(['browser', session, 'wait', 'time', '5']), 15000);
    }
    if (!probe.ready) {
      combined.code = 1;
      combined.stderr += '\n' + wechatVideoProbeMessage(probe);
      return combined;
    }

    const exposed = await exposeWechatVideoUpload(prefix, session);
    combined.args.push(['exposeWechatVideoUpload']);
    combined.stdout += '\n$ expose wechatVideo upload\n' + stringify(exposed.data);
    combined.stderr += exposed.result.stderr ? '\n' + exposed.result.stderr : '';
    combined.duration_ms += exposed.result.duration_ms || 0;
    if (exposed.result.code !== 0 || !exposed.data.ok) {
      combined.code = 1;
      combined.stderr += '\n瑙嗛鍙蜂笂浼犲叆鍙ｅ噯澶囧け璐ワ細' + (exposed.data.reason || openCliErrorText(exposed.result));
      return combined;
    }

    if (!await step('upload proxy', prefix.concat(['browser', session, 'upload', '#opencliWechatVideoProxy', videoPath]), 5 * 60 * 1000)) return combined;

    const committed = await commitWechatVideoUpload(prefix, session);
    combined.args.push(['commitWechatVideoUpload']);
    combined.stdout += '\n$ commit wechatVideo upload\n' + stringify(committed.data);
    combined.stderr += committed.result.stderr ? '\n' + committed.result.stderr : '';
    combined.duration_ms += committed.result.duration_ms || 0;
    if (committed.result.code !== 0 || !committed.data.ok) {
      combined.code = 1;
      combined.stderr += '\n瑙嗛鍙锋枃浠跺洖濉け璐ワ細' + (committed.data.reason || openCliErrorText(committed.result));
      return combined;
    }

    if (!await step('wait upload', prefix.concat(['browser', session, 'wait', 'time', '20']), 30000)) return combined;

    const filled = await fillWechatVideoFields(prefix, session, row);
    combined.args.push(['fillWechatVideoFields']);
    combined.stdout += '\n$ fill wechatVideo fields\n' + stringify(filled.data);
    combined.stderr += filled.result.stderr ? '\n' + filled.result.stderr : '';
    combined.duration_ms += filled.result.duration_ms || 0;

    if (row.publish_time === 'draft') return combined;

    const submitted = await clickWechatVideoSubmit(prefix, session, row.publish_time);
    combined.args.push(['clickWechatVideoSubmit']);
    combined.stdout += '\n$ click wechatVideo submit\n' + stringify(submitted.data);
    combined.stderr += submitted.result.stderr ? '\n' + submitted.result.stderr : '';
    combined.duration_ms += submitted.result.duration_ms || 0;
    if (submitted.result.code !== 0 || !submitted.data.ok) {
      combined.code = 1;
      combined.stderr += '\n瑙嗛鍙锋彁浜ゆ寜閽偣鍑诲け璐ワ細' + (submitted.data.reason || openCliErrorText(submitted.result)) + (submitted.data.buttons ? '\n' + stringify(submitted.data.buttons) : '');
      return combined;
    }
    await step('wait submit confirm', prefix.concat(['browser', session, 'wait', 'time', '3']), 15000);
    const confirmed = await confirmWechatVideoSubmit(prefix, session);
    combined.args.push(['confirmWechatVideoSubmit']);
    combined.stdout += '\n$ confirm wechatVideo submit\n' + stringify(confirmed.data);
    combined.stderr += confirmed.result.stderr ? '\n' + confirmed.result.stderr : '';
    combined.duration_ms += confirmed.result.duration_ms || 0;
    if (confirmed.result.code !== 0 || !confirmed.data.ok) {
      combined.code = 1;
      combined.stderr += '\n瑙嗛鍙蜂簩娆＄‘璁ゅ彂甯冨け璐ワ細' + (confirmed.data.reason || openCliErrorText(confirmed.result)) + (confirmed.data.buttons ? '\n' + stringify(confirmed.data.buttons) : '');
      return combined;
    }
    await step('wait submit done', prefix.concat(['browser', session, 'wait', 'time', '5']), 15000);
    return combined;
  }

  async function runBrowserPublishJob(row, videoPath, profileAlias) {
    const url = platformUrl(row.platform_id);
    if (!url) throw new Error('Unsupported platform for browser publish');
    const session = ['publish', row.platform_id, row.account_id || row.account_name || 'account', row.id || Date.now(), Date.now()]
      .join('-')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 80);
    const prefix = [];
    prefix.push(...openCliProfileArgs(profileAlias));
    let combined = null;
    try {
    if (row.platform_id === 'wechatVideo') {
      combined = await runWechatVideoBrowserJob(row, videoPath, prefix, session);
      return combined;
    }
    if (row.platform_id === 'kuaishou') {
      combined = await runKuaishouBrowserJob(row, videoPath, prefix, session);
      return combined;
    }
    if (row.platform_id === 'bilibili') {
      combined = await runBilibiliBrowserJob(row, videoPath, prefix, session);
      return combined;
    }
    if (row.platform_id === 'xiaohongshu') {
      combined = await runXiaohongshuBrowserJob(row, videoPath, prefix, session);
      return combined;
    }
    const steps = browserPublishSteps(row, prefix, session, videoPath);
    combined = { code: 0, stdout: '', stderr: '', duration_ms: 0, args: steps };
    for (let i = 0; i < steps.length; i += 1) {
      const args = steps[i];
      const result = await runOpenCli(args, { timeoutMs: 5 * 60 * 1000, cwd: root });
      combined.stdout += '\n$ ' + formatOpenCliCommand(args) + '\n' + result.stdout;
      combined.stderr += result.stderr ? '\n' + result.stderr : '';
      combined.duration_ms += result.duration_ms || 0;
      if (result.code !== 0) {
        combined.code = result.code;
        break;
      }
      if (row.platform_id === 'wechatVideo' && i === 1) {
        const probe = await probeWechatVideoPage(prefix, session);
        combined.args.push(['probeWechatVideoPage']);
        combined.stdout += '\n$ probe wechatVideo page\n' + stringify(probe.data);
        combined.stderr += probe.result.stderr ? '\n' + probe.result.stderr : '';
        combined.duration_ms += probe.result.duration_ms || 0;
        if (!probe.ready) {
          combined.code = 1;
          combined.stderr += '\n' + wechatVideoProbeMessage(probe);
          break;
        }
      }
    }
    if (combined.code === 0 && row.platform_id !== 'kuaishou' && row.publish_time !== 'draft') {
      const buttons = publishButtonTexts(row.platform_id, row.publish_time);
      let clicked = false;
      for (const text of buttons) {
        const args = prefix.concat(['browser', session, 'click', '--text', text]);
        combined.args.push(args);
        const result = await runOpenCli(args, { timeoutMs: 60 * 1000, cwd: root });
        combined.stdout += '\n$ ' + formatOpenCliCommand(args) + '\n' + result.stdout;
        combined.stderr += result.stderr ? '\n' + result.stderr : '';
        combined.duration_ms += result.duration_ms || 0;
        if (result.code === 0) {
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        combined.code = 1;
        combined.stderr += '\n鏈壘鍒板彲鐐瑰嚮鐨勫彂甯冩寜閽細' + buttons.join(' / ');
      }
    }
    return combined;
    } finally {
      await closeBrowserSession(prefix, session, combined, 'close browser publish session');
    }
  }

  async function executeJob(row) {
    const state = runningJobState(row.id);
    state.cancelled = false;
    state.procs.clear();
    const binding = await getBinding(row.account_id, row.platform_id);
    const profileAlias = await resolveProfileAlias(row.profile_alias || (binding && binding.profile_alias) || '');
    if (!profileAlias) throw new Error('未绑定 OpenCLI Profile');
    const videoPath = await ensureVideoPath(root, row);
    if (!videoPath) throw new Error('视频文件不存在，请从素材库选择或先上传视频');
    await updateJobStatus(row.id, 'publishing', '', '');
    await updateJobProgress(row.id, '准备发布', '正在拉起账号窗口并准备上传视频');
    return runWithProfileLock(profileAlias, async () => {
      const launched = await ensureChromeProfileWindow(row.account_id, row.platform_id, profileAlias);
      let result = null;
      try {
        result = row.platform_id === 'douyin'
          ? await runDouyinJob(row, videoPath, profileAlias)
          : await runBrowserPublishJob(row, videoPath, profileAlias);
        if (launched.ok) {
          result.stdout = '\n$ launch chrome profile ' + (launched.profile_directory || '') + '\n' + stringify({ ok: true, skipped: Boolean(launched.skipped), profile_directory: launched.profile_directory }) + '\n' + (result.stdout || '');
        } else {
          result.stderr = '\nChrome Profile 自动拉起失败：' + (launched.error || 'unknown') + '\n' + (result.stderr || '');
        }
        const ok = result.code === 0;
        if (isJobCancelled(row.id) || result.code === -2 || /CANCELLED/.test(String(result.stderr || ''))) {
          await updateJobStatus(row.id, 'cancelled', '用户已取消发布任务', '');
          await updateJobProgress(row.id, '已取消', '用户已取消发布任务，可从历史记录重新发布');
          logRun({
            job_id: row.id,
            account_id: row.account_id,
            platform_id: row.platform_id,
            profile_alias: profileAlias,
            action: 'cancel',
            status: 'cancelled',
            command: result.args,
            stdout: result.stdout,
            stderr: cleanOpenCliNoise(result.stderr),
            error: '用户已取消发布任务',
            duration_ms: result.duration_ms
          });
          return { ok: false, cancelled: true, status: 'cancelled', error: '用户已取消发布任务' };
        }
        const parsed = parseOpenCliJson(result.stdout) || {};
        const commerceFlow = Boolean(result.commerce_ready === true || parsed.commerce_ready === true || parsed.published === true);
        const needsConfirm = Boolean(result.needs_confirm || parsed.needs_confirm);
        const resultUrl = result.result_url || parsed.url || parsed.result_url || '';
        const errorText = ok ? '' : openCliErrorText(result, 'OpenCLI 执行失败');
        const nextStatus = ok
          ? (needsConfirm ? 'ready' : (row.publish_time === 'draft' ? 'draft' : (row.publish_time === 'schedule' ? 'scheduled' : 'published')))
          : 'failed';
        await updateJobStatus(row.id, nextStatus, errorText, resultUrl);
        await updateJobProgress(row.id, nextStatus, ok ? (needsConfirm ? '已挂车，停在最终发布前' : '发布流程已完成') : errorText);
        logRun({
          job_id: row.id,
          account_id: row.account_id,
          platform_id: row.platform_id,
          profile_alias: profileAlias,
          action: commerceFlow ? (needsConfirm ? 'opencli.douyin_commerce_ready' : 'opencli.douyin_commerce_publish') : (row.platform_id === 'douyin' && row.publish_time !== 'now' ? 'opencli.native' : 'opencli.browser_publish'),
          status: ok ? 'success' : 'failed',
          command: result.args,
          stdout: result.stdout,
          stderr: cleanOpenCliNoise(result.stderr),
          error: errorText,
          duration_ms: result.duration_ms
        });
        if (!ok) throw new Error(errorText);
        return { ok: true, status: nextStatus, result_url: resultUrl, commerce_ready: commerceFlow, needs_confirm: needsConfirm, stdout: result.stdout };
      } finally {
        if (result) result.stdout = (result.stdout || '') + '\n$ keep chrome profile open after job\n' + stringify({ ok: true, reason: 'normal job cleanup only closes the OpenCLI session tab' }) + '\n';
      }
    }).finally(() => {
      runningJobs.delete(Number(row.id));
    });
  }

  async function checkJobExecutable(row) {
    const binding = await getBinding(row.account_id, row.platform_id);
    const profileAlias = await resolveProfileAlias(row.profile_alias || (binding && binding.profile_alias) || '');
    const videoPath = await ensureVideoPath(root, row);
    const caps = platformCapabilities(row.platform_id);
    const checks = {
      profile: Boolean(profileAlias),
      login: binding ? binding.login_status === 'ready' : false,
      video: Boolean(videoPath),
      title: Boolean(cleanText(row.title || row.video_name, 120)),
      capability: row.publish_time === 'draft' ? Boolean(caps.browser_draft || caps.native_draft) : Boolean(caps.immediate_publish || caps.native_schedule),
      schedule: true
    };
    if (row.publish_time === 'schedule') {
      const min = now() + 2 * 60 * 60;
      const max = now() + 14 * 24 * 60 * 60;
      checks.schedule = row.platform_id === 'douyin' && row.scheduled_at >= min && row.scheduled_at <= max;
    }
    const reasons = [];
    if (!checks.profile) reasons.push('未绑定 OpenCLI Profile');
    if (!checks.login) {
      if (row.platform_id === 'wechatVideo' && binding && binding.login_status === 'blocked') {
        reasons.push('视频号已登录，但发布页被弹窗或账号切换提示卡住，上传入口未出现');
      } else {
        reasons.push('账号登录态未检查或不可用');
      }
    }
    if (!checks.video) reasons.push('视频文件不存在');
    if (!checks.title) reasons.push('缺少标题');
    if (!checks.capability) reasons.push('平台发布能力未配置');
    if (!checks.schedule) reasons.push('抖音定时发布必须在 2 小时到 14 天后');
    return {
      ok: reasons.length === 0,
      checks,
      reasons,
      profile_alias: profileAlias,
      video_path: videoPath,
      capabilities: caps
    };
  }

  let localQueueRunning = false;
  let localQueuePaused = false;

  async function dueQueueRows() {
    const db = getDb();
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM video_publish_jobs
         WHERE status='scheduled'
           AND publish_time='queue'
           AND scheduled_at>0
           AND scheduled_at<=?
         ORDER BY scheduled_at ASC, id ASC
         LIMIT 1`,
        [now()],
        function(err, rows) {
          db.close();
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  }

  function queuedRetryCount(row) {
    const text = String(row && row.error || '');
    const match = text.match(/\[auto-retry\s+(\d+)\/2\]/) || text.match(/鑷姩閲嶈瘯\((\d+)\/2\)/);
    return match ? Math.max(0, Number(match[1]) || 0) : 0;
  }

  function queueRetryDelaySeconds(row) {
    return 60;
  }

  function shouldRetryQueuedPublish(error) {
    const text = String(error || '');
    if (/用户已取消|cancelled|CANCELLED/i.test(text)) return false;
    if (/未绑定 OpenCLI Profile|视频文件不存在|缺少标题|账号登录态|not bound|missing/i.test(text)) return false;
    return true;
  }

  async function rescheduleQueuedJob(row, error) {
    const db = getDb();
    const retryCount = queuedRetryCount(row);
    const delay = shouldRetryQueuedPublish(error) && retryCount < 2 ? queueRetryDelaySeconds(row) : 0;
    if (!delay) {
      db.close();
      return false;
    }
    return new Promise(resolve => {
      const retryText = '[auto-retry ' + (retryCount + 1) + '/2] ' + error;
      db.run(
        'UPDATE video_publish_jobs SET status=?, error=?, scheduled_at=?, updated_at=? WHERE id=?',
        ['scheduled', cleanText(retryText, 1000), now() + delay, now(), row.id],
        function() {
          db.close();
          resolve(true);
        }
      );
    });
  }

  async function runDueLocalQueue() {
    if (localQueueRunning) return;
    if (localQueuePaused) return;
    localQueueRunning = true;
    try {
      if (localQueuePaused) return;
      const rows = await dueQueueRows();
      for (const row of rows) {
        if (localQueuePaused) break;
        try {
          await executeJob(row);
        } catch(e) {
          const retrying = await rescheduleQueuedJob(row, e.message || '');
          if (retrying) {
            await updateJobProgress(row.id, '等待自动重试', '正在等待自动重试');
          } else {
            await updateJobStatus(row.id, 'failed', e.message, '');
          }
          logRun({
            job_id: row.id,
            account_id: row.account_id,
            platform_id: row.platform_id,
            profile_alias: row.profile_alias,
            action: 'local-queue.execute',
            status: retrying ? 'retrying' : 'failed',
            error: e.message
          });
        }
      }
    } catch(e) {
      logger.warn('video publish local queue failed', e);
    } finally {
      localQueueRunning = false;
    }
  }

  const localQueueTimer = setInterval(() => {
    runDueLocalQueue();
  }, 30000);
  if (localQueueTimer.unref) localQueueTimer.unref();
  const localQueueBootTimer = setTimeout(() => runDueLocalQueue(), 5000);
  if (localQueueBootTimer.unref) localQueueBootTimer.unref();

  return {
    '/api/video-publish/accounts/list': async function(body, cb) {
      const includeProfiles = body.includeProfiles !== false;
      const db = getDb();
      db.all('SELECT * FROM video_publish_accounts ORDER BY account_name ASC, platform_name ASC', [], async function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        let profiles = [];
        if (includeProfiles) {
          profiles = await listOpenCliProfiles();
        }
        cb({
          ok: true,
          catalog_accounts: publishAccountCatalog(),
          accounts: (rows || []).map(row => ({
            id: row.id,
            account_id: row.account_id,
            account_name: row.account_name,
            platform_id: row.platform_id,
            platform_name: row.platform_name,
            platform_handle: row.platform_handle,
            profile_alias: row.profile_alias,
            login_status: row.login_status,
            last_checked_at: row.last_checked_at || 0,
            capabilities: safeJson(row.capabilities, platformCapabilities(row.platform_id)),
            created_at: row.created_at,
            updated_at: row.updated_at
          })),
          profiles
        });
      });
    },

    '/api/video-publish/accounts/save': function(body, cb) {
      saveAccountBinding(body, body._auth, cb);
    },

    '/api/video-publish/accounts/check-login': async function(body, cb) {
      const accountId = cleanText(body.account_id || body.accountId, 80);
      const platformId = cleanText(body.platform_id || body.platformId, 80);
      const profileAlias = cleanText(body.profile_alias || body.profileAlias, 120);
      if (!accountId || !platformId) { cb({ error: 'missing account/platform' }); return; }
      if (!profileAlias) { cb({ error: 'missing profile alias' }); return; }
      const commandByPlatform = {
        douyin: ['browser', 'publish-login-douyin', 'open', platformUrl('douyin')],
        bilibili: ['bilibili', 'me', '-f', 'json'],
        kuaishou: ['browser', 'publish-login-kuaishou', 'open', platformUrl('kuaishou')],
        xiaohongshu: ['browser', 'publish-login-xiaohongshu', 'open', platformUrl('xiaohongshu')],
        wechatVideo: ['browser', 'publish-login-wechatVideo', 'open', platformUrl('wechatVideo')]
      };
      const actualProfile = await resolveProfileAlias(profileAlias);
      const args = openCliProfileArgs(actualProfile).concat(commandByPlatform[platformId] || ['browser', 'publish-login-' + platformId, 'open', platformUrl(platformId) || 'about:blank']);
      const result = await runOpenCli(args, { timeoutMs: 120000, cwd: root });
      let loginStatus = result.code === 0 ? 'ready' : 'login';
      let probe = null;
      let error = result.code === 0 ? '' : openCliErrorText(result, 'login check failed');
      if (result.code === 0 && platformId === 'wechatVideo') {
        probe = await probeWechatVideoPage(openCliProfileArgs(actualProfile), 'publish-login-wechatVideo');
        loginStatus = probe.ready ? 'ready' : (probe.loggedIn ? 'blocked' : 'login');
        error = probe.ready ? '' : wechatVideoProbeMessage(probe);
      }
      await updateAccountLogin(accountId, platformId, loginStatus);
      logRun({
        account_id: accountId,
        platform_id: platformId,
        profile_alias: profileAlias,
        action: 'check-login',
        status: loginStatus === 'ready' ? 'success' : 'failed',
        command: args,
        stdout: result.stdout + (probe ? '\n$ probe wechatVideo page\n' + stringify(probe.data) : ''),
        stderr: result.stderr + (probe && probe.result.stderr ? '\n' + probe.result.stderr : ''),
        error,
        duration_ms: result.duration_ms + (probe && probe.result.duration_ms || 0)
      });
      cb({
        ok: true,
        ready: platformId === 'wechatVideo' && probe ? probe.ready : loginStatus === 'ready',
        login_status: loginStatus,
        stdout: result.stdout,
        stderr: result.stderr,
        probe: probe && probe.data || null,
        error
      });
    },

    '/api/video-publish/accounts/open-login': async function(body, cb) {
      const platformId = cleanText(body.platform_id || body.platformId, 80);
      const profileAlias = cleanText(body.profile_alias || body.profileAlias, 120);
      const url = platformUrl(platformId);
      if (!platformId || !url) { cb({ error: 'missing or unsupported platform' }); return; }
      if (!profileAlias) { cb({ error: 'missing profile alias' }); return; }
      const actualProfile = await resolveProfileAlias(profileAlias);
      const session = ('publish-login-' + platformId + '-' + actualProfile).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
      const args = openCliProfileArgs(actualProfile).concat(['browser', session, 'open', url]);
      const result = await runOpenCli(args, { timeoutMs: 60000, cwd: root });
      cb({ ok: result.code === 0, url, stdout: result.stdout, stderr: result.stderr, error: result.code === 0 ? '' : (result.stderr || result.stdout || 'open login failed') });
    },

    '/api/video-publish/accounts/launch-profile': async function(body, cb) {
      const accountId = cleanText(body.account_id || body.accountId, 80);
      const platformId = cleanText(body.platform_id || body.platformId || 'douyin', 80);
      const profileAlias = await resolveProfileAlias(cleanText(body.profile_alias || body.profileAlias, 120));
      const profileDirectory = chromeProfileDirectory(accountId, profileAlias);
      if (!profileDirectory) { cb({ ok: false, error: '鏈厤缃?Chrome Profile 鐩綍', profile_alias: profileAlias }); return; }
      const launched = await ensureChromeProfileWindow(accountId, platformId, profileAlias);
      cb(Object.assign({
        ok: Boolean(launched.ok),
        account_id: accountId,
        platform_id: platformId,
        profile_alias: profileAlias,
        profile_directory: profileDirectory,
        url: 'about:blank',
        skipped: Boolean(launched.skipped),
        reason: launched.reason || ''
      }, launched.ok ? {} : { error: launched.error || 'Chrome 鍚姩澶辫触' }));
    },

    '/api/video-publish/jobs': function(body, cb) {
      const auth = body._auth || {};
      const status = String(body.status || '').trim();
      const mineOnly = body.mineOnly !== false;
      const limit = Math.max(1, Math.min(200, Number(body.limit) || 80));
      const where = [];
      const args = [];
      if (status) {
        where.push('status=?');
        args.push(status);
      }
      if (mineOnly && auth.username) {
        where.push('user_name=?');
        args.push(auth.username);
      }
      const sql = 'SELECT * FROM video_publish_jobs' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY created_at DESC, id DESC LIMIT ?';
      args.push(limit);
      const db = getDb();
      db.all(sql, args, function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, jobs: (rows || []).map(normalizeRow) });
      });
    },

    '/api/video-publish/jobs/create': function(body, cb) {
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      const account = body.account || {};
      const platforms = Array.isArray(body.platforms) ? body.platforms : [];
      const videos = Array.isArray(body.videos) ? body.videos : [];
      const form = body.form || {};
      if (!userName) { cb({ error: 'missing user' }); return; }
      if (!videos.length) { cb({ error: 'missing videos' }); return; }
      if (!platforms.length) { cb({ error: 'missing platforms' }); return; }

      const ts = now();
      const batchId = crypto.randomBytes(8).toString('hex');
      const status = normalizeStatus(body.status || statusFromPublishTime(form));
      const baseScheduleTs = scheduledAt(form);
      const queueIntervalSec = Math.max(0, Math.min(1440, Number(form.queueIntervalMinutes) || 0)) * 60;
      const title = cleanText(form.title, 120);
      const description = cleanText(form.description, 2000);
      const tags = Array.isArray(form.tags)
        ? form.tags
        : String(form.tags || '').split(/[\s,锛?]+/).map(item => item.trim()).filter(Boolean).slice(0, 20);
      const options = {
        allowComment: form.allowComment !== false,
        allowShare: form.allowShare !== false,
        allowDownload: Boolean(form.allowDownload),
        project_delivery: body.project_delivery || null,
        raw: body.options || {}
      };

      const db = getDb();
      const created = [];
      let index = 0;
      const total = videos.length * platforms.length;

      function insertNext() {
        if (index >= total) {
          db.close();
          cb({ ok: true, batch_id: batchId, count: created.length, jobs: created });
          return;
        }
        const videoIndex = Math.floor(index / platforms.length);
        const video = videos[videoIndex] || {};
        const platform = platforms[index % platforms.length] || {};
        index += 1;
        const scheduleTs = form.publishTime === 'queue'
          ? Number(video.scheduled_at || video.scheduledAt || 0) || (baseScheduleTs ? baseScheduleTs + videoIndex * queueIntervalSec : 0)
          : baseScheduleTs;

        db.run(
          `INSERT INTO video_publish_jobs (
            batch_id,user_name,account_id,account_name,platform_id,platform_name,platform_handle,profile_alias,
            video_source,video_id,video_name,video_size,video_url,
            title,description,tags,cover_mode,visibility,publish_time,scheduled_at,options_json,status,error,result_url,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            batchId,
            userName,
            cleanText(account.id, 80),
            cleanText(account.name, 120),
            cleanText(platform.id, 80),
            cleanText(platform.name, 120),
            cleanText(platform.handle, 200),
            cleanText(platform.profile || platform.profile_alias || platform.profileAlias, 120),
            cleanText(video.source, 40),
            cleanText((body.project_delivery && body.project_delivery.task_id ? 'project-task-' + body.project_delivery.task_id + ':' : '') + (video.id || video.localId || ''), 120),
            cleanText(video.name || video.filename || video.original, 300),
            Number(video.size) || 0,
            cleanText(video.url || video.path || video.src, 1000),
            cleanText(video.title || title, 120),
            cleanText(video.description || description, 2000),
            stringify(tags),
            cleanText(form.coverMode || 'auto', 40),
            cleanText(form.visibility || 'public', 40),
            cleanText(form.publishTime || 'now', 40),
            scheduleTs,
            stringify(options),
            status,
            '',
            '',
            ts,
            ts
          ],
          function(err) {
            if (err) {
              db.close();
              cb({ error: err.message, created: created.length });
              return;
            }
            created.push({ id: this.lastID });
            insertNext();
          }
        );
      }

      insertNext();
    },

    '/api/video-publish/queue/status': function(body, cb) {
      const db = getDb();
      db.get(
        `SELECT
           SUM(CASE WHEN status='scheduled' AND publish_time='queue' THEN 1 ELSE 0 END) AS scheduled_count,
           MIN(CASE WHEN status='scheduled' AND publish_time='queue' THEN scheduled_at ELSE NULL END) AS next_scheduled_at,
           SUM(CASE WHEN status='publishing' THEN 1 ELSE 0 END) AS publishing_count
         FROM video_publish_jobs`,
        [],
        function(err, row) {
          db.close();
          if (err) { cb({ ok: false, error: err.message }); return; }
          cb({
            ok: true,
            paused: localQueuePaused,
            running: localQueueRunning,
            scheduled_count: Number(row && row.scheduled_count) || 0,
            next_scheduled_at: Number(row && row.next_scheduled_at) || 0,
            publishing_count: Number(row && row.publishing_count) || 0
          });
        }
      );
    },

    '/api/video-publish/queue/pause': function(body, cb) {
      localQueuePaused = body.paused !== false;
      cb({ ok: true, paused: localQueuePaused, running: localQueueRunning });
    },

    '/api/video-publish/videos/upload': function(body, cb) {
      try {
        const saved = saveBase64Video(root, body);
        cb({ ok: true, video: saved });
      } catch(e) {
        cb({ ok: false, error: e.message });
      }
    },

    '/api/video-publish/videos/transcribe': async function(body, cb) {
      const videoPath = resolveVideoUrlPath(root, body.url || body.video_url || body.path, body.filename || body.name);
      if (!videoPath) { cb({ ok: false, error: '视频文件不存在，请先上传视频' }); return; }
      try {
        const result = await transcribeVideoFile(root, videoPath);
        if (result.error || !result.text) {
          cb({ ok: false, error: result.error || '没有拿到可用转写文本' });
          return;
        }
        cb(result);
      } catch (e) {
        cb({ ok: false, error: e.message || '转写失败' });
      }
    },

    '/api/video-publish/jobs/update-status': function(body, cb) {
      const id = Number(body.id || 0);
      const status = normalizeStatus(body.status);
      const error = cleanText(body.error, 1000);
      const resultUrl = cleanText(body.result_url || body.resultUrl, 1000);
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      db.run(
        'UPDATE video_publish_jobs SET status=?, error=?, result_url=?, updated_at=? WHERE id=?',
        [status, error, resultUrl, now(), id],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ ok: true, updated: this.changes });
        }
      );
    },

    '/api/video-publish/jobs/cancel': async function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      const scope = jobUserScope(auth, body);
      const sql = 'SELECT * FROM video_publish_jobs WHERE id=?' + scope.sql;
      const args = [id].concat(scope.args);
      db.get(sql, args, async function(err, row) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        if (!row) { cb({ error: 'job not found' }); return; }
        const killed = requestCancelRunningJob(id);
        const binding = await getBinding(row.account_id, row.platform_id);
        const profileAlias = await resolveProfileAlias(row.profile_alias || (binding && binding.profile_alias) || '');
        await updateJobStatus(id, 'cancelled', '用户已取消发布任务', '');
        await updateJobProgress(id, '已取消', killed ? '已请求停止正在执行的发布任务，Chrome Profile 保持打开' : '任务已取消，未发现正在执行的子进程');
        logRun({
          job_id: id,
          account_id: row.account_id,
          platform_id: row.platform_id,
          profile_alias: profileAlias || row.profile_alias,
          action: 'cancel',
          status: 'cancelled',
          stdout: stringify({ killed, profile_closed: false, reason: 'cancel no longer closes Chrome Profile' }),
          error: killed ? '用户已取消发布任务，已停止运行中的子进程' : '用户已取消发布任务'
        });
        cb({ ok: true, id, killed, profile_closed: false });
      });
    },

    '/api/video-publish/jobs/run': function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      const scope = jobUserScope(auth, body);
      const sql = 'SELECT * FROM video_publish_jobs WHERE id=?' + scope.sql;
      const args = [id].concat(scope.args);
      db.get(sql, args, async function(err, row) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        if (!row) { cb({ error: 'job not found' }); return; }
        try {
          const result = await executeJob(row);
          cb(Object.assign({ ok: true, id }, result));
        } catch(e) {
          await updateJobStatus(id, 'failed', e.message, '');
          logRun({
            job_id: id,
            account_id: row.account_id,
            platform_id: row.platform_id,
            profile_alias: row.profile_alias,
            action: 'execute',
            status: 'failed',
            error: e.message
          });
          cb({ ok: false, id, error: e.message });
        }
      });
    },

    '/api/video-publish/jobs/check': function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      const scope = jobUserScope(auth, body);
      const sql = 'SELECT * FROM video_publish_jobs WHERE id=?' + scope.sql;
      const args = [id].concat(scope.args);
      db.get(sql, args, async function(err, row) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        if (!row) { cb({ error: 'job not found' }); return; }
        try {
          const result = await checkJobExecutable(row);
          cb(Object.assign({ id }, result));
        } catch(e) {
          cb({ ok: false, id, error: e.message });
        }
      });
    },

    '/api/video-publish/jobs/run-batch': function(body, cb) {
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Boolean).slice(0, 50) : [];
      const auth = body._auth || {};
      if (!ids.length) { cb({ error: 'missing ids' }); return; }
      const placeholders = ids.map(() => '?').join(',');
      const scope = jobUserScope(auth, body);
      const whereUser = scope.sql;
      const args = ids.concat(scope.args);
      const db = getDb();
      db.all('SELECT * FROM video_publish_jobs WHERE id IN (' + placeholders + ')' + whereUser + ' ORDER BY id ASC', args, async function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        const results = [];
        for (const row of rows || []) {
          try {
            const result = await executeJob(row);
            results.push(Object.assign({ id: row.id, ok: true }, result));
          } catch(e) {
            await updateJobStatus(row.id, 'failed', e.message, '');
            results.push({ id: row.id, ok: false, error: e.message });
          }
        }
        cb({ ok: true, count: results.length, results });
      });
    },

    '/api/video-publish/jobs/logs': function(body, cb) {
      const jobId = Number(body.id || body.job_id || 0);
      const limit = Math.max(1, Math.min(100, Number(body.limit) || 30));
      const db = getDb();
      const where = jobId ? 'WHERE job_id=?' : '';
      const args = jobId ? [jobId, limit] : [limit];
      db.all('SELECT * FROM video_publish_logs ' + where + ' ORDER BY created_at DESC, id DESC LIMIT ?', args, function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({
          ok: true,
          logs: (rows || []).map(row => ({
            id: row.id,
            job_id: row.job_id,
            account_id: row.account_id,
            platform_id: row.platform_id,
            profile_alias: row.profile_alias,
            action: row.action,
            status: row.status,
            command: safeJson(row.command_json, []),
            stdout: row.stdout,
            stderr: row.stderr,
            error: row.error,
            duration_ms: row.duration_ms || 0,
            created_at: row.created_at
          }))
        });
      });
    },

    '/api/video-publish/jobs/delete': function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      const scope = jobUserScope(auth, body);
      const sql = 'DELETE FROM video_publish_jobs WHERE id=?' + scope.sql;
      const args = [id].concat(scope.args);
      db.run(sql, args, function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, deleted: this.changes });
      });
    }
  };
};
