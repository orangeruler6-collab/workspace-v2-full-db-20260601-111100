const fs = require('fs');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const { buildProxyEnv, proxyAgentForUrl } = require('./proxy.cjs');

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];
const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

function isWindows() {
  return process.platform === 'win32';
}

function isExecutableFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size > 0;
  } catch(e) {
    return false;
  }
}

function pathCandidates(command, extra) {
  const candidates = [];
  const seen = new Set();
  function add(item) {
    if (!item || seen.has(item)) return;
    seen.add(item);
    candidates.push(item);
  }

  (extra || []).forEach(add);

  if (path.isAbsolute(command)) {
    add(command);
    return candidates;
  }

  const exts = isWindows() ? ['.exe', '.cmd', '.bat', ''] : [''];
  const names = exts.map(ext => command.toLowerCase().endsWith(ext) ? command : command + ext);
  String(process.env.PATH || '').split(path.delimiter).filter(Boolean).forEach(dir => {
    names.forEach(name => add(path.join(dir, name)));
  });
  return candidates;
}

function findCommand(command, extra) {
  return pathCandidates(command, extra).find(isExecutableFile) || '';
}

function bilibiliCookiesFile() {
  const candidates = [
    process.env.BILIBILI_COOKIES_FILE,
    process.env.APPDATA && path.join(process.env.APPDATA, 'ChangWanContentBoard', 'auth', 'bilibili-cookies.txt')
  ];
  return candidates.find(isExecutableFile) || '';
}

function runCommand(command, args, options) {
  return new Promise(resolve => {
    const useCmd = isWindows() && /\.cmd$/i.test(command);
    const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : command;
    const spawnArgs = useCmd ? ['/d', '/s', '/c', command].concat(args || []) : (args || []);
    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: options && options.cwd || process.cwd(),
      env: buildProxyEnv(process.env),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch(e) {}
      resolve({ ok: false, code: -1, stdout, stderr: stderr + '\ntimeout' });
    }, options && options.timeout || 30000);

    proc.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function walkFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch(e) {
    return files;
  }
  entries.forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push.apply(files, walkFiles(full));
    else if (entry.isFile()) files.push(full);
  });
  return files;
}

function getMediaKind(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  return '';
}

function newMediaFiles(outputDir, before) {
  const old = before || new Set();
  return walkFiles(outputDir)
    .filter(file => !old.has(file))
    .filter(file => getMediaKind(file))
    .sort((a, b) => {
      try { return fs.statSync(b).size - fs.statSync(a).size; }
      catch(e) { return 0; }
    });
}

function detectTools(root) {
  const toolsDir = path.join(root || process.cwd(), 'tools');
  const openCliDefault = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\opencli.cmd';
  return {
    bbdown: findCommand(process.env.USAGI_BBDOWN_PATH || 'BBDown', [
      process.env.BBDOWN_PATH,
      path.join(toolsDir, 'BBDown', 'BBDown.exe'),
      path.join(toolsDir, 'bbdown', 'BBDown.exe')
    ]),
    ytdlp: findCommand(process.env.USAGI_YTDLP_PATH || 'yt-dlp', [
      process.env.YTDLP_PATH,
      path.join(toolsDir, 'yt-dlp.exe'),
      path.join(toolsDir, 'yt-dlp', 'yt-dlp.exe')
    ]),
    opencli: findCommand(process.env.USAGI_OPENCLI_PATH || openCliDefault, [
      openCliDefault
    ]),
    ffmpeg: findCommand('ffmpeg', []),
    ffprobe: findCommand('ffprobe', [])
  };
}

function profileIsConnected(output, alias) {
  return String(output || '').split(/\r?\n/).some(line =>
    line.includes(alias) && /connected/i.test(line) && !/not connected|disconnected/i.test(line)
  );
}

