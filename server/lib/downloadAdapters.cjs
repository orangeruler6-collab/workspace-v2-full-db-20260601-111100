const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'];

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

function runCommand(command, args, options) {
  return new Promise(resolve => {
    const useCmd = isWindows() && /\.cmd$/i.test(command);
    const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : command;
    const spawnArgs = useCmd ? ['/d', '/s', '/c', command].concat(args || []) : (args || []);
    const proc = spawn(spawnCommand, spawnArgs, {
      cwd: options && options.cwd || process.cwd(),
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
    ffmpeg: findCommand('ffmpeg', [])
  };
}

function normalizeLog(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function downloadUrlForBvid(bvid, fallbackUrl) {
  if (bvid) return 'https://www.bilibili.com/video/' + bvid;
  return String(fallbackUrl || '');
}

async function tryBBDown(tool, input) {
  if (!tool) return { ok: false, skipped: true, tool: 'BBDown', error: 'BBDown not installed' };
  const url = downloadUrlForBvid(input.bvid, input.url);
  const before = new Set(walkFiles(input.outputDir));
  const args = [
    url,
    '--work-dir',
    input.outputDir,
    '--file-pattern',
    '<videoTitle>_<bvid>',
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
  const url = downloadUrlForBvid(input.bvid, input.url);
  const before = new Set(walkFiles(input.outputDir));
  const outPattern = path.join(input.outputDir, '%(title).120B_%(id)s.%(ext)s');
  const args = [
    '-f',
    'bv*+ba/bestvideo+bestaudio/best',
    '--merge-output-format',
    'mp4',
    '--no-playlist',
    '--restrict-filenames',
    '-o',
    outPattern,
    url
  ];
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
  const before = new Set(walkFiles(input.outputDir));
  const args = ['bilibili', 'download', input.bvid, '--output', input.outputDir, '--quality', '1080p', '-f', 'json'];
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
    () => tryOpenCli(tools.opencli, input)
  ];

  for (const run of order) {
    const result = await run();
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

  return {
    ok: false,
    platform: 'bilibili',
    files: [],
    attempts,
    tools,
    error: attempts.filter(item => !item.skipped).map(item => item.tool + ': ' + (item.error || 'failed')).join(' | ')
      || 'No available downloader. Install BBDown or a real yt-dlp executable.'
  };
}

module.exports = {
  detectTools,
  downloadBilibili,
  getMediaKind,
  runCommand,
  walkFiles
};