function normalizeLog(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function safeFilename(value) {
  return String(value || 'bilibili-video')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
    .replace(/^_+|_+$/g, '') || 'bilibili-video';
}

function parseBilibiliPage(input) {
  const source = input && typeof input === 'object' ? input : { url: input };
  const directPage = Number(source.page || source.p || 0);
  const directCid = Number(source.cid || 0);
  const result = {
    page: Number.isFinite(directPage) && directPage > 0 ? Math.floor(directPage) : 0,
    cid: Number.isFinite(directCid) && directCid > 0 ? Math.floor(directCid) : 0
  };
  const rawUrl = String(source.url || '');
  try {
    const parsed = new URL(rawUrl);
    const urlPage = Number(parsed.searchParams.get('p') || parsed.searchParams.get('page') || 0);
    const urlCid = Number(parsed.searchParams.get('cid') || 0);
    if (!result.page && Number.isFinite(urlPage) && urlPage > 0) result.page = Math.floor(urlPage);
    if (!result.cid && Number.isFinite(urlCid) && urlCid > 0) result.cid = Math.floor(urlCid);
  } catch(e) {}
  return result;
}

function downloadUrlForBvid(bvid, fallbackUrl, page) {
  const rawUrl = String(fallbackUrl || '');
  if (bvid && rawUrl && rawUrl.toLowerCase().includes(String(bvid).toLowerCase())) return rawUrl;
  if (bvid && Number(page) > 1) return 'https://www.bilibili.com/video/' + bvid + '?p=' + Math.floor(Number(page));
  if (bvid) return 'https://www.bilibili.com/video/' + bvid;
  return String(fallbackUrl || '');
}

function getJson(url, headers, timeout) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: headers || {}, agent: proxyAgentForUrl(url) }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, error: 'HTTP ' + res.statusCode + ': ' + data.slice(0, 240) });
          return;
        }
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch (e) { resolve({ ok: false, error: 'JSON parse failed: ' + data.slice(0, 240) }); }
      });
    });
    req.on('error', err => resolve({ ok: false, error: err.message || String(err) }));
    req.setTimeout(timeout || 30000, () => req.destroy(new Error('request timeout')));
  });
}

function downloadHttpFile(url, filePath, headers, timeout, redirects) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: headers || {}, agent: proxyAgentForUrl(url) }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && (redirects || 0) < 5) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        downloadHttpFile(nextUrl, filePath, headers, timeout, (redirects || 0) + 1).then(resolve);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        resolve({ ok: false, error: 'HTTP ' + res.statusCode });
        return;
      }
      const stream = fs.createWriteStream(filePath);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close(() => resolve({ ok: true, file: filePath }));
      });
      stream.on('error', err => {
        try { fs.unlinkSync(filePath); } catch(e) {}
        resolve({ ok: false, error: err.message || String(err) });
      });
    });
    req.on('error', err => {
      try { fs.unlinkSync(filePath); } catch(e) {}
      resolve({ ok: false, error: err.message || String(err) });
    });
    req.setTimeout(timeout || 15 * 60 * 1000, () => req.destroy(new Error('download timeout')));
  });
}

function qualityNumber(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('1080')) return 80;
  if (text.includes('720')) return 64;
  if (text.includes('480')) return 32;
  return 64;
}

function requestedVideoHeight(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('1080')) return 1080;
  if (text.includes('720')) return 720;
  if (text.includes('480')) return 480;
  return 0;
}

async function probeVideoResolution(ffprobe, filePath) {
  if (!ffprobe || !filePath || !fs.existsSync(filePath)) return null;
  const result = await runCommand(ffprobe, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'json',
    filePath
  ], { timeout: 30000 });
  if (!result.ok) return null;
  try {
    const stream = (JSON.parse(result.stdout).streams || [])[0] || {};
    const width = Number(stream.width || 0);
    const height = Number(stream.height || 0);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch(e) {
    return null;
  }
}

function resolutionMeetsQuality(resolution, requestedHeight) {
  if (!resolution || !requestedHeight) return true;
  const shortEdge = Math.min(resolution.width, resolution.height);
  const longEdge = Math.max(resolution.width, resolution.height);
  return shortEdge >= requestedHeight && longEdge >= Math.round(requestedHeight * 16 / 9);
}

async function verifyDownloadedQuality(result, tools, input) {
  if (!result.ok || !Array.isArray(result.files) || !result.files.length) return result;
  const requestedHeight = requestedVideoHeight(input.quality);
  const resolutions = [];
  for (const file of result.files) {
    if (getMediaKind(file) !== 'video') continue;
    const resolution = await probeVideoResolution(tools.ffprobe, file);
    if (resolution) resolutions.push(Object.assign({ file }, resolution));
  }
  result.resolutions = resolutions;
  if (!requestedHeight || !resolutions.length) return result;

  const accepted = resolutions.filter(item => resolutionMeetsQuality(item, requestedHeight));
  if (accepted.length) {
    result.files = result.files.filter(file => accepted.some(item => item.file === file) || getMediaKind(file) !== 'video');
    return result;
  }

  const best = resolutions.sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  result.ok = false;
  result.error = result.tool + ' 实际只下载到 ' + best.width + 'x' + best.height
    + '，未达到 ' + requestedHeight + 'P；继续尝试其他高画质下载方式';
  return result;
}

async function tryBilibiliPlayurl(input) {
  if (!input.bvid) return { ok: false, skipped: true, tool: 'BiliPlayurl', error: 'BVID required' };
  const pageInfo = parseBilibiliPage(input);
  const requestedPage = pageInfo.page || 1;
  const pageUrl = downloadUrlForBvid(input.bvid, input.url, requestedPage);
  const headers = {
    'User-Agent': BILI_UA,
    'Referer': 'https://www.bilibili.com/'
  };
  const view = await getJson('https://api.bilibili.com/x/web-interface/view?bvid=' + encodeURIComponent(input.bvid), headers, 30000);
  if (!view.ok) return { ok: false, tool: 'BiliPlayurl', files: [], error: 'view api failed: ' + view.error };
  const data = view.data && view.data.data || {};
  const aid = data.aid;
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const selectedPage = pages.find(item => Number(item && item.page) === requestedPage) || pages[requestedPage - 1] || null;
  if (requestedPage > 1 && !selectedPage && !pageInfo.cid) {
    return { ok: false, tool: 'BiliPlayurl', files: [], error: 'requested Bilibili page P' + requestedPage + ' was not found' };
  }
  const cid = pageInfo.cid || selectedPage && selectedPage.cid || data.cid;
  if (!aid || !cid) return { ok: false, tool: 'BiliPlayurl', files: [], error: 'view api missing aid/cid' };

  const qn = qualityNumber(input.quality);
  const playUrl = 'https://api.bilibili.com/x/player/playurl?avid=' + encodeURIComponent(aid)
    + '&cid=' + encodeURIComponent(cid)
    + '&qn=' + encodeURIComponent(qn)
    + '&fnval=0&fourk=0';
  const play = await getJson(playUrl, Object.assign({}, headers, { Referer: pageUrl }), 30000);
  if (!play.ok) return { ok: false, tool: 'BiliPlayurl', files: [], error: 'playurl api failed: ' + play.error };
  const playData = play.data && play.data.data || {};
  const durl = Array.isArray(playData.durl) && playData.durl[0];
  const mediaUrl = durl && (durl.url || durl.backup_url && durl.backup_url[0] || durl.backupUrl && durl.backupUrl[0]);
  if (!mediaUrl) return { ok: false, tool: 'BiliPlayurl', files: [], error: 'playurl api returned no progressive mp4 url' };

  const pagePart = selectedPage && selectedPage.part ? '_P' + requestedPage + '_' + selectedPage.part : (requestedPage > 1 ? '_P' + requestedPage : '');
  const name = safeFilename((data.title || input.bvid) + pagePart + '_' + input.bvid) + '.mp4';
  const filePath = path.join(input.outputDir, name);
  const downloaded = await downloadHttpFile(mediaUrl, filePath, {
    'User-Agent': BILI_UA,
    'Referer': pageUrl,
    'Origin': 'https://www.bilibili.com'
  }, input.timeout || 15 * 60 * 1000);
  const files = downloaded.ok && fs.existsSync(filePath) && fs.statSync(filePath).size > 0 ? [filePath] : [];
  return {
    ok: files.length > 0,
    tool: 'BiliPlayurl',
    files,
    stdout: 'Downloaded from Bilibili playurl API, page=P' + requestedPage + ', cid=' + cid + ', quality=' + (playData.quality || qn),
    stderr: '',
    error: files.length ? '' : (downloaded.error || 'BiliPlayurl finished but no media file was produced')
  };
}

async function tryBBDown(tool, input) {
  if (!tool) return { ok: false, skipped: true, tool: 'BBDown', error: 'BBDown not installed' };
  const pageInfo = parseBilibiliPage(input);
  const url = downloadUrlForBvid(input.bvid, input.url, pageInfo.page);
  const filePattern = pageInfo.page ? '<videoTitle>_P' + pageInfo.page + '_<pageTitle>_<bvid>' : '<videoTitle>_<bvid>';
  const before = new Set(walkFiles(input.outputDir));
  const args = [
    url,
    '--work-dir',
    input.outputDir,
    '--file-pattern',
    filePattern,
    '--dfn-priority',
    input.quality || '8K 超高清, 4K 超清, HDR 真彩, 杜比视界, 1080P 高码率, 1080P 高清, 720P 高清'
  ];
  const result = await runCommand(tool, args, { timeout: input.timeout || 15 * 60 * 1000 });
  const files = newMediaFiles(input.outputDir, before);
  return {
    ok: result.ok && files.length > 0,
    tool: 'BBDown',
    command: tool,
    files,
    stdout: normalizeLog(result.stdout),
    stderr: normalizeLog(result.stderr),
    error: result.ok && !files.length ? 'BBDown finished but no media file was produced' : normalizeLog(result.stderr || result.stdout)
  };
}

async function tryYtDlp(tool, input) {
  if (!tool) return { ok: false, skipped: true, tool: 'yt-dlp', error: 'yt-dlp not installed or shim is invalid' };
  const pageInfo = parseBilibiliPage(input);
  const url = downloadUrlForBvid(input.bvid, input.url, pageInfo.page);
  const before = new Set(walkFiles(input.outputDir));
  const outPattern = path.join(input.outputDir, '%(title).100B_' + (pageInfo.page ? 'P' + pageInfo.page + '_' : '') + '%(id)s.%(ext)s');
  const cookiesFile = bilibiliCookiesFile();
  const args = [
    '-f',
    'bv*+ba/bestvideo+bestaudio/best',
    '--merge-output-format',
    'mp4',
    '--no-playlist',
    '--restrict-filenames',
    '-o',
    outPattern
  ];
  if (cookiesFile) args.push('--cookies', cookiesFile);
  args.push(url);
  const result = await runCommand(tool, args, { timeout: input.timeout || 15 * 60 * 1000 });
  const files = newMediaFiles(input.outputDir, before);
  return {
    ok: result.ok && files.length > 0,
    tool: 'yt-dlp',
    command: tool,
    files,
    stdout: normalizeLog(result.stdout),
    stderr: normalizeLog(result.stderr),
    error: result.ok && !files.length ? 'yt-dlp finished but no media file was produced' : normalizeLog(result.stderr || result.stdout)
  };
}

async function tryOpenCli(tool, input) {
  if (!tool) return { ok: false, skipped: true, tool: 'OpenCLI', error: 'OpenCLI not installed' };
  if (!input.bvid) return { ok: false, skipped: true, tool: 'OpenCLI', error: 'OpenCLI Bilibili download requires BV id' };
  const profileAlias = String(process.env.BILIBILI_DOWNLOAD_OPENCLI_PROFILE || '').trim();
  if (!profileAlias) {
    return { ok: false, skipped: true, tool: 'OpenCLI', error: '未配置 B站下载专用 Profile' };
  }
  const listed = await runCommand(tool, ['profile', 'list'], { timeout: 8000 });
  if (!profileIsConnected(listed.stdout + '\n' + listed.stderr, profileAlias)) {
    return { ok: false, skipped: true, tool: 'OpenCLI', error: 'B站下载专用 Profile 当前未连接' };
  }
  const before = new Set(walkFiles(input.outputDir));
  const args = ['--profile', profileAlias, 'bilibili', 'download', input.bvid, '--output', input.outputDir, '--quality', '1080p', '-f', 'json'];
  const result = await runCommand(tool, args, { timeout: input.timeout || 15 * 60 * 1000 });
  const files = newMediaFiles(input.outputDir, before);
  return {
    ok: result.ok && files.length > 0,
    tool: 'OpenCLI',
    command: tool,
    files,
    stdout: normalizeLog(result.stdout),
    stderr: normalizeLog(result.stderr),
    error: result.ok && !files.length ? 'OpenCLI finished but no media file was produced' : normalizeLog(result.stderr || result.stdout)
  };
}

async function downloadBilibili(input) {
  const root = input.root || process.cwd();
  const tools = detectTools(root);
  if (!input.outputDir) throw new Error('outputDir required');
  fs.mkdirSync(input.outputDir, { recursive: true });

  const attempts = [];
  const order = [
    () => tryBBDown(tools.bbdown, input),
    () => tryYtDlp(tools.ytdlp, input),
    () => tryOpenCli(tools.opencli, input),
    () => tryBilibiliPlayurl(input)
  ];

  for (const run of order) {
    const result = await verifyDownloadedQuality(await run(), tools, input);
    attempts.push(result);
    if (result.ok) {
      return {
        ok: true,
        platform: 'bilibili',
        tool: result.tool,
        files: result.files,
        attempts,
        tools
      };
    }
  }

  const details = attempts.filter(item => !item.skipped).map(item => item.tool + ': ' + (item.error || 'failed')).join(' | ');
  const requestedHeight = requestedVideoHeight(input.quality);
  return {
    ok: false,
    platform: 'bilibili',
    files: [],
    attempts,
    tools,
    error: requestedHeight >= 1080
      ? '未取得真实 1080P 文件。B站登录 Cookie 可能已过期，请用桌面的“数据收集专用”快捷方式重新登录并刷新 Cookie。' + (details ? ' ' + details : '')
      : details || 'No available downloader. Install BBDown or a real yt-dlp executable.'
  };
}

module.exports = {
  detectTools,
  downloadBilibili,
  getMediaKind,
  runCommand,
  walkFiles
};
