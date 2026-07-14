const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn, execFile } = require('child_process');
const createLogger = require('../lib/logger.cjs');
const searchIntent = require('../lib/searchIntent.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');
const downloadAdapters = require('../lib/downloadAdapters.cjs');
const { proxyAgentForUrl } = require('../lib/proxy.cjs');
const { chromeProfileDirectoryMap } = require('../lib/accountCatalog.cjs');

const logger = createLogger('routes:tools');

module.exports = function createToolsRoutes(deps) {
  const runPython = deps.runPython;
  const getPythonCandidates = deps.getPythonCandidates;
  const callMiniMaxChat = deps.callMiniMaxChat;
  const callOpenAICompatible = deps.callOpenAICompatible;
  const callWebSearchResearch = deps.callWebSearchResearch;
  const handleChatRequest = deps.handleChatRequest;
  const minimaxApiKey = deps.minimaxApiKey || '';
  const serverDir = deps.serverDir || path.join(__dirname, '..');
  const root = deps.root || path.join(serverDir, '..');
  const styleLibraryRoot = path.resolve(root, process.env.STYLE_LIBRARY_DIR || path.join(root, 'data', 'style-library'));
  const accountStylesDbPath = path.join(root, 'data', 'account_styles.db');
  const chromeProfiles = chromeProfileDirectoryMap();
  const openCliMain = process.env.OPENCLI_MAIN
    || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
  const openCliExtensionDir = process.env.OPENCLI_EXTENSION_DIR
    || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');

  function delay(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isRetryableModelError(err) {
    const msg = String(err && err.message || err || '');
    const httpMatch = msg.match(/(?:model|responses)?\s*HTTP\s+(\d+)/i);
    if (httpMatch) {
      const status = Number(httpMatch[1]);
      return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
    }
    return /timeout|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UNEXPECTED_EOF|network socket disconnected|secure TLS connection|fetch failed|Remote end closed|model returned empty content/i.test(msg);
  }

  function callTextModelWithRetry(systemPrompt, userPrompt, options) {
    options = options || {};
    const attempts = Math.max(1, Number(options.attempts) || 3);
    const requestOptions = {
      model: options.model || process.env.FHL_DEFAULT_MODEL || 'gpt-5.5',
      maxTokens: options.maxTokens || 2000,
      temperature: options.temperature === undefined ? 0.7 : options.temperature,
      timeoutMs: options.timeoutMs || 180000,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl
    };
    const messages = [
      { role: 'system', content: systemPrompt || '' },
      { role: 'user', content: userPrompt || '' }
    ];

    function runOnce(index) {
      const run = callOpenAICompatible
        ? callOpenAICompatible(messages, requestOptions)
        : callMiniMaxChat(systemPrompt, userPrompt, requestOptions.maxTokens, requestOptions);
      return run.then(function(value) {
        if (!String(value || '').trim()) throw new Error('model returned empty content');
        return value;
      }).catch(function(err) {
        if (index >= attempts - 1 || !isRetryableModelError(err)) throw err;
        logger.warn('comment model call failed, retrying', {
          attempt: index + 1,
          attempts: attempts,
          error: String(err && err.message || err).slice(0, 220)
        });
        return delay(900 + index * 1200).then(function() {
          return runOnce(index + 1);
        });
      });
    }

    return runOnce(0);
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\uFFFD+/g, '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function compactCommentSource(value, maxChars) {
    const text = cleanText(value);
    const limit = Math.max(2000, Number(maxChars) || 7000);
    if (text.length <= limit) return text;
    const head = Math.floor(limit * 0.62);
    const tail = Math.max(800, limit - head - 60);
    return text.slice(0, head).trim() + '\n\n【中间长转写已省略，保留开头和结尾生成评论】\n\n' + text.slice(-tail).trim();
  }

  function parseGeneratedCommentLines(reply, count) {
    const comments = [];
    const seen = new Set();

    function pushLine(value) {
      let line = String(value || '').replace(/\uFFFD+/g, '').trim();
      if (!line || line.length < 2) return;
      line = line
        .replace(/^(?:["'“”‘’]+|[,，\]\}]+)+/, '')
        .replace(/(?:["'“”‘’]+|[,，\[\{]+)+$/, '')
        .replace(/^(?:第[\d一二三四五六七八九十百千万]+(?:条|个)?|[\d一二三四五六七八九十百千万]+(?:条|个)|评论?\d*|弹幕?\d*)[.。、:：)）\-\s]+/, '')
        .replace(/^\d{1,3}[.、:：)）\-]\s+/, '')
        .replace(/^[-*•\s]+/, '')
        .replace(/^(?:评论|弹幕|内容|文案)\s*[:：]\s*/, '')
        .trim();
      if (line.length < 2) return;
      if (/^(?:以下|好的|当然|这里是|输出|结果)[:：，,\s]/.test(line)) return;
      const key = line.replace(/\s+/g, '');
      if (seen.has(key)) return;
      seen.add(key);
      comments.push(line);
    }

    function walkJson(value) {
      if (Array.isArray(value)) {
        value.forEach(walkJson);
        return;
      }
      if (value && typeof value === 'object') {
        const direct = value.comment || value.text || value.content || value.output_text || value.reply || value.response || value.message || value.danmaku || value.barrage;
        if (direct) pushLine(direct);
        ['comments', 'items', 'list', 'result', 'results', 'data', 'danmakuList', 'choices', 'output', 'messages'].forEach(function(key) {
          if (value[key]) walkJson(value[key]);
        });
        Object.keys(value).forEach(function(key) {
          if (!value[key] || ['comment', 'text', 'content', 'output_text', 'reply', 'response', 'message', 'danmaku', 'barrage', 'comments', 'items', 'list', 'result', 'results', 'data', 'danmakuList', 'choices', 'output', 'messages'].includes(key)) return;
          if (typeof value[key] === 'string' || Array.isArray(value[key]) || typeof value[key] === 'object') walkJson(value[key]);
        });
        return;
      }
      pushLine(value);
    }

    const text = typeof reply === 'string' ? reply : JSON.stringify(reply || '');
    try {
      walkJson(JSON.parse(text));
    } catch {}

    const arrayMatch = !comments.length && text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        walkJson(JSON.parse(arrayMatch[0]));
      } catch {}
    }

    if (comments.length < count) {
      String(text || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/```[\s\S]*?```/g, function(block) {
          return block.replace(/```[a-z]*|```/gi, '');
        })
        .replace(/\\n/g, '\n')
        .replace(/([^\n])\s+((?:\d{1,3}|第[\d一二三四五六七八九十百千万]+(?:条|个)?|评论?\d+|弹幕?\d+)[.。、:：)）])/g, '$1\n$2')
        .split(/\n+|(?<=["”])\s*[,，]\s*(?=["“])/)
        .forEach(pushLine);
    }

    return comments.slice(0, count);
  }

  function buildLocalCommentFallback(source, count, isDanmaku, existingSeen) {
    const text = String(source || '');
    const game = text.includes('\u9057\u5fd8\u4e4b\u6d77')
      ? '\u9057\u5fd8\u4e4b\u6d77'
      : '\u8fd9\u6e38\u620f';
    const hooks = [];
    if (/航海|海雾|海怪|岛屿|海图/.test(text)) hooks.push('航海探索');
    if (/开放世界|地图|探索/.test(text)) hooks.push('开放世界');
    if (/伙伴|船只|改造/.test(text)) hooks.push('船和伙伴');
    if (/新手|引导|打磨/.test(text)) hooks.push('新手引导');
    if (!hooks.length) hooks.push('内容');
    const shortPool = isDanmaku
      ? ['这能冲', '海雾味儿来了', '有点东西', '先码住', '船长集合', '捡垃圾启动', '别追了哥', '这怪好离谱', '我先上船', '懂了开捡']
      : ['有点想试', '先蹲一手', '海雾这味对了', '捡垃圾玩家狂喜', '船长集合', '我先上船', '这怪别追我', '有点上头啊', '开放世界又香了', '先码住'];
    const normalPool = [
      game + '的海雾探索听着挺有画面感的。',
      '如果真不是纯数值碾压，那还挺适合慢慢摸。',
      '航海加捡垃圾，这组合对我杀伤力有点大。',
      '新手引导慢可以接受，别后面也磨叽就行。',
      '破船捡海图然后被怪追，这不就是我本人。',
      '岛屿、遗迹、船改造都有的话，内容量应该不小。',
      '这种边走边遇事的探索，比开图标清单舒服。',
      '7月9日公测我去看看，主要想试试船只改造。',
      '别的不说，海怪追人这段已经有直播效果了。',
      '希望打磨跟得上，题材确实挺吸引人。'
    ];
    const memePool = [
      '海怪：今天 KPI 有了。',
      '捡垃圾玩家听到“残缺海图”已经坐直了。',
      '我：探索一下。海怪：探索你。',
      '这下不得不当海上保安了。',
      '船还没改完，人先被改造心态了。',
      '开放世界可以，别开放我的血压。',
      '海雾一进，CPU 和方向感一起下线。',
      '怪东西越多越好，我就爱这口不正常的。'
    ];
    const longPool = [
      '感觉亮点在随机探索感，不是单纯堆大地图，这点如果做好会比较耐玩。',
      '喜欢航海题材的人应该会吃这一套，海图、遗迹、船改造都很容易让人继续玩。',
      '问题主要看公测优化和引导，如果前期节奏顺一点，留存会好很多。',
      '比起数值碾压，我更期待那种一边跑图一边突然出事的体验。',
      '这种游戏最怕内容空，希望岛屿和事件别只是换皮点位。'
    ];
    const pools = isDanmaku ? [shortPool, shortPool, memePool, normalPool] : [shortPool, normalPool, memePool, normalPool, longPool];
    const variants = isDanmaku
      ? ['', '先蹲', '这能看', '别鸽', '有画面了', '等实测', '确实香', '上船']
      : ['', '先蹲', '看公测表现', '有点期待', '希望稳点', '想试试', '等实测', '题材可以', '路过心动', '别翻车'];
    const out = [];
    const seen = existingSeen || new Set();
    let index = 0;
    while (out.length < count && index < count * 20) {
      const pool = pools[index % pools.length];
      const seed = pool[Math.floor(index / pools.length) % pool.length];
      const hook = hooks[index % hooks.length];
      const round = Math.floor(index / (pool.length * pools.length));
      const variant = index >= pool.length * pools.length ? variants[round % variants.length] : '';
      const suffix = index >= pool.length * pools.length && variant ? (isDanmaku ? variant : '，' + variant) : '';
      const line = String(seed + suffix).replace('这个这个', '这个').trim();
      const key = line.replace(/\s+/g, '');
      if (line && !seen.has(key)) {
        seen.add(key);
        out.push(line);
      }
      index += 1;
    }
    return out;
  }

  function extractBvid(value) {
    const match = String(value || '').match(/\bBV[0-9A-Za-z]{8,}\b/);
    return match ? match[0] : '';
  }

  function fileEntryFromAbsolute(filePath) {
    const uploadsRoot = path.join(root, 'public', 'uploads');
    const rel = path.relative(uploadsRoot, filePath).replace(/\\/g, '/');
    const stat = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      path: rel,
      url: '/uploads/' + rel.split('/').map(encodeURIComponent).join('/'),
      type: downloadAdapters.getMediaKind(filePath) || 'file',
      size: stat.size
    };
  }

  function ffmpegBin() {
    const bundled = path.join(root, '.runtime', 'ffmpeg', 'ffmpeg-8.1.1-essentials_build', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    return fs.existsSync(bundled) ? bundled : 'ffmpeg';
  }

  function resolveUploadPath(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!raw.startsWith('/uploads/')) return '';
    try {
      return path.join(root, 'public', decodeURIComponent(raw).replace(/^\/+/, ''));
    } catch(e) {
      return path.join(root, 'public', raw.replace(/^\/+/, ''));
    }
  }

  function safeMediaName(value) {
    return String(value || 'media')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'media';
  }

  const posttoolsDownloadJobs = new Map();
  const posttoolsDownloadDelayMs = Math.max(500, Number(process.env.POSTTOOLS_DOWNLOAD_QUEUE_DELAY_MS || 1500));

  const zipCrcTable = (function() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
      crc = zipCrcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function crc32File(filePath) {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const fd = fs.openSync(filePath, 'r');
    let crc = 0xffffffff;
    try {
      let bytesRead = 0;
      while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        for (let i = 0; i < bytesRead; i++) {
          crc = zipCrcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const d = date || new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | (Math.floor(d.getSeconds() / 2) & 31),
      date: (((year - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
    };
  }

  function writeZipFile(entries, zipPath) {
    const centralParts = [];
    let offset = 0;
    fs.mkdirSync(path.dirname(zipPath), { recursive: true });
    const out = fs.openSync(zipPath, 'w');
    try {
      entries.forEach(function(entry) {
        const stat = fs.statSync(entry.absolutePath);
        const size = stat.size;
        if (size > 0xffffffff) throw new Error('zip entry too large: ' + entry.name);
        const nameBuffer = Buffer.from(entry.name, 'utf8');
        const crc = crc32File(entry.absolutePath);
        const dt = dosDateTime(stat.mtime);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(dt.time, 10);
        local.writeUInt16LE(dt.date, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(size, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(nameBuffer.length, 26);
        local.writeUInt16LE(0, 28);
        fs.writeSync(out, local);
        fs.writeSync(out, nameBuffer);

        const input = fs.openSync(entry.absolutePath, 'r');
        const buffer = Buffer.allocUnsafe(1024 * 1024);
        try {
          let bytesRead = 0;
          while ((bytesRead = fs.readSync(input, buffer, 0, buffer.length, null)) > 0) {
            fs.writeSync(out, buffer, 0, bytesRead);
          }
        } finally {
          fs.closeSync(input);
        }

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(dt.time, 12);
        central.writeUInt16LE(dt.date, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(size, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(nameBuffer.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, nameBuffer);
        offset += local.length + nameBuffer.length + size;
      });

      const centralOffset = offset;
      centralParts.forEach(function(part) {
        fs.writeSync(out, part);
        offset += part.length;
      });
      const centralSize = offset - centralOffset;
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(0, 4);
      end.writeUInt16LE(0, 6);
      end.writeUInt16LE(entries.length, 8);
      end.writeUInt16LE(entries.length, 10);
      end.writeUInt32LE(centralSize, 12);
      end.writeUInt32LE(centralOffset, 16);
      end.writeUInt16LE(0, 20);
      fs.writeSync(out, end);
    } finally {
      fs.closeSync(out);
    }
  }

  function detectPosttoolsDownloadPlatform(value) {
    const text = String(value || '').trim();
    if (/bilibili\.com|b23\.tv|\bBV[0-9A-Za-z]{8,}\b/i.test(text)) return 'bilibili';
    if (/douyin\.com|iesdouyin\.com|v\.douyin\.com/i.test(text)) return 'douyin';
    return '';
  }

  function uploadFileToAbsolute(file) {
    if (!file || typeof file !== 'object') return '';
    if (file.path) {
      const rawPath = String(file.path);
      if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) return rawPath;
      if (rawPath.startsWith('/uploads/')) {
        const full = resolveUploadPath(rawPath);
        if (full && fs.existsSync(full)) return full;
      } else {
        const full = path.join(root, 'public', 'uploads', rawPath.replace(/^\/+/, ''));
        if (fs.existsSync(full)) return full;
      }
    }
    const url = String(file.download_url || file.url || '');
    const match = url.match(/(?:^|https?:\/\/[^/]+)\/uploads\/([^?#]+)/);
    if (match) {
      try {
        const full = path.join(root, 'public', 'uploads', decodeURIComponent(match[1]).replace(/^\/+/, ''));
        if (fs.existsSync(full)) return full;
      } catch(e) {}
    }
    return '';
  }

  function downloadPosttoolsVideo(body) {
    const platform = String(body.platform || '').toLowerCase();
    const url = String(body.url || '').trim();
    const quality = String(body.quality || body.downloadQuality || '1080').toLowerCase();
    if (!url) return Promise.resolve({ ok: false, error: 'url required', files: [] });
    if (platform !== 'douyin' && platform !== 'bilibili') {
      return Promise.resolve({ ok: false, error: 'unsupported platform', files: [] });
    }

    logger.info('/api/posttools/video-download', { platform: platform, url: url });

    if (platform === 'douyin') {
      return runPython('douyin_downloader_bridge.py', 'download', {
        url: url,
        autoTranscript: false,
        downloadAssets: true,
        downloadType: 'mp4',
        quality: quality === '720' || quality === '720p' ? '720' : '1080'
      }, 1800).then(function(result) {
        const files = Array.isArray(result.files) ? result.files : [];
        return Object.assign({}, result, {
          ok: result.success !== false && files.length > 0,
          platform: 'douyin',
          files: files,
          error: result.success === false || !files.length ? (result.error || result.stderr || result.log || result.message || 'Douyin video download failed') : ''
        });
      }).catch(function(e) {
        logger.error('/api/posttools/video-download douyin failed', e);
        return { ok: false, platform: 'douyin', error: e.message || String(e), files: [] };
      });
    }

    const bvid = extractBvid(url);
    if (!bvid) {
      return Promise.resolve({ ok: false, platform: 'bilibili', error: '未识别到 B 站 BV 号', files: [] });
    }
    const outputDir = path.join(root, 'public', 'uploads', 'posttools', 'bilibili');
    return downloadAdapters.downloadBilibili({
      root: root,
      bvid: bvid,
      url: url,
      outputDir: outputDir,
      quality: quality === '720' || quality === '720p' ? '720P \u9ad8\u6e05' : '1080P \u9ad8\u7801\u7387, 1080P \u9ad8\u6e05, 720P \u9ad8\u6e05',
      timeout: 15 * 60 * 1000
    }).then(function(result) {
      const files = (result.files || [])
        .filter(function(file) { return fs.existsSync(file); })
        .map(fileEntryFromAbsolute);
      return {
        ok: result.ok && files.length > 0,
        platform: 'bilibili',
        tool: result.tool || '',
        files: files,
        attempts: result.attempts || [],
        error: result.ok && files.length ? '' : (result.error || 'B 站视频下载失败')
      };
    }).catch(function(e) {
      logger.error('/api/posttools/video-download bilibili failed', e);
      return { ok: false, platform: 'bilibili', error: e.message || String(e), files: [] };
    });
  }

  function snapshotPosttoolsDownloadJob(job) {
    if (!job) return null;
    const live = scanPosttoolsDownloadProgress(job);
    return {
      id: job.id,
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      currentIndex: job.currentIndex || 0,
      currentStartedAt: job.currentStartedAt || '',
      phase: job.phase || '',
      current: job.current,
      liveFiles: live.count,
      liveBytes: live.bytes,
      liveLatestAt: live.latestAt,
      error: job.error,
      zip_url: job.zip_url,
      zip_path: job.zip_path,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      items: job.items.map(function(item) {
        return {
          url: item.url,
          platform: item.platform,
          status: item.status,
          error: item.error,
          files: item.files || []
        };
      })
    };
  }

  function scanPosttoolsDownloadProgress(job) {
    const since = Date.parse(job && job.createdAt || '') || 0;
    const dirs = [
      path.join(root, 'public', 'uploads', 'douyin'),
      path.join(root, 'public', 'uploads', 'posttools', 'bilibili')
    ];
    const result = { count: 0, bytes: 0, latestAt: '' };
    dirs.forEach(function(dir) {
      try {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
          if (!entry.isFile()) return;
          if (!/\.(mp4|mov|mkv|webm|flv|m4v)$/i.test(entry.name)) return;
          const fullPath = path.join(dir, entry.name);
          const stat = fs.statSync(fullPath);
          if (since && stat.mtimeMs < since - 2000) return;
          result.count += 1;
          result.bytes += stat.size;
          if (!result.latestAt || stat.mtimeMs > Date.parse(result.latestAt)) {
            result.latestAt = stat.mtime.toISOString();
          }
        });
      } catch(e) {}
    });
    return result;
  }

  function runPosttoolsDownloadJob(job) {
    Promise.resolve().then(async function() {
      job.status = 'running';
      job.phase = 'downloading';
      job.updatedAt = new Date().toISOString();
      const zipSources = [];
      for (let i = 0; i < job.items.length; i++) {
        const item = job.items[i];
        item.status = 'running';
        job.currentIndex = i + 1;
        job.currentStartedAt = new Date().toISOString();
        job.phase = 'downloading';
        job.current = item.url;
        job.updatedAt = new Date().toISOString();
        try {
          const result = await downloadPosttoolsVideo({ platform: item.platform, url: item.url, quality: job.quality });
          const files = Array.isArray(result.files) ? result.files : [];
          if (!result.ok || !files.length) throw new Error(result.error || '视频下载失败');
          item.status = 'done';
          item.files = files;
          item.error = '';
          job.success += 1;
          files.forEach(function(file) {
            const absolutePath = uploadFileToAbsolute(file);
            if (absolutePath) zipSources.push({ file: file, absolutePath: absolutePath, index: i + 1 });
          });
        } catch (e) {
          item.status = 'error';
          item.error = e.message || String(e);
          job.failed += 1;
        }
        job.done += 1;
        job.updatedAt = new Date().toISOString();
        if (i < job.items.length - 1) await delay(posttoolsDownloadDelayMs);
      }

      if (zipSources.length) {
        job.phase = 'zipping';
        job.current = 'zipping';
        job.updatedAt = new Date().toISOString();
        const zipDir = path.join(root, 'public', 'uploads', 'posttools', 'zips');
        const zipName = 'posttools_download_' + job.id + '.zip';
        const usedNames = new Set();
        const entries = zipSources.map(function(source, idx) {
          const ext = path.extname(source.absolutePath) || path.extname(source.file && source.file.name || '') || '.mp4';
          const base = safeMediaName(path.basename(source.file && source.file.name || source.absolutePath, ext));
          let name = String(source.index).padStart(2, '0') + '_' + base + ext;
          let dedupe = 2;
          while (usedNames.has(name.toLowerCase())) {
            name = String(source.index).padStart(2, '0') + '_' + base + '_' + dedupe + ext;
            dedupe += 1;
          }
          usedNames.add(name.toLowerCase());
          return { name: name, absolutePath: source.absolutePath };
        });
        const zipPath = path.join(zipDir, zipName);
        writeZipFile(entries, zipPath);
        job.zip_url = '/uploads/posttools/zips/' + encodeURIComponent(zipName);
        job.zip_path = 'posttools/zips/' + zipName;
      }
      job.status = job.success ? 'done' : 'error';
      job.error = job.success ? '' : '队列任务全部失败';
      job.current = '';
      job.currentIndex = 0;
      job.phase = job.success ? 'done' : 'error';
      job.updatedAt = new Date().toISOString();
    }).catch(function(e) {
      logger.error('/api/posttools/video-download-batch worker failed', e);
      job.status = 'error';
      job.error = e.message || String(e);
      job.current = '';
      job.currentIndex = 0;
      job.phase = 'error';
      job.updatedAt = new Date().toISOString();
    });
  }

  function createPosttoolsDownloadJob(body) {
    const rawLinks = Array.isArray(body.links) ? body.links : String(body.links || body.url || '').split(/\r?\n/);
    const seen = new Set();
    const items = rawLinks.map(function(item) {
      const url = typeof item === 'string' ? item : (item && (item.url || item.link) || '');
      const normalized = String(url || '').trim();
      const platform = detectPosttoolsDownloadPlatform(normalized);
      return normalized && platform ? { url: normalized, platform: platform, status: 'pending', error: '', files: [] } : null;
    }).filter(function(item) {
      if (!item) return false;
      const key = item.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!items.length) return null;
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const now = new Date().toISOString();
    const job = {
      id: id,
      quality: String(body.quality || body.downloadQuality || '1080'),
      status: 'queued',
      total: items.length,
      done: 0,
      success: 0,
      failed: 0,
      currentIndex: 0,
      currentStartedAt: '',
      phase: 'queued',
      current: '',
      error: '',
      zip_url: '',
      zip_path: '',
      createdAt: now,
      updatedAt: now,
      items: items
    };
    posttoolsDownloadJobs.set(id, job);
    runPosttoolsDownloadJob(job);
    return job;
  }

  function listPosttoolsDownloadZips(limit) {
    const zipDir = path.join(root, 'public', 'uploads', 'posttools', 'zips');
    try {
      if (!fs.existsSync(zipDir)) return [];
      return fs.readdirSync(zipDir)
        .filter(function(name) { return /\.zip$/i.test(name); })
        .map(function(name) {
          const fullPath = path.join(zipDir, name);
          const stat = fs.statSync(fullPath);
          return {
            name: name,
            url: '/uploads/posttools/zips/' + encodeURIComponent(name),
            download_url: '/uploads/posttools/zips/' + encodeURIComponent(name),
            path: 'posttools/zips/' + name,
            type: 'zip',
            size: stat.size,
            mtime: stat.mtimeMs,
            updatedAt: stat.mtime.toISOString()
          };
        })
        .sort(function(a, b) { return b.mtime - a.mtime; })
        .slice(0, Math.max(1, Number(limit) || 10));
    } catch (e) {
      logger.warn('list posttools download zips failed', e);
      return [];
    }
  }

  function runFfmpeg(args, timeoutMs) {
    return new Promise(function(resolve) {
      const proc = spawn(ffmpegBin(), args, { cwd: root, windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(function() {
        try { proc.kill(); } catch(e) {}
        resolve({ ok: false, stdout: stdout, stderr: stderr + '\ntimeout' });
      }, timeoutMs || 10 * 60 * 1000);
      proc.stdout.on('data', function(chunk) { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', function(chunk) { stderr += chunk.toString('utf8'); });
      proc.on('error', function(err) {
        clearTimeout(timer);
        resolve({ ok: false, stdout: stdout, stderr: stderr + '\n' + err.message });
      });
      proc.on('close', function(code) {
        clearTimeout(timer);
        resolve({ ok: code === 0, stdout: stdout, stderr: stderr });
      });
    });
  }

  function extractAudioForTranscription(videoPath, options) {
    return new Promise(function(resolve) {
      const audioPath = path.join(os.tmpdir(), 'bili_fallback_audio_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.mp3');
      const configuredMaxSeconds = Number(options && options.maxSeconds) || Number(process.env.BILIBILI_TRANSCRIBE_MAX_SECONDS) || 1800;
      const maxSeconds = Math.max(30, Math.min(7200, configuredMaxSeconds));
      const ff = spawn(ffmpegBin(), [
        '-y',
        '-i', videoPath,
        '-vn',
        '-ac', '1',
        '-ar', '16000',
        '-t', String(maxSeconds),
        '-f', 'mp3',
        audioPath
      ], { cwd: root, windowsHide: true });
      ff.stderr.on('data', () => {});
      ff.on('error', function(err) {
        logger.warn('/api/transcribe/bilibili fallback audio extract failed', err);
        resolve({ audioPath: '', maxSeconds, error: err.message || String(err) });
      });
      ff.on('close', function(code) {
        if (code !== 0 || !fs.existsSync(audioPath)) {
          try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch(e) {}
          resolve({ audioPath: '', maxSeconds, error: 'ffmpeg audio extract failed' });
          return;
        }
        resolve({ audioPath, maxSeconds });
      });
    });
  }

  function volcengineHeader(response, name) {
    return response.headers[String(name || '').toLowerCase()] || '';
  }

  function extractVolcengineTranscript(data) {
    const parts = [];
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      ['text', 'utterance_text', 'result_text'].forEach(function(key) {
        if (typeof value[key] === 'string' && value[key].trim()) parts.push(value[key].trim());
      });
      Object.keys(value).forEach(function(key) { visit(value[key]); });
    }
    visit(data);
    return cleanText(Array.from(new Set(parts)).join('\n'));
  }

  function postJsonWithProxy(url, headers, body, timeoutMs) {
    return new Promise(function(resolve, reject) {
      const target = new URL(url);
      const req = https.request({
        hostname: target.hostname,
        port: Number(target.port) || 443,
        path: target.pathname + target.search,
        method: 'POST',
        agent: proxyAgentForUrl(url),
        headers: Object.assign({}, headers, {
          'Content-Length': Buffer.byteLength(body)
        })
      }, function(res) {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          resolve({ statusCode: res.statusCode || 0, headers: res.headers || {}, body: data });
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs || 30000, function() {
        req.destroy(new Error('request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  async function transcribeAudioFileWithVolcengine(audioPath, options) {
    const apiKey = process.env.VOLCENGINE_ASR_API_KEY || process.env.VOLCENGINE_API_KEY || '';
    const appKey = process.env.VOLCENGINE_ASR_APP_KEY || '';
    const accessKey = process.env.VOLCENGINE_ASR_ACCESS_KEY || '';
    if (!apiKey && (!appKey || !accessKey)) {
      return { text: '', error: 'VOLCENGINE_ASR_API_KEY is not configured', provider: 'volcengine' };
    }
    let audioBuffer;
    try {
      audioBuffer = fs.readFileSync(audioPath);
    } catch(e) {
      return { text: '', error: e.message || String(e), provider: 'volcengine' };
    }
    const submitUrl = process.env.VOLCENGINE_ASR_SUBMIT_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit';
    const queryUrl = process.env.VOLCENGINE_ASR_QUERY_URL || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query';
    const resourceId = process.env.VOLCENGINE_ASR_RESOURCE_ID || 'volc.seedasr.auc';
    const timeoutMs = Number(process.env.VOLCENGINE_ASR_REQUEST_TIMEOUT_MS || 30000);
    const pollIntervalMs = Number(process.env.VOLCENGINE_ASR_POLL_INTERVAL_MS || 1000);
    const maxPollAttempts = Number(process.env.VOLCENGINE_ASR_MAX_POLL_ATTEMPTS || 120);
    const taskId = randomUUID();
    const headers = {
      'Content-Type': 'application/json',
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': taskId,
      'X-Api-Sequence': '-1'
    };
    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
    } else {
      headers['X-Api-App-Key'] = appKey;
      headers['X-Api-Access-Key'] = accessKey;
    }
    const submitBody = JSON.stringify({
      user: { uid: process.env.VOLCENGINE_ASR_UID || 'content-board' },
      audio: {
        format: process.env.VOLCENGINE_ASR_AUDIO_FORMAT || 'mp3',
        data: audioBuffer.toString('base64')
      },
      request: {
        model_name: 'bigmodel',
        enable_itn: true,
        enable_punc: true,
        show_utterances: false
      }
    });
    try {
      const submitResponse = await postJsonWithProxy(submitUrl, headers, submitBody, timeoutMs);
      const submitStatus = volcengineHeader(submitResponse, 'X-Api-Status-Code');
      if (submitStatus !== '20000000') {
        return {
          text: '',
          error: 'Volcengine submit ' + (submitResponse.statusCode || '') + ' ' + submitStatus + ': ' + (volcengineHeader(submitResponse, 'X-Api-Message') || submitResponse.body || '').slice(0, 240),
          provider: 'volcengine'
        };
      }
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        if (attempt > 0) await delay(pollIntervalMs);
        const queryResponse = await postJsonWithProxy(queryUrl, headers, '{}', timeoutMs);
        const queryStatus = volcengineHeader(queryResponse, 'X-Api-Status-Code');
        if (queryStatus === '20000001' || queryStatus === '20000002') continue;
        if (queryStatus !== '20000000') {
          return {
            text: '',
            error: 'Volcengine query ' + (queryResponse.statusCode || '') + ' ' + queryStatus + ': ' + (volcengineHeader(queryResponse, 'X-Api-Message') || queryResponse.body || '').slice(0, 240),
            provider: 'volcengine'
          };
        }
        const parsed = JSON.parse(queryResponse.body || '{}');
        const text = extractVolcengineTranscript(parsed);
        return text
          ? { text, provider: 'volcengine' }
          : { text: '', error: 'Volcengine returned empty transcript', provider: 'volcengine' };
      }
      return { text: '', error: 'Volcengine transcription timeout', provider: 'volcengine' };
    } catch(e) {
      return { text: '', error: e.message || String(e), provider: 'volcengine' };
    }
  }

  function transcribeAudioFileWithSiliconFlow(audioPath, maxSeconds) {
    return new Promise(function(resolve) {
      const siliconflowKey = deps.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
      if (!siliconflowKey) {
        resolve({ text: '', error: 'SILICONFLOW_API_KEY is not configured', provider: 'siliconflow' });
        return;
      }
      let audioBuffer;
      try {
        audioBuffer = fs.readFileSync(audioPath);
      } catch(e) {
        resolve({ text: '', error: e.message || String(e), provider: 'siliconflow' });
        return;
      }
        const boundary = '----bili-fallback-' + Date.now();
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

        const req = https.request({
          hostname: 'api.siliconflow.cn',
          port: 443,
          path: '/v1/audio/transcriptions',
          method: 'POST',
          agent: proxyAgentForUrl('https://api.siliconflow.cn/v1/audio/transcriptions'),
          headers: {
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
            'Content-Length': body.length,
            'Authorization': 'Bearer ' + siliconflowKey
          }
        }, function(res) {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', function() {
            try { fs.unlinkSync(audioPath); } catch(e) {}
            if (res.statusCode < 200 || res.statusCode >= 300) {
              resolve({ text: '', error: 'SiliconFlow HTTP ' + res.statusCode + ': ' + data.substring(0, 200), provider: 'siliconflow' });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const text = cleanText(parsed.text || parsed.result || '');
              resolve(text ? { text, provider: 'siliconflow' } : { text: '', error: 'SiliconFlow returned empty transcript', provider: 'siliconflow' });
            } catch(e) {
              resolve({ text: '', error: 'SiliconFlow parse failed: ' + data.substring(0, 200), provider: 'siliconflow' });
            }
          });
        });
        req.on('error', function(err) {
          resolve({ text: '', error: err.message || String(err), provider: 'siliconflow' });
        });
        req.setTimeout(Math.max(240000, Math.min(900000, maxSeconds * 1000)), function() {
          req.destroy(new Error('SiliconFlow transcription timeout'));
        });
        req.write(body);
        req.end();
    });
  }

  async function transcribeAudioFileWithPreferredAsr(audioPath, options) {
    const volcengine = await transcribeAudioFileWithVolcengine(audioPath, options);
    if (volcengine.text) return volcengine;
    const siliconflow = await transcribeAudioFileWithSiliconFlow(audioPath, Number(options && options.maxSeconds) || 1800);
    if (siliconflow.text) {
      return Object.assign({}, siliconflow, {
        warning: 'Volcengine failed, used SiliconFlow fallback: ' + (volcengine.error || 'unknown')
      });
    }
    return {
      text: '',
      error: (volcengine.error || 'Volcengine failed') + '; SiliconFlow fallback failed: ' + (siliconflow.error || 'unknown'),
      provider: 'asr'
    };
  }

  async function transcribeMediaFileWithPreferredAsr(videoPath, options) {
    const extracted = await extractAudioForTranscription(videoPath, options);
    if (!extracted.audioPath) return { text: '', error: extracted.error || 'ffmpeg audio extract failed' };
    try {
      return await transcribeAudioFileWithPreferredAsr(extracted.audioPath, Object.assign({}, options || {}, {
        maxSeconds: extracted.maxSeconds || 1800
      }));
    } finally {
      try { fs.unlinkSync(extracted.audioPath); } catch(e) {}
    }
  }

  async function transcribeDownloadedBilibiliVideo(url, bvid, previousError) {
    let outputDir = '';
    try {
      outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili_video_fallback_'));
      const downloaded = await downloadAdapters.downloadBilibili({
        root,
        url,
        bvid,
        outputDir,
        quality: '1080P 高清,720P 高清,480P 清晰',
        timeout: 20 * 60 * 1000
      });
      if (!downloaded.ok || !downloaded.files || !downloaded.files.length) {
        return {
          text: '',
          error: (previousError ? previousError + '；' : '') + (downloaded.error || 'B站视频下载失败'),
          source: 'bilibili-download'
        };
      }
      const videoPath = downloaded.files.find(file => downloadAdapters.getMediaKind(file) === 'video') || downloaded.files[0];
      const transcribed = await transcribeMediaFileWithPreferredAsr(videoPath, {});
      if (!transcribed.text) {
        return {
          text: '',
          error: (previousError ? previousError + '；' : '') + (transcribed.error || '下载视频后转写失败'),
          source: 'bilibili-download:' + (downloaded.tool || 'unknown')
        };
      }
      return {
        text: transcribed.text,
        error: '',
        source: 'bilibili-download:' + (downloaded.tool || 'unknown') + ':' + (transcribed.provider || 'asr'),
        warning: transcribed.warning || ''
      };
    } finally {
      if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }

  function execVersion(command, args, timeout, cb) {
    try {
      execFile(command, args || [], { timeout: timeout || 5000, windowsHide: true }, function(error, stdout, stderr) {
        if (error) {
          cb({ ok: false, error: error.message });
          return;
        }
        cb({ ok: true, version: String(stdout || stderr || '').trim().split(/\r?\n/)[0] || '' });
      });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  }

  function fetchJson(url, timeout, cb) {
    const req = http.get(url, function(res) {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          cb(null, {
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            data: data ? JSON.parse(data) : {}
          });
        } catch (e) {
          cb(null, { ok: false, status: res.statusCode, error: e.message });
        }
      });
    });
    req.on('error', function(e) { cb(e); });
    req.setTimeout(timeout || 5000, function() {
      req.destroy(new Error('timeout'));
    });
  }

  function buildSystemHealth(cb) {
    const apiPort = Number(process.env.PORT) || 5555;
    const styleUrl = 'http://127.0.0.1:' + apiPort + '/api/health/style-workbench';
    const opencliBin = process.env.OPENCLI_BIN || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'opencli.cmd') : 'opencli');
    let styleDone = false;
    let cliDone = false;
    let styleHealth = null;
    let cliHealth = null;

    function done() {
      if (!styleDone || !cliDone) return;
      const styleData = styleHealth && styleHealth.data ? styleHealth.data : {};
      const opencli = cliHealth || {};
      const chatConfigured = Boolean(process.env.CHAT_API_KEY || process.env.OPENAI_API_KEY || process.env.FHL_API_KEY || process.env.OPENAI_BASE_URL || deps.minimaxApiKey);
      const siliconflowConfigured = Boolean(process.env.SILICONFLOW_API_KEY || deps.siliconflowApiKey);
      const feishuConfigured = Boolean(process.env.FEISHU_OPENCLI_AS || process.env.FEISHU_FOLDER_TOKEN || process.env.FEISHU_APP_ID);
      cb({
        ok: true,
        checkedAt: Date.now(),
        api: {
          ok: true,
          port: apiPort
        },
        styleWorkbench: {
          ok: Boolean(styleHealth && styleHealth.ok),
          native: true,
          url: styleUrl,
          name: styleData.name || 'style-workbench-native',
          error: styleHealth && styleHealth.error || ''
        },
        opencli: {
          ok: Boolean(opencli.ok),
          bin: opencli.bin || opencliBin,
          version: opencli.version || '',
          error: opencli.error || ''
        },
        siliconflow: {
          ok: siliconflowConfigured,
          configured: siliconflowConfigured
        },
        chat: {
          ok: chatConfigured,
          configured: chatConfigured,
          model: process.env.CHAT_MODEL || process.env.FHL_DEFAULT_MODEL || process.env.OPENAI_MODEL || 'gpt-5.5',
          wireApi: process.env.CHAT_WIRE_API || process.env.OPENAI_WIRE_API || 'responses',
          proxyConfigured: Boolean(process.env.CHAT_PROXY_URL || process.env.FHL_PROXY_URL || process.env.MODEL_PROXY_URL || process.env.OPENAI_BASE_URL)
        },
        feishu: {
          ok: feishuConfigured,
          configured: feishuConfigured,
          doctorOk: false,
          error: ''
        },
        libraryRoot: styleData.libraryRoot || styleLibraryRoot
      });
    }

    fetchJson(styleUrl, 4500, function(err, result) {
      styleHealth = err ? { ok: false, error: err.message } : result;
      styleDone = true;
      done();
    });
    execVersion(opencliBin, ['--version'], 4500, function(result) {
      cliHealth = Object.assign({ bin: opencliBin }, result);
      cliDone = true;
      done();
    });
  }

  function callMiniMaxMessages(messages, temperature, maxTokens, cb, options) {
    options = options || {};
    console.error('[DEBUG callMiniMaxMessages] model=MiniMax-M2.7-highspeed apiHost=api.minimaxi.com temperature=' + temperature);
    var apiKey = minimaxApiKey;
    var apiHost = 'api.minimaxi.com';
    const payload = JSON.stringify({
      model: 'MiniMax-M2.7-highspeed',
      messages: messages,
      max_tokens: maxTokens || 2000,
      temperature: temperature
    });
    console.error('[DEBUG] payload size:', Buffer.byteLength(payload), 'messages count:', messages ? messages.length : 0);
    var req = https.request({
      hostname: apiHost,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      }
    }, function(res) {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', function() {
        console.error('[DEBUG] response status:', res.statusCode, 'data len:', data.length);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          cb(new Error('MiniMax HTTP ' + res.statusCode + ': ' + data.substring(0, 160)));
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
          cb(null, message ? (message.content || '') : '');
        } catch(e) {
          cb(null, data.substring(0, 200));
        }
      });
    });
    req.on('error', function(e) { cb(e); });
    req.setTimeout(options.timeoutMs || 120000, function() {
      req.destroy(new Error('MiniMax request timeout'));
    });
    req.write(payload);
    req.end();
  }

  function parseHotPayload(raw) {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
  }

  function normalizeHotResults(raw) {
    const parsed = parseHotPayload(raw);
    return (parsed.organic || []).map(function(item) {
      return {
        title: item.title || '',
        link: item.link || '',
        snippet: item.snippet || '',
        summary: item.summary || '',
        content: item.content || '',
        content_status: item.content_status || '',
        fetch_error: item.fetch_error || '',
        date: item.date || '',
        source_query: item.source_query || parsed.query || '',
        source: item.source || parsed.source || ''
      };
    });
  }

  const HOT_SEARCH_ATTRIBUTE_TERMS = new Set([
    '争议', '争议判罚', '判罚争议', '判罚', '黑哨', '误判', '红牌', '越位', '犯规',
    '粗野动作', '粗野', '动作', '冲突', '质疑'
  ]);

  function isAttributeOnlyHotQuery(value) {
    const tokens = String(value || '').match(/[\u4e00-\u9fa5]{1,8}|[A-Za-z][A-Za-z0-9_-]{1,30}/g) || [];
    const meaningful = tokens.map(function(token) { return cleanText(token).trim(); }).filter(Boolean);
    return meaningful.length > 0 && meaningful.every(function(token) { return HOT_SEARCH_ATTRIBUTE_TERMS.has(token); });
  }

  function buildStructuredHotQueries(context) {
    const source = String(context || '');
    const year = (source.match(/\b(19\d{2}|20\d{2})\s*年?/) || [])[1] || '';
    const event = /世界杯|world\s*cup/i.test(source) ? '世界杯' : '';
    const teams = ['韩国', '意大利', '日本', '西班牙', '葡萄牙', '德国', '巴西', '法国', '英格兰', '阿根廷', '中国', '国足']
      .filter(function(name) { return source.indexOf(name) >= 0; });
    const people = ['托蒂', '托马西', '莫雷诺', '安贞焕', '马尔蒂尼', '布冯', '皮耶罗']
      .filter(function(name) { return source.indexOf(name) >= 0; });
    const attrs = [];
    if (/争议|判罚|黑哨|误判/.test(source)) attrs.push('争议判罚');
    if (/红牌/.test(source)) attrs.push('红牌');
    if (/越位/.test(source)) attrs.push('越位');
    if (/粗野|犯规|动作/.test(source)) attrs.push('粗野动作');

    const out = [];
    function push(parts) {
      const q = parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (q && out.indexOf(q) < 0) out.push(q);
    }
    if (year && event && teams.length >= 2) {
      push([year + event].concat(teams.slice(0, 2), attrs.slice(0, 1)));
      push([year, event].concat(teams.slice(0, 2), people.slice(0, 1)));
    } else if (event && teams.length >= 2) {
      push([event].concat(teams.slice(0, 2), attrs.slice(0, 1)));
      push([event].concat(teams.slice(0, 2), people.slice(0, 1)));
    } else if (year && event && (teams.length || people.length)) {
      push([year + event].concat(teams.slice(0, 1), people.slice(0, 2), attrs.slice(0, 1)));
    }
    return out;
  }

  function hotSearchQueries(query, sourceText) {
    const picked = [];
    function add(value) {
      const q = cleanText(value).replace(/\s+/g, ' ').trim();
      if (!q || q.length < 2 || q.length > 80) return;
      if (/\?{2,}|�|鏂|杞|鎼|ogle$/i.test(q)) return;
      if (picked.indexOf(q) < 0) picked.push(q);
    }
    const context = [query, sourceText].filter(Boolean).join('\n');
    buildStructuredHotQueries(context).forEach(add);
    if (!isAttributeOnlyHotQuery(query)) add(query);
    if (/Faker/i.test(context) && /柳智敏|Karina/i.test(context)) {
      add('Faker 柳智敏 Google Play 广告');
      add('Faker Karina Google Play');
      add('Faker 柳智敏 广告 正片 彩蛋');
    }
    if (/Google\s*Play/i.test(context) && !/Google\s*Play/i.test(query)) add(query + ' Google Play');
    if (/广告|正片|预告|彩蛋|合作|联动/.test(context + query)) add(query + ' 正片 彩蛋');
    if (/EDG/i.test(context) && /康康|ZmjjKK|kk/i.test(context)) {
      add('EDG 康康 ZmjjKK 名场面');
      add('康康 EDG 无畏契约 名场面');
    }
    try {
      const intent = searchIntent.extractSearchIntent([query, sourceText].filter(Boolean).join('\n'), {
        queryLimit: 4,
        entityLimit: 6
      });
      add(intent && intent.query);
      (intent && (intent.search_queries || intent.queries) || []).forEach(add);
    } catch (e) {}

    const entityMatches = context.match(/[A-Za-z][A-Za-z0-9._-]{1,24}|[\u4e00-\u9fa5]{2,8}/g) || [];
    const stop = new Set(['视频', '内容', '文案', '背景', '搜索', '分析', '素材', '转写', '原文', '结构', '切入点', '框架', '结尾', '一个', '这个', '可以', '怎么', '为什么']);
    const entities = [];
    entityMatches.forEach(function(word) {
      const token = String(word || '').trim();
      if (!token || stop.has(token) || entities.indexOf(token) >= 0) return;
      if (/^[A-Za-z]$/.test(token)) return;
      entities.push(token);
    });
    if (entities.length >= 2) add(entities.slice(0, 4).join(' '));
    if (entities.length >= 3) add(entities.slice(0, 3).join(' ') + ' 事件');

    return picked.slice(0, 5);
  }

  function runHotSearchWorker(query) {
    return new Promise(function(resolve) {
      const py = spawn(getPythonCandidates()[0] || 'python', [path.join(serverDir, 'hot_search_worker.py'), query], {
        shell: false,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
      });
      const chunks = [];
      const errors = [];
      const timer = setTimeout(function() {
        try { py.kill(); } catch (e) {}
        resolve({ organic: [], query: query, source: 'timeout', error: 'timeout' });
      }, 35000);
      py.stdout.on('data', function(chunk) { chunks.push(chunk); });
      py.stderr.on('data', function(chunk) { errors.push(chunk); });
      py.on('close', function() {
        clearTimeout(timer);
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const payload = parseHotPayload(raw);
          payload.query = payload.query || query;
          resolve(payload);
          return;
        } catch (e) {
          const match = raw.match(/\{[\s\S]*\}/);
          if (match) {
            try {
              const payload = parseHotPayload(match[0]);
              payload.query = payload.query || query;
              resolve(payload);
              return;
            } catch (e2) {}
          }
          resolve({
            organic: [],
            query: query,
            source: 'worker_error',
            error: (raw || Buffer.concat(errors).toString('utf8') || e.message).substring(0, 300)
          });
        }
      });
      py.on('error', function(e) {
        clearTimeout(timer);
        resolve({ organic: [], query: query, source: 'worker_error', error: e.message });
      });
    });
  }

  function domainOf(link) {
    try { return new URL(String(link || '')).hostname.replace(/^www\./, '').toLowerCase(); }
    catch (e) { return ''; }
  }

  function hotResultScore(item, queries, sourceText) {
    const text = [item.title, item.snippet, item.summary, item.content].join(' ').toLowerCase();
    const domain = domainOf(item.link);
    let score = 0;
    if (item.content) score += 9;
    else if (item.summary || item.snippet) score += 4;
    if (item.date) score += 2;
    if (/qq\.com|new\.qq\.com|news\.qq\.com|sohu\.com|gamersky\.com|163\.com|sina\.com|zhibo8\.com|ithome\.com|36kr\.com/.test(domain)) score += 4;
    if (/bilibili\.com|douyin\.com|weibo\.com|youtube\.com/.test(domain)) score += item.content ? 1 : -1;
    if (/wikipedia\.org|liquipedia\.net|baike\.baidu\.com|fandom\.com|moegirl\.org/.test(domain)) score -= 5;
    const tokens = Array.from(new Set(String(queries.join(' ') + ' ' + sourceText)
      .match(/[A-Za-z][A-Za-z0-9._-]{1,24}|[\u4e00-\u9fa5]{2,8}/g) || []))
      .filter(function(token) {
        return !['视频', '内容', '文案', '背景', '搜索', '分析', '素材', '转写', '原文', '结构', '一个', '这个'].includes(token);
      })
      .slice(0, 14);
    tokens.forEach(function(token) {
      if (text.indexOf(String(token).toLowerCase()) >= 0) score += 1.5;
    });
    const context = queries.join(' ') + ' ' + sourceText;
    if (/广告|正片|彩蛋|合作|联动/.test(context) && /广告|正片|彩蛋|合作|联动|Google Play/i.test(text)) score += 6;
    if (/Google\s*Play/i.test(context) && !/Google\s*Play/i.test(text)) score -= 8;
    if (/柳智敏|Karina/i.test(context) && !/柳智敏|Karina/i.test(text)) score -= 7;
    if (/广告/.test(context) && !/广告|ad\b|Google\s*Play/i.test(text)) score -= 5;
    if (/EDG|康康|ZmjjKK/i.test(context) && /胃镜|esophagogastroduodenoscopy|EGD Test/i.test(text)) score -= 20;
    return score;
  }

  function mergeHotPayloads(payloads, queries, sourceText) {
    const seen = new Set();
    const errors = [];
    const sources = [];
    const results = [];
    (payloads || []).forEach(function(payload) {
      if (!payload) return;
      if (payload.error) errors.push((payload.query || '') + ': ' + payload.error);
      if (payload.source && sources.indexOf(payload.source) < 0) sources.push(payload.source);
      normalizeHotResults(payload).forEach(function(item) {
        const key = (item.link || item.title || '').toLowerCase();
        if (!key || seen.has(key)) return;
        seen.add(key);
        item.source_query = item.source_query || payload.query || '';
        item.source = item.source || payload.source || '';
        item.score = hotResultScore(item, queries, sourceText);
        results.push(item);
      });
    });
    results.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    return {
      organic: results.slice(0, 10),
      source: sources.join('+') || '',
      errors: errors,
      query: queries[0] || ''
    };
  }

  function buildHotAnalysisFallback(query, results) {
    const picked = (results || []).slice(0, 5).map(function(item, idx) {
      const text = item.summary || item.snippet || item.content || '';
      return (idx + 1) + '. ' + (item.title || 'source') + '\n' + text.substring(0, 260);
    }).join('\n\n');
    return [
      '【背景搜索摘要】',
      '关键词：' + query,
      picked || '未抓取到可用正文，只有搜索结果链接。',
      '',
      '【使用建议】',
      '优先参考已抓取正文的来源；仅有 snippet 的来源只能作为线索，不能直接当作事实依据。'
    ].join('\n');
  }

  function buildWebResearchMessages(query, sourceText) {
    return [
      {
        role: 'system',
        content: [
          '你是短视频文案工作流的联网背景研究助手。',
          '请使用联网搜索工具查找与任务直接相关的最新事实，优先采用权威来源。',
          '你的目标不是堆搜索结果，而是给后续短视频文案提供可靠背景。',
          '只输出中文 Markdown；不要写成成稿文案；不要编造没查到的信息。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          '搜索主题：' + query,
          sourceText ? '上游素材/结构拆解（用于判断相关性）：\n' + sourceText.substring(0, 3200) : '',
          '输出格式固定为：',
          '## 检索结论',
          '- 3-5 条，必须与上游素材直接相关。',
          '## 关键信息',
          '- 带日期、人物、品牌、产品、事件节点等可核验事实；信息不足就写“信息不足”。',
          '## 来源',
          '- 列出站点名和链接。',
          '## 给文案的使用建议',
          '- 说明哪些事实可用、哪些点不要放大或需要谨慎。',
          '',
          '规则：',
          '- 如果搜索结果与上游素材偏离，明确写“背景搜索不建议纳入主文案”。',
          '- 不要使用没有来源支撑的最新事实。',
          '- 总长度控制在 900 字以内。'
        ].filter(Boolean).join('\n\n')
      }
    ];
  }

  function summarizeWebResearchFailure(error) {
    const message = String(error && error.message || error || '');
    if (/timeout|timed out|UND_ERR_CONNECT_TIMEOUT|ETIMEDOUT|524/i.test(message)) return '模型联网搜索超时';
    if (/ECONNRESET|ECONNREFUSED|SocketError|fetch failed|socket hang up/i.test(message)) return '模型联网搜索没连上';
    if (/ENOTFOUND|EAI_AGAIN|DNS/i.test(message)) return '模型联网搜索域名解析失败';
    if (/401|403|unauthorized|forbidden/i.test(message)) return '模型联网搜索鉴权异常';
    if (/429|rate limit/i.test(message)) return '模型联网搜索被限流';
    return message.substring(0, 160);
  }

  function runNativeHotResearch(query, sourceText) {
    if (!callWebSearchResearch) return Promise.reject(new Error('web_search not configured'));
    return callWebSearchResearch(buildWebResearchMessages(query, sourceText), {
      model: 'gpt-5.5',
      maxOutputTokens: 1800,
      timeoutMs: 180000
    }).then(function(text) {
      if (!String(text || '').trim()) throw new Error('原生联网搜索未返回可用结果');
      return {
        results: [{
          title: '模型联网背景研究',
          link: '',
          content: text,
          summary: text,
          source: 'responses:web_search',
          content_status: 'research'
        }],
        query: query,
        queries: [query],
        analysis: text,
        source: 'responses:web_search',
        errors: [],
        mode: 'web_research'
      };
    });
  }

  function summarizeHotResults(query, sourceText, results, cb) {
    const usable = (results || []).filter(function(item) {
      return item.content || item.summary || item.snippet;
    }).slice(0, 6);
    if (!usable.length) {
      cb('');
      return;
    }
    const sources = usable.map(function(item, idx) {
      const text = (item.content || item.summary || item.snippet || '').substring(0, 1400);
      return [
        '来源' + (idx + 1),
        '标题：' + (item.title || ''),
        '链接：' + (item.link || ''),
        '正文/摘要：' + text
      ].join('\n');
    }).join('\n\n---\n\n');
    const messages = [
      {
        role: 'system',
        content: '你是短视频文案工作流的背景研究质检助手。你的任务不是堆资料，而是判断搜索结果是否和上游素材相关、是否能作为文案事实依据。只基于给定来源，不编造事实；低相关、只有搜索摘要、无法验证的内容要明确弃用。'
      },
      {
        role: 'user',
        content: [
          '搜索关键词：' + query,
          sourceText ? '上游转写/结构拆解（用来判断相关性）：\n' + sourceText.substring(0, 2200) : '',
          '请先逐条判断来源与上游素材是否相关，再输出一份极简结论。',
          '输出格式：',
          '## 可用结论',
          '- 只写与上游素材直接相关、且来源能支撑的事实，最多 5 条。',
          '## 弃用/谨慎',
          '- 列出低相关、只有 snippet、无法验证、或会污染文案的点，最多 5 条。',
          '## 给文案的建议',
          '- 说明背景搜索在本轮该用/少用/不用，以及原因。',
          '',
          '规则：',
          '- 不要按来源复述长篇背景。',
          '- 不要输出“选题角度”大杂烩。',
          '- 如果搜索结果整体偏离上游素材，直接说“背景搜索不建议纳入主文案”。',
          '- 保持 600 字以内。',
          '',
          '搜索来源：',
          sources
        ].filter(Boolean).join('\n\n')
      }
    ];
    const fallback = buildHotAnalysisFallback(query, results);
    if (callOpenAICompatible) {
      callOpenAICompatible(messages, {
        model: 'gpt-5.5',
        temperature: 0.2,
        maxTokens: 1800
      }).then(function(reply) {
        cb(reply || fallback);
      }).catch(function(err) {
        logger.warn('/api/hot/search analysis failed', err);
        cb(fallback);
      });
      return;
    }
    if (callMiniMaxChat) {
      callMiniMaxChat(messages[0].content, messages[1].content, 1800, { temperature: 0.2 }).then(function(reply) {
        cb(reply || fallback);
      }).catch(function(err) {
        logger.warn('/api/hot/search analysis failed', err);
        cb(fallback);
      });
      return;
    }
    cb(fallback);
  }

  function extractPlatformKeywords(text) {
    const source = String(text || '');
    const noise = [
      '一句话判断', '这是一条', '热点素材', '相关视频', '平台搜索', '关键词',
      '转写原文', '结构分析', '背景搜索', '向量素材', '汇总报告', '文案',
      '视频', '内容', '分析', '素材', '借势', '切入点', '框架', '结尾',
      '目标受众', '传播要素', '情绪弧线', '黄金句', '可以', '通过'
    ];
    let cleaned = source.replace(/```[\s\S]*?```/g, ' ').replace(/["'{}[\]:,]/g, ' ');
    noise.forEach(function(word) { cleaned = cleaned.split(word).join(' '); });
    const candidates = [];
    function add(value) {
      const v = String(value || '')
        .replace(/^(关于|围绕|针对|借|蹭|与|和|的|了|是|在|用|把)+/g, '')
        .replace(/(相关|素材|事件|热点|话题|内容|视频|文案|分析)+$/g, '')
        .trim();
      if (v.length >= 2 && v.length <= 16 && candidates.indexOf(v) < 0) candidates.push(v);
    }
    (cleaned.match(/《([^》]{2,20})》/g) || []).forEach(function(x) { add(x.replace(/[《》]/g, '')); });
    (cleaned.match(/#[\u4e00-\u9fa5A-Za-z0-9_]{2,24}/g) || []).forEach(function(x) { add(x.slice(1)); });
    (cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:广告|联动|官宣|翻车|塌房|回应|道歉|离婚|上线|发布|代言|直播|爆料|争议|热搜)/g) || []).forEach(add);
    (cleaned.match(/[\u4e00-\u9fa5]{2,4}(?=拍广告|代言|联动|官宣|回应|道歉|翻车|离婚|上线|热搜)/g) || []).forEach(add);
    (cleaned.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,12}/g) || []).forEach(add);
    const useful = candidates
      .filter(function(x) { return !noise.some(function(n) { return x === n || x.indexOf(n) >= 0; }); })
      .filter(function(x) { return !/^(这个|一个|因为|所以|但是|他们|我们|如果|现在|就是|没有|进行|需要|用户|模块)$/.test(x); });
    const primary = useful.slice(0, 2);
    const action = useful.find(function(x) { return /广告|联动|官宣|翻车|回应|道歉|离婚|上线|发布|代言|直播|爆料|争议|热搜/.test(x); });
    if (action && primary.indexOf(action) < 0) primary.push(action);
    if (primary.length) return primary.slice(0, 3).join(' ');
    const stopWords = new Set(['这个', '一个', '因为', '所以', '但是', '他们', '我们', '视频', '文案', '分析', '内容']);
    const matches = source.match(/[\u4e00-\u9fa5]{2,10}/g) || [];
    const picked = [];
    matches.forEach(function(word) {
      if (stopWords.has(word) || picked.indexOf(word) >= 0) return;
      if (picked.length < 4) picked.push(word);
    });
    return picked.join(' ');
  }

  function parseJsonLoose(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) {}
    const firstArray = raw.indexOf('[');
    const lastArray = raw.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
      try { return JSON.parse(raw.slice(firstArray, lastArray + 1)); } catch (e) {}
    }
    const firstObj = raw.indexOf('{');
    const lastObj = raw.lastIndexOf('}');
    if (firstObj >= 0 && lastObj > firstObj) {
      try { return JSON.parse(raw.slice(firstObj, lastObj + 1)); } catch (e) {}
    }
    return null;
  }

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeBvid(value) {
    const match = String(value || '').match(/BV[0-9A-Za-z]+/);
    return match ? match[0] : '';
  }

  function extractAwemeId(value) {
    const text = String(value || '');
    const videoMatch = text.match(/douyin\.com\/video\/(\d{15,20})/i);
    if (videoMatch) return videoMatch[1];
    const anyMatch = text.match(/(?<!\d)(\d{15,20})(?!\d)/);
    return anyMatch ? anyMatch[1] : '';
  }

  function extractDouyinUrl(value) {
    const text = String(value || '');
    const match = text.match(/https?:\/\/(?:[a-z0-9-]+\.)?(?:douyin|iesdouyin)\.com\/[^\s"'<>，。！？；：、）】》」』\]\)}]+/i);
    if (match) return match[0];
    const awemeId = extractAwemeId(text);
    return awemeId ? 'https://www.douyin.com/video/' + awemeId : '';
  }

  function pickOpenCliName(value) {
    if (!value) return '';
    if (typeof value === 'string') return stripHtml(value).replace(/\s*\(mid:\s*\d+\)\s*$/i, '').trim();
    if (Array.isArray(value)) {
      for (const item of value) {
        const picked = pickOpenCliName(item);
        if (picked) return picked;
      }
      return '';
    }
    if (typeof value === 'object') {
      const direct = value.author || value.nickname || value.name || value.owner || value.user || value.account || value.creator || value.up;
      const pickedDirect = pickOpenCliName(direct);
      if (pickedDirect) return pickedDirect;
      const nested = value.data || value.result || value.item || value.aweme || value.aweme_info || value.video || value.profile;
      return pickOpenCliName(nested);
    }
    return '';
  }

  function cleanAuthorCandidate(value) {
    const text = stripHtml(value)
      .replace(/^[\s\-:：]+|[\s\-:：]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || text.length > 40) return '';
    if (/抖音|视频|评论|关注|粉丝|获赞|发布时间|认证徽章|加载中|举报|全部评论|客户端|推荐|精选/.test(text)) return '';
    return text;
  }

  function pickDouyinAuthorFromPage(payload) {
    const metaContents = [];
    const metas = payload && Array.isArray(payload.metas) ? payload.metas : [];
    metas.forEach(function(meta) {
      if (meta && meta.content) metaContents.push(String(meta.content));
    });

    for (const content of metaContents) {
      const match = content.match(/-\s*([^-\n\r]{1,40}?)于\d{8}发布在抖音/);
      const author = cleanAuthorCandidate(match && match[1]);
      if (author) return author;
    }

    for (const content of metaContents) {
      const match = content.match(/-\s*([^-\n\r]{1,40}?)于\d{4}[-年]?\d{1,2}/);
      const author = cleanAuthorCandidate(match && match[1]);
      if (author) return author;
    }

    const text = String(payload && payload.text || '');
    const pagePatterns = [
      /(?:^|\n)([^\n]{1,40})\s*\n认证徽章/i,
      /(?:^|\n)([^\n]{1,40})\s*\n\s*粉丝[\d.万亿kK]+\s*获赞/i,
      /加载中\s*\n([^\n]{1,40})\s*\n认证徽章/i
    ];
    for (const pattern of pagePatterns) {
      const match = text.match(pattern);
      const author = cleanAuthorCandidate(match && match[1]);
      if (author) return author;
    }

    return '';
  }

  function runCommand(command, args, options) {
    return new Promise(function(resolve) {
      const useCmd = process.platform === 'win32' && /\.cmd$/i.test(command);
      const spawnCommand = useCmd ? (process.env.ComSpec || 'cmd.exe') : command;
      const spawnArgs = useCmd ? ['/d', '/s', '/c', command].concat(args || []) : (args || []);
      const proc = spawn(spawnCommand, spawnArgs, {
        cwd: options && options.cwd || root,
        windowsHide: true
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(function() {
        try { proc.kill(); } catch (e) {}
        resolve({ ok: false, code: -1, stdout: stdout, stderr: stderr + '\ntimeout' });
      }, options && options.timeout || 30000);
      proc.stdout.on('data', function(chunk) { stdout += chunk.toString('utf8'); });
      proc.stderr.on('data', function(chunk) { stderr += chunk.toString('utf8'); });
      proc.on('error', function(err) {
        clearTimeout(timer);
        resolve({ ok: false, code: -1, stdout: stdout, stderr: err.message });
      });
      proc.on('close', function(code) {
        clearTimeout(timer);
        resolve({ ok: code === 0, code: code, stdout: stdout, stderr: stderr });
      });
    });
  }

  function platformOpenCliBin() {
    const preferred = process.env.OPENCLI_BIN || process.env.USAGI_OPENCLI_PATH || 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\opencli.cmd';
    if (preferred && fs.existsSync(preferred)) return preferred;
    return process.platform === 'win32' ? 'opencli.cmd' : 'opencli';
  }

  function runPlayCountOpenCli(args, timeout) {
    if (fs.existsSync(openCliMain)) {
      return runCommand(process.execPath, [openCliMain].concat(args || []), { timeout: timeout || 30000 });
    }
    return runCommand(platformOpenCliBin(), args || [], { timeout: timeout || 30000 });
  }

  const douyinPlayCountState = {
    running: false,
    lastResult: null,
    cooldowns: new Map(),
    profileArgs: null,
    launchedChromePid: 0
  };

  function encodeOpenCliBrowserEval(source) {
    return 'eval(atob(' + JSON.stringify(Buffer.from(String(source || ''), 'utf8').toString('base64')) + '))';
  }

  function douyinPlayCountProfileArgs() {
    if (Array.isArray(douyinPlayCountState.profileArgs)) return douyinPlayCountState.profileArgs.slice();
    const profile = String(
      process.env.CHABOFANG_OPENCLI_PROFILE
      || process.env.DOUYIN_PLAY_COUNT_OPENCLI_PROFILE
      || process.env.ACCOUNT_DATA_OPENCLI_PROFILE
      || 'collector-link-crawl'
    ).trim();
    return profile ? ['--profile', profile] : [];
  }

  function douyinPlayCountPreferredProfile() {
    return String(
      process.env.CHABOFANG_OPENCLI_PROFILE
      || process.env.DOUYIN_PLAY_COUNT_OPENCLI_PROFILE
      || process.env.ACCOUNT_DATA_OPENCLI_PROFILE
      || 'collector-link-crawl'
    ).trim();
  }

  function chromeBin() {
    const candidates = [
      process.env.CHROME_BIN,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);
    return candidates.find(function(file) { return fs.existsSync(file); }) || 'chrome.exe';
  }

  function chromeUserDataDir() {
    return process.env.CHROME_USER_DATA_DIR
      || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
  }

  function launchPlayCountChromeProfile(profileAlias) {
    const profile = String(profileAlias || '').trim();
    const profileDirectory = chromeProfiles[profile] || '';
    if (!profileDirectory) return { ok: false, error: '没有找到 Chrome Profile 映射：' + profile, profile };
    const hasOpenCliExtension = fs.existsSync(path.join(openCliExtensionDir, 'manifest.json'));
    const args = [
      '--new-window',
      '--user-data-dir=' + chromeUserDataDir(),
      '--no-first-run',
      '--no-default-browser-check',
      '--profile-directory=' + profileDirectory
    ];
    if (hasOpenCliExtension) args.push('--load-extension=' + openCliExtensionDir);
    args.push('https://chabofang.com/');
    try {
      const child = spawn(chromeBin(), args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();
      return { ok: true, profile, profileDirectory, pid: child.pid || 0, extensionDir: hasOpenCliExtension ? openCliExtensionDir : '' };
    } catch (e) {
      return { ok: false, profile, profileDirectory, error: e.message || String(e) };
    }
  }

  function isOpenCliProfileDisconnected(result) {
    return /Browser profile .*not connected|No Browser Bridge profiles connected|not connected|OpenCLI Browser Bridge not connected/i.test(
      String(result && (result.stderr || result.stdout) || '')
    );
  }

  function pickConnectedOpenCliProfile(text) {
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      if (!/connected/i.test(line) || /not connected|Disconnected/i.test(line)) continue;
      if (/Connected Browser Bridge profiles|No Browser Bridge profiles|Update available|Run:/i.test(line)) continue;
      const match = line.match(/^\s*(\S+)\s+(\S+)\s+.*connected/i);
      if (match && !/^Browser$/i.test(match[2] || '')) return match[2] || match[1];
    }
    return '';
  }

  async function listConnectedPlayCountProfile() {
    const listed = await runPlayCountOpenCli(['profile', 'list'], 8000);
    return pickConnectedOpenCliProfile((listed.stdout || '') + '\n' + (listed.stderr || ''));
  }

  async function connectedPlayCountProfileArgs(forceLaunch) {
    const preferred = douyinPlayCountPreferredProfile();
    let profile = '';
    if (forceLaunch) {
      const launched = launchPlayCountChromeProfile(preferred);
      if (launched && launched.pid) douyinPlayCountState.launchedChromePid = launched.pid;
      logger.info('/api/douyin/play-count launched fresh chrome profile', launched);
      if (launched && launched.ok) {
        douyinPlayCountState.profileArgs = ['--profile', preferred];
        // Start browser work immediately. The bind loop below waits for the bridge,
        // avoiding several seconds of profile-list polling before the first action.
        return douyinPlayCountState.profileArgs.slice();
      }
    } else {
      profile = await listConnectedPlayCountProfile().catch(function() { return ''; });
    }
    if (!profile) {
      if (!forceLaunch) {
      const launched = launchPlayCountChromeProfile(preferred);
      if (launched && launched.pid) douyinPlayCountState.launchedChromePid = launched.pid;
      logger.info('/api/douyin/play-count launched chrome profile', launched);
      }
      const deadline = Date.now() + Number(process.env.DOUYIN_PLAY_COUNT_PROFILE_CONNECT_TIMEOUT_MS || 8000);
      while (Date.now() < deadline) {
        await delay(100);
        profile = await listConnectedPlayCountProfile().catch(function() { return ''; });
        if (profile) break;
      }
    }
    if (!profile) return [];
    douyinPlayCountState.profileArgs = ['--profile', profile];
    return douyinPlayCountState.profileArgs.slice();
  }

  async function runPlayCountBrowser(session, args, timeout, options) {
    const finalArgs = ['browser', session].concat(args || []);
    const result = await runPlayCountOpenCli(douyinPlayCountProfileArgs().concat(finalArgs), timeout || 30000);
    if (!isOpenCliProfileDisconnected(result)) return result;
    if (options && options.noFallback) return result;
    const fallbackProfileArgs = await connectedPlayCountProfileArgs().catch(function() { return []; });
    if (!fallbackProfileArgs.length) return result;
    return runPlayCountOpenCli(fallbackProfileArgs.concat(finalArgs), timeout || 30000);
  }

  function normalizeDouyinPlayCountKey(input) {
    const awemeId = extractAwemeId(input);
    if (awemeId) return awemeId;
    const url = extractDouyinUrl(input);
    return (url || String(input || '')).trim().toLowerCase().replace(/[?#].*$/, '');
  }

  function douyinPlayCountCooldownMs() {
    const minutes = Number(process.env.DOUYIN_PLAY_COUNT_COOLDOWN_MINUTES || process.env.CHABOFANG_COOLDOWN_MINUTES || 180);
    return Math.max(1, minutes || 180) * 60 * 1000;
  }

  function cleanupPlayCountCooldowns(now) {
    const at = now || Date.now();
    for (const entry of douyinPlayCountState.cooldowns.entries()) {
      if (!entry[1] || entry[1] <= at) douyinPlayCountState.cooldowns.delete(entry[0]);
    }
  }

  function playCountCooldownPayload(key) {
    cleanupPlayCountCooldowns();
    let next = 0;
    if (key) {
      next = Number(douyinPlayCountState.cooldowns.get(key) || 0);
    } else {
      for (const value of douyinPlayCountState.cooldowns.values()) {
        if (Number(value || 0) > next) next = Number(value || 0);
      }
    }
    return {
      running: douyinPlayCountState.running,
      lastResult: douyinPlayCountState.lastResult,
      nextAvailableAt: next > Date.now() ? new Date(next).toISOString() : '',
      cooldownSeconds: next > Date.now() ? Math.ceil((next - Date.now()) / 1000) : 0
    };
  }

  function numberFromPlayCountValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    const text = String(value || '').replace(/,/g, '').trim();
    if (!text) return 0;
    const match = text.match(/([\d.]+)\s*(亿|万|k|K)?/);
    if (!match) return 0;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return 0;
    const unit = match[2];
    if (unit === '亿') return Math.round(base * 100000000);
    if (unit === '万') return Math.round(base * 10000);
    if (unit === 'k' || unit === 'K') return Math.round(base * 1000);
    return Math.round(base);
  }

  function buildPlayCountResult(raw) {
    const data = raw && (raw.data || raw.result || raw);
    const comprehensive = numberFromPlayCountValue(
      data && (data.vv_cnt || data.comprehensivePlayCount || data.comprehensive_play_count || data.total_play_count || data.video_play_count)
    );
    const natural = numberFromPlayCountValue(
      data && (data.play_count || data.naturalPlayCount || data.natural_play_count || data.real_play_count)
    );
    if (!comprehensive && !natural) return null;
    const finalComprehensive = comprehensive || natural;
    const finalNatural = natural || comprehensive;
    return {
      comprehensivePlayCount: finalComprehensive,
      comprehensive_play_count: finalComprehensive,
      naturalPlayCount: finalNatural,
      natural_play_count: finalNatural,
      awemeId: data && (data.aweme_id || data.awemeId) || '',
      verdict: finalComprehensive < 100000 || finalComprehensive - finalNatural > 10000
        ? '该视频虚量较少，结果仅供参考'
        : '该视频虚量较多，结果仅供参考',
      source: 'chabofang.com'
    };
  }

  async function postChabofangPlayCount(videoUrl, turnstileToken) {
    const controller = new AbortController();
    const timer = setTimeout(function() {
      controller.abort();
    }, Number(process.env.DOUYIN_PLAY_COUNT_SITE_TIMEOUT_MS || 30000));
    try {
      const response = await fetch('https://chabofang.com/webapi/chabofangliang', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://chabofang.com',
          'Referer': 'https://chabofang.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
        },
        body: JSON.stringify({ video_url: videoUrl, turnstile_token: turnstileToken }),
        signal: controller.signal
      });
      const json = await response.json().catch(function() { return null; });
      if (!response.ok) {
        return { ok: false, reason: 'http_' + response.status, message: '查播放接口请求失败', payload: json };
      }
      if (!json || json.code !== 0) {
        return { ok: false, reason: 'site_failed', message: json && json.msg || '查播放接口未返回成功', payload: json };
      }
      return { ok: true, data: json.data || json };
    } catch (e) {
      return { ok: false, reason: e && e.name === 'AbortError' ? 'site_timeout' : 'site_request_failed', message: e && e.name === 'AbortError' ? '查播放接口请求超时' : (e.message || String(e)) };
    } finally {
      clearTimeout(timer);
    }
  }

  async function waitChabofangTurnstileToken(session) {
    const deadline = Date.now() + Number(process.env.DOUYIN_PLAY_COUNT_TOKEN_TIMEOUT_MS || 15000);
    const tokenJs = encodeOpenCliBrowserEval(`
      (() => {
        const tokenEl = document.querySelector('input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"], [name="cf-turnstile-response"]');
        const text = document.body && document.body.innerText || '';
        return {
          ok: true,
          token: tokenEl && tokenEl.value || '',
          hasTurnstile: Boolean(window.turnstile),
          text: text.slice(0, 900)
        };
      })()
    `);
    while (Date.now() < deadline) {
      const result = await runPlayCountBrowser(session, ['eval', tokenJs], 10000);
      const payload = parseJsonLoose(result.stdout);
      if (result.ok && payload && payload.token) return payload.token;
      await delay(400);
    }
    return '';
  }

  async function clickChabofangHumanVerification(session, videoUrl) {
    const prepareTargetJs = encodeOpenCliBrowserEval(`
      (() => {
        const videoInput = document.querySelector('#douyin-video-url');
        if (videoInput) {
          const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
          if (descriptor && descriptor.set) descriptor.set.call(videoInput, ${JSON.stringify(videoUrl || '')});
          else videoInput.value = ${JSON.stringify(videoUrl || '')};
          videoInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
          videoInput.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const input = document.querySelector('[name="cf-turnstile-response"]');
        const host = input && input.parentElement;
        if (!host) return { ok: false, reason: 'no_turnstile_host' };
        host.id = 'usagi-turnstile-checkbox-target';
        host.style.width = '44px';
        host.style.height = '70px';
        host.style.overflow = 'visible';
        const rect = host.getBoundingClientRect();
        return { ok: rect.width > 0 && rect.height > 0, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      })()
    `);
    const prepared = await runPlayCountBrowser(session, ['eval', prepareTargetJs], 8000).catch(function() { return null; });
    const preparedPayload = parseJsonLoose(prepared && prepared.stdout);
    if (prepared && prepared.ok && preparedPayload && preparedPayload.ok) {
      const clicked = await runPlayCountBrowser(session, ['click', '#usagi-turnstile-checkbox-target'], 5000).catch(function() { return null; });
      const clickedPayload = parseJsonLoose(clicked && clicked.stdout);
      const clickedResult = clickedPayload && (clickedPayload.data || clickedPayload.result || clickedPayload);
      if (clicked && clicked.ok && (!clickedResult || clickedResult.clicked !== false)) return true;
    }

    const attempts = [
      ['check', '--role', 'checkbox'],
      ['click', '--role', 'checkbox'],
      ['click', 'input[type="checkbox"]']
    ];
    for (const args of attempts) {
      const result = await runPlayCountBrowser(session, args, 5000).catch(function() { return null; });
      const payload = parseJsonLoose(result && result.stdout);
      const clickResult = payload && (payload.data || payload.result || payload);
      if (result && result.ok && clickResult && (clickResult.clicked || clickResult.checked || clickResult.changed)) {
        return true;
      }
    }
    return false;
  }

  function findChabofangPlayCountPayload(value, seen, depth) {
    if (value === null || value === undefined || depth > 10) return null;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || (text[0] !== '{' && text[0] !== '[')) return null;
      try {
        return findChabofangPlayCountPayload(JSON.parse(text), seen, depth + 1);
      } catch (e) {
        return null;
      }
    }
    if (typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (Object.prototype.hasOwnProperty.call(value, 'vv_cnt')
      || Object.prototype.hasOwnProperty.call(value, 'play_count')) {
      return value;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'code')
      && (Number(value.code) !== 0 || value.msg || value.message)) {
      return value;
    }
    if (Object.prototype.hasOwnProperty.call(value, 'code') && value.data) {
      const nested = findChabofangPlayCountPayload(value.data, seen, depth + 1);
      if (nested) return value;
    }

    const preferredKeys = ['body', 'data', 'result', 'response', 'payload', 'entries'];
    for (const key of preferredKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const found = findChabofangPlayCountPayload(value[key], seen, depth + 1);
      if (found) return found;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findChabofangPlayCountPayload(item, seen, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  function unwrapOpenCliBrowserPayload(value) {
    let current = value;
    for (let depth = 0; depth < 6 && current && typeof current === 'object'; depth += 1) {
      const nested = current.data && typeof current.data === 'object'
        ? current.data
        : (current.result && typeof current.result === 'object' ? current.result : null);
      if (!nested) break;
      if (Object.prototype.hasOwnProperty.call(nested, 'ok')
        || Object.prototype.hasOwnProperty.call(nested, 'body')
        || Object.prototype.hasOwnProperty.call(nested, 'error')
        || Object.prototype.hasOwnProperty.call(nested, 'triggered')) {
        current = nested;
        continue;
      }
      break;
    }
    return current;
  }

  function chabofangResultFromValue(value) {
    const payload = findChabofangPlayCountPayload(value, new Set(), 0);
    if (!payload) {
      return { ok: false, reason: 'site_failed', message: '播放量接口已返回，但结果格式无法识别' };
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'code') && Number(payload.code) !== 0) {
      return {
        ok: false,
        reason: 'site_failed',
        message: payload.msg || payload.message || '查播放页面返回查询失败'
      };
    }
    return { ok: true, data: payload.data || payload };
  }

  function findChabofangNetworkBody(value, seen, depth) {
    if (!value || typeof value !== 'object' || depth > 10 || seen.has(value)) return null;
    seen.add(value);
    const url = String(value.url || value.href || value.requestUrl || '').toLowerCase();
    if (url.includes('/webapi/chabofangliang')) {
      return value.body || value.response || value.data || value;
    }
    for (const nested of Object.values(value)) {
      if (!nested || typeof nested !== 'object') continue;
      const found = findChabofangNetworkBody(nested, seen, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function parseChabofangNetworkCommand(result) {
    if (!result || (!result.ok && !result.stdout)) return null;
    const raw = String(result.stdout || '').trim();
    const candidates = [];
    const whole = parseJsonLoose(raw);
    if (whole) candidates.push(whole);
    for (const line of raw.split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text[0] !== '{' && text[0] !== '[') continue;
      try { candidates.push(JSON.parse(text)); } catch (e) {}
    }
    for (const candidate of candidates) {
      const body = findChabofangNetworkBody(candidate, new Set(), 0);
      const payload = findChabofangPlayCountPayload(body || candidate, new Set(), 0);
      if (!payload) continue;
      return chabofangResultFromValue(body || candidate);
    }
    return null;
  }

  async function waitForChabofangNetworkResult(session) {
    const deadline = Date.now() + Number(process.env.DOUYIN_PLAY_COUNT_RESULT_TIMEOUT_MS || 10000);
    while (Date.now() < deadline) {
      const network = await runPlayCountBrowser(
        session,
        ['network', '--since', '30s', '--filter', 'vv_cnt,play_count', '--raw'],
        4000,
        { noFallback: true }
      ).catch(function() { return null; });
      const parsed = parseChabofangNetworkCommand(network);
      if (parsed) return parsed;
      await delay(100);
    }
    return null;
  }

  function parseChabofangCapturedResult(captured) {
    const capturePayload = unwrapOpenCliBrowserPayload(parseJsonLoose(captured && captured.stdout));
    if (!captured || !captured.ok || !capturePayload || !capturePayload.ok) {
      return {
        ok: false,
        reason: capturePayload && capturePayload.reason || 'site_failed',
        message: capturePayload && capturePayload.error || '查询页面没有返回播放量接口结果'
      };
    }
    return chabofangResultFromValue(capturePayload.body);
  }

  async function queryChabofangInBrowser(session, videoUrl) {
    const prepareJs = encodeOpenCliBrowserEval(`
      (async () => {
        const value = ${JSON.stringify(videoUrl)};
        const input = document.querySelector('#douyin-video-url');
        if (!input) return { ok: false, error: '查播放页面输入框未加载完成' };
        const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(input, value);
        else input.value = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        const tokenDeadline = Date.now() + 2500;
        let token = '';
        while (Date.now() < tokenDeadline) {
          const tokenEl = document.querySelector('[name="cf-turnstile-response"]');
          token = tokenEl && tokenEl.value || '';
          if (token) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!token) return { ok: false, error: '安全验证未完成' };

        window.__usagiChabofangResponse = null;
        if (!window.__usagiChabofangCaptureInstalled) {
          window.__usagiChabofangCaptureInstalled = true;
          const originalFetch = window.fetch;
          window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            const requestUrl = String(args[0] && args[0].url || args[0] || '');
            if (requestUrl.includes('/webapi/chabofangliang')) {
              window.__usagiChabofangRequestStarted = true;
              response.clone().text().then(text => {
                window.__usagiChabofangResponse = text;
              }).catch(() => {});
            }
            return response;
          };

          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, requestUrl, ...rest) {
            this.__usagiRequestUrl = String(requestUrl || '');
            if (this.__usagiRequestUrl.includes('/webapi/chabofangliang')) {
              window.__usagiChabofangRequestStarted = true;
            }
            this.addEventListener('loadend', function() {
              if (this.__usagiRequestUrl.includes('/webapi/chabofangliang')) {
                window.__usagiChabofangResponse = this.responseText || '';
              }
            }, { once: true });
            return originalOpen.call(this, method, requestUrl, ...rest);
          };
        }
        window.__usagiChabofangRequestStarted = false;
        window.__usagiChabofangSubmitStarted = false;
        const form = input.closest('form');
        if (form && !form.__usagiSubmitListenerInstalled) {
          form.__usagiSubmitListenerInstalled = true;
          form.addEventListener('submit', () => {
            window.__usagiChabofangSubmitStarted = true;
          }, true);
        }
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find(item => (item.innerText || item.textContent || '').replace(/\s+/g, '') === '\u7acb\u5373\u67e5\u8be2')
          || document.querySelector('button[type="submit"]');
        if (!button || button.disabled) {
          return { ok: false, error: button && button.innerText || '查询按钮不可用' };
        }
        button.id = 'usagi-chabofang-query-button';
        return { ok: true, value: input.value, tokenLength: token.length, buttonText: (button.innerText || button.textContent || '').trim() };
      })()
    `);
    const prepared = await runPlayCountBrowser(session, ['eval', prepareJs], 10000).catch(function() { return null; });
    const preparedPayload = unwrapOpenCliBrowserPayload(parseJsonLoose(prepared && prepared.stdout));
    if (!prepared || !prepared.ok || !preparedPayload || !preparedPayload.ok) {
      return {
        ok: false,
        reason: 'cloudflare',
        message: preparedPayload && preparedPayload.error || '安全验证未完成'
      };
    }

    const clicked = await runPlayCountBrowser(
      session,
      ['click', '#usagi-chabofang-query-button'],
      5000,
      { noFallback: true }
    ).catch(function() { return null; });
    const clickedPayload = unwrapOpenCliBrowserPayload(parseJsonLoose(clicked && clicked.stdout));
    const clickedResult = clickedPayload && (clickedPayload.data || clickedPayload.result || clickedPayload);
    if (!clicked || !clicked.ok || (clickedResult && clickedResult.clicked === false)) {
      const fallbackClickJs = encodeOpenCliBrowserEval(`
        (() => {
          const button = document.querySelector('#usagi-chabofang-query-button');
          if (!button || button.disabled) return { ok: false };
          const form = button.form || button.closest('form');
          if (form && typeof form.requestSubmit === 'function') form.requestSubmit(button);
          else button.click();
          return { ok: true };
        })()
      `);
      const fallbackClicked = await runPlayCountBrowser(session, ['eval', fallbackClickJs], 5000, { noFallback: true }).catch(function() { return null; });
      const fallbackPayload = unwrapOpenCliBrowserPayload(parseJsonLoose(fallbackClicked && fallbackClicked.stdout));
      if (!fallbackClicked || !fallbackClicked.ok || !fallbackPayload || !fallbackPayload.ok) {
        return { ok: false, reason: 'query_button', message: '查询按钮没有点击成功' };
      }
    }

    const networkResult = await waitForChabofangNetworkResult(session);
    if (networkResult) return networkResult;

    const resultJs = encodeOpenCliBrowserEval(`
      (async () => {
        const readVisibleResult = () => {
          const text = (document.body && document.body.innerText || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
          const read = label => {
            const index = text.indexOf(label);
            if (index < 0) return '';
            const match = text.slice(index + label.length, index + label.length + 160).match(/([\d,.]+\s*(?:万|亿|[kK])?)/);
            return match && match[1] ? match[1].replace(/\s+/g, '') : '';
          };
          const comprehensive = read('综合播放量') || read('综合播放');
          const natural = read('自然播放量') || read('自然播放');
          if (!comprehensive && !natural) return null;
          return {
            code: 0,
            data: {
              vv_cnt: comprehensive || natural,
              play_count: natural || comprehensive
            }
          };
        };
        const visibleResult = readVisibleResult();
        if (visibleResult) return { ok: true, body: visibleResult };
        const pageText = document.body && document.body.innerText || '';
        const errorMatch = pageText.match(/(查询失败[^\n]*|请稍后重试[^\n]*|请求过于频繁[^\n]*|\d+S后可用)/);
        return { ok: false, reason: 'site_failed', error: errorMatch && errorMatch[1] || '查询已提交，但没有读取到播放量接口结果' };
      })()
    `);
    const captured = await runPlayCountBrowser(session, ['eval', resultJs], 5000, { noFallback: true }).catch(function() { return null; });
    const capturedResult = parseChabofangCapturedResult(captured);
    if (capturedResult.ok) return capturedResult;

    // Never submit a second request here. The first request may already have
    // succeeded on the page, while a retry can hit the site's per-video limit.
    return capturedResult;
  }

  function collectChabofangTabIds(value, output, seen, depth) {
    if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) {
      const url = String(value.url || value.href || '').toLowerCase();
      const id = String(value.page || value.targetId || value.target_id || value.id || '').trim();
      if (id && url.includes('chabofang.com')) output.add(id);
    }
    for (const nested of Object.values(value)) {
      if (nested && typeof nested === 'object') collectChabofangTabIds(nested, output, seen, depth + 1);
    }
  }

  async function closeChabofangBrowser(session, openedPageId) {
    const launchedPid = Number(douyinPlayCountState.launchedChromePid || 0);
    if (launchedPid) {
      douyinPlayCountState.launchedChromePid = 0;
      douyinPlayCountState.profileArgs = null;
      if (process.platform === 'win32') {
        await runCommand('taskkill.exe', ['/PID', String(launchedPid), '/T', '/F'], { timeout: 5000 }).catch(function() { return null; });
      } else {
        try { process.kill(launchedPid, 'SIGTERM'); } catch (e) {}
      }
      return;
    }
    try {
      if (openedPageId) {
        const closed = await runPlayCountBrowser(session, ['tab', 'close', openedPageId], 4000, { noFallback: true }).catch(function() { return null; });
        if (closed && closed.ok) return;
      }
      const pageIds = new Set();
      const tabs = await runPlayCountBrowser(session, ['tab', 'list'], 4000, { noFallback: true }).catch(function() { return null; });
      collectChabofangTabIds(parseJsonLoose(tabs && tabs.stdout), pageIds, new Set(), 0);
      for (const pageId of pageIds) {
        await runPlayCountBrowser(session, ['tab', 'close', pageId], 4000, { noFallback: true }).catch(function() { return null; });
      }
      if (!pageIds.size) {
        await runPlayCountBrowser(session, ['eval', encodeOpenCliBrowserEval('window.close(); true')], 3000, { noFallback: true }).catch(function() { return null; });
      }
    } finally {
      const launchedPid = Number(douyinPlayCountState.launchedChromePid || 0);
      douyinPlayCountState.launchedChromePid = 0;
      douyinPlayCountState.profileArgs = null;
      if (launchedPid) {
        if (process.platform === 'win32') {
          await runCommand('taskkill.exe', ['/PID', String(launchedPid), '/T', '/F'], { timeout: 5000 }).catch(function() { return null; });
        } else {
          try { process.kill(launchedPid, 'SIGTERM'); } catch (e) {}
        }
      }
    }
  }

  async function queryDouyinPlayCountWithChabofang(input) {
    const videoUrl = extractDouyinUrl(input) || String(input || '').trim();
    if (!videoUrl) throw new Error('请先粘贴抖音视频链接或分享口令');
    const session = ('chabofang-play-count-' + Date.now()).replace(/[^a-zA-Z0-9_-]/g, '-');
    const pageUrl = 'https://chabofang.com/';
    let openedSession = false;
    let openedPageId = '';

    try {
      openedSession = true;
      const profileArgs = await connectedPlayCountProfileArgs(true);
      if (!profileArgs.length) throw new Error('播放量查询浏览器连接失败');
      const bindDeadline = Date.now() + Number(process.env.DOUYIN_PLAY_COUNT_PROFILE_CONNECT_TIMEOUT_MS || 8000);
      let opened = null;
      while (Date.now() < bindDeadline) {
        opened = await runPlayCountBrowser(session, ['--window', 'foreground', 'bind'], 2500, { noFallback: true });
        if (opened && opened.ok) break;
        await delay(100);
      }
      let usedExistingPage = opened && opened.ok;
      if (!usedExistingPage) {
        opened = await runPlayCountBrowser(session, ['--window', 'foreground', 'open', pageUrl], 20000, { noFallback: true });
      }
      if (!opened || !opened.ok) throw new Error(opened && (opened.stderr || opened.stdout) || '打开查播放页面失败');
      const openedPayload = parseJsonLoose(opened.stdout);
      const openedResult = openedPayload && (openedPayload.data || openedPayload.result || openedPayload);
      openedPageId = String(openedResult && (openedResult.page || openedResult.targetId || openedResult.target_id) || '').trim();
      if (!usedExistingPage) {
        await runPlayCountBrowser(session, ['wait', 'time', '3'], 8000, { noFallback: true }).catch(function() { return null; });
      }
      await clickChabofangHumanVerification(session, videoUrl);

      const payload = await queryChabofangInBrowser(session, videoUrl);
      if (payload.ok === false) return payload;
      const result = buildPlayCountResult(payload);
      if (!result) throw new Error('查播放返回了结果，但没有解析到播放量');
      return { ok: true, result: result };
    } finally {
      if (openedSession) {
        await closeChabofangBrowser(session, openedPageId);
      }
    }
  }

  async function getDouyinAuthorByStats(sourceText) {
    const awemeId = extractAwemeId(sourceText);
    if (!awemeId) return { author: '', error: 'no aweme id' };
    const result = await runCommand(platformOpenCliBin(), ['douyin', 'stats', awemeId, '-f', 'json'], {
      timeout: 45000
    });
    if (!result.ok) {
      return { author: '', error: result.stderr || result.stdout || ('opencli exit ' + result.code) };
    }
    const parsed = parseJsonLoose(result.stdout);
    const author = pickOpenCliName(parsed);
    return { author: author, raw: parsed, source: 'opencli:douyin:stats' };
  }

  async function getDouyinAuthorByOpenCli(sourceText) {
    const pageUrl = extractDouyinUrl(sourceText);
    const errors = [];
    if (pageUrl) {
      const session = process.env.OPENCLI_DOUYIN_AUTHOR_SESSION || 'usagi-douyin-author';
      const openResult = await runCommand(platformOpenCliBin(), ['browser', session, 'open', pageUrl], {
        timeout: 60000
      });
      if (!openResult.ok) {
        errors.push(openResult.stderr || openResult.stdout || 'open page failed');
      } else {
        await runCommand(platformOpenCliBin(), ['browser', session, 'wait', 'time', '5'], {
          timeout: 20000
        });
        const js = "(() => ({ url: location.href, title: document.title, text: document.body.innerText.slice(0, 6000), metas: Array.from(document.querySelectorAll('meta')).slice(0, 100).map(m => ({ name: m.getAttribute('name') || '', property: m.getAttribute('property') || '', content: m.getAttribute('content') || '' })) }))()";
        const evalResult = await runCommand(platformOpenCliBin(), ['browser', session, 'eval', js], {
          timeout: 45000
        });
        if (evalResult.ok) {
          const parsed = parseJsonLoose(evalResult.stdout);
          const author = pickDouyinAuthorFromPage(parsed);
          if (author) return { author: author, raw: parsed, source: 'opencli:browser:douyin-page' };
          errors.push('opened page but no author found');
        } else {
          errors.push(evalResult.stderr || evalResult.stdout || 'page eval failed');
        }
      }
    } else {
      errors.push('no douyin url');
    }

    const statsResult = await getDouyinAuthorByStats(sourceText);
    if (statsResult.author) return statsResult;
    if (statsResult.error) errors.push(statsResult.error);
    return { author: '', error: errors.filter(Boolean).slice(0, 3).join('; ') };
  }

  function requestBiliSearch(query, limit) {
    return new Promise(function(resolve) {
      const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(query) + '&page=1';
      const req = https.get(url, {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 UsagiWorkspace/1.0',
          'Referer': 'https://www.bilibili.com/'
        }
      }, function(res) {
        let data = '';
        res.on('data', function(chunk) { data += chunk.toString('utf8'); });
        res.on('end', function() {
          try {
            const parsed = JSON.parse(data);
            const list = parsed && parsed.data && Array.isArray(parsed.data.result) ? parsed.data.result : [];
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              source: 'bilibili:public-api',
              items: list.slice(0, limit).map(function(item) {
                return {
                  title: stripHtml(item.title || ''),
                  author: stripHtml(item.author || ''),
                  url: item.arcurl || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
                  bvid: item.bvid || normalizeBvid(item.arcurl || ''),
                  duration: item.duration || '',
                  play: item.play || 0,
                  score: item.play || item.video_review || 0,
                  description: stripHtml(item.description || '')
                };
              })
            });
          } catch (e) {
            resolve({ ok: false, source: 'bilibili:public-api', error: e.message, items: [] });
          }
        });
      });
      req.on('timeout', function() {
        req.destroy();
        resolve({ ok: false, source: 'bilibili:public-api', error: 'timeout', items: [] });
      });
      req.on('error', function(err) {
        resolve({ ok: false, source: 'bilibili:public-api', error: err.message, items: [] });
      });
    });
  }

  async function searchBilibiliCandidates(query, limit) {
    const errors = [];
    const opencli = await runCommand(platformOpenCliBin(), ['bilibili', 'search', query, '--limit', String(limit), '-f', 'json'], {
      timeout: 45000
    });
    if (opencli.ok) {
      const parsed = parseJsonLoose(opencli.stdout);
      if (Array.isArray(parsed) && parsed.length) {
        return {
          ok: true,
          source: 'opencli:bilibili',
          items: parsed.slice(0, limit).map(function(item) {
            const url = item.url || item.link || item.arcurl || '';
            return {
              title: stripHtml(item.title || item.name || ''),
              author: stripHtml(item.author || item.owner || item.up || ''),
              url: url,
              bvid: item.bvid || normalizeBvid(url),
              duration: item.duration || '',
              play: item.play || item.score || item.views || 0,
              score: item.score || item.play || item.views || 0,
              description: stripHtml(item.description || item.snippet || '')
            };
          })
        };
      }
      errors.push('OpenCLI returned no parseable candidates');
    } else {
      errors.push(opencli.stderr || 'OpenCLI search failed');
    }

    const publicApi = await requestBiliSearch(query, limit);
    if (publicApi.ok && publicApi.items.length) return publicApi;
    if (publicApi.error) errors.push(publicApi.error);
    return { ok: false, source: 'none', items: [], error: errors.filter(Boolean).slice(0, 2).join('; ') || 'no candidates' };
  }

  function scorePlatformCandidate(item, intent, query) {
    const title = stripHtml(item.title || '');
    const author = stripHtml(item.author || '');
    const desc = stripHtml(item.description || item.snippet || '');
    const haystack = (title + ' ' + author + ' ' + desc).toLowerCase();
    const entities = (intent.entities || []).concat(String(query || '').split(/\s+/)).filter(Boolean);
    const intentTerms = intent.intent_terms || [];
    const excluded = intent.exclude_terms || [];
    let relevance = 0;
    entities.forEach(function(term) {
      const value = String(term || '').toLowerCase();
      if (value && haystack.indexOf(value) >= 0) relevance += 8;
    });
    intentTerms.forEach(function(term) {
      const value = String(term || '').toLowerCase();
      if (value && haystack.indexOf(value) >= 0) relevance += 4;
    });
    excluded.forEach(function(term) {
      const value = String(term || '').toLowerCase();
      if (value && haystack.indexOf(value) >= 0) relevance -= 20;
    });
    relevance += Math.min(6, Math.log10(Number(item.score || item.play || 0) + 1));
    return relevance;
  }

  function mapPlatformCandidate(item, index, intent, query) {
    const relevance = scorePlatformCandidate(item, intent, query);
    const bvid = item.bvid || normalizeBvid(item.url || '');
    const url = item.url || (bvid ? 'https://www.bilibili.com/video/' + bvid : '');
    return {
      id: bvid || ('bilibili-' + (index + 1)),
      platform: 'bilibili',
      title: stripHtml(item.title || '未命名视频'),
      author: stripHtml(item.author || ''),
      url: url,
      bvid: bvid,
      duration: item.duration || '',
      metrics: item.play ? ('播放 ' + item.play) : '',
      score: item.score || item.play || 0,
      relevance: Math.round(relevance * 10) / 10,
      reason: relevance > 8 ? '标题/作者命中主体或意图词' : '按搜索词召回，建议人工预览确认',
      selected: false,
      transcript: ''
    };
  }

  function publicPayload(body) {
    const payload = {};
    Object.keys(body || {}).forEach(function(key) {
      if (key.charAt(0) === '_') return;
      payload[key] = body[key];
    });
    return payload;
  }

  function readJsonFile(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  function readTextFile(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return '';
    }
  }

  function makeStylePreview(style) {
    return cleanText(style).replace(/[#*_>`-]/g, '').replace(/\s+/g, ' ').slice(0, 180);
  }

  function styleCardToMarkdown(card) {
    card = card || {};
    const sections = [
      ['定位', card.positioning],
      ['选题范围', card.topics],
      ['标题风格', card.titleStyle],
      ['开头方式', card.opening],
      ['结构习惯', card.structure],
      ['语气人设', card.tone],
      ['节奏', card.rhythm],
      ['常用表达', card.expressions],
      ['禁区', card.banned],
      ['样本线索', card.sampleClues || card.sample_clues || card.sampleSignals || card.sample_signals]
    ];
    return sections
      .map(function(pair) {
        const text = cleanText(pair[1]);
        return text ? '## ' + pair[0] + '\n' + text : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  function accountDbRowsToWorkflowStyles(rows) {
    return (rows || []).map(function(item) {
      const style = styleCardToMarkdown(item.styleCard || {});
      if (!style.trim()) return null;
      return {
        id: item.id || 'account-db:' + (item.name || Math.random().toString(36).slice(2)),
        type: 'account',
        group: '账号风格',
        name: item.name || '未命名账号',
        platform: item.platform || 'account',
        style: style,
        preview: makeStylePreview(style),
        updatedAt: String(item.updatedAt || item.updated_at || item.createdAt || '')
      };
    }).filter(Boolean);
  }

  function loadAccountDbWorkflowStyles(cb) {
    if (!fs.existsSync(accountStylesDbPath)) {
      cb([]);
      return;
    }
    try {
      const adapter = createSqliteAdapter({ dbPath: accountStylesDbPath, logger: logger });
      const db = adapter.createDb();
      db.get('SELECT payload FROM account_style_state WHERE id=?', ['library'], function(err, row) {
        let rows = [];
        if (!err && row && row.payload) {
          try { rows = JSON.parse(row.payload || '[]'); } catch(e) { rows = []; }
        }
        db.close();
        cb(accountDbRowsToWorkflowStyles(rows));
      });
    } catch (e) {
      logger.warn('load account style db failed', e);
      cb([]);
    }
  }

  function loadWorkflowStyleFiles() {
    const styles = [];
    ['bilibili', 'douyin'].forEach(function(platform) {
      const base = path.join(styleLibraryRoot, platform);
      if (!fs.existsSync(base)) return;
      fs.readdirSync(base, { withFileTypes: true }).forEach(function(entry) {
        if (!entry.isDirectory()) return;
        const accountPath = path.join(base, entry.name, 'account.json');
        const stylePath = path.join(base, entry.name, 'style.md');
        const account = readJsonFile(accountPath);
        const style = readTextFile(stylePath);
        if (!account || !style.trim()) return;
        styles.push({
          id: account.id || platform + ':' + entry.name,
          type: 'account',
          group: '账号风格',
          name: account.name || entry.name,
          platform: platform,
          style: style,
          preview: makeStylePreview(style),
          updatedAt: account.updatedAt || ''
        });
      });
    });

    const projectsBase = path.join(styleLibraryRoot, 'projects');
    if (fs.existsSync(projectsBase)) {
      fs.readdirSync(projectsBase, { withFileTypes: true }).forEach(function(entry) {
        if (!entry.isDirectory()) return;
        const projectPath = path.join(projectsBase, entry.name, 'project.json');
        const stylePath = path.join(projectsBase, entry.name, 'style.md');
        const project = readJsonFile(projectPath);
        const style = readTextFile(stylePath);
        if (!project || !style.trim()) return;
        styles.push({
          id: project.id || 'project:' + entry.name,
          type: 'project',
          group: '项目风格',
          name: project.name || entry.name,
          platform: 'project',
          style: style,
          preview: makeStylePreview(style),
          updatedAt: project.updatedAt || ''
        });
      });
    }

    return styles.sort(function(a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function loadWorkflowStyles(cb) {
    const styles = loadWorkflowStyleFiles();
    loadAccountDbWorkflowStyles(function(dbStyles) {
      dbStyles.forEach(function(style) {
        if (!styles.some(function(item) { return item.id === style.id; })) styles.push(style);
      });
      cb(styles.sort(function(a, b) {
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      }));
    });
  }

  function callVisionOcr(images, cb) {
    const siliconflowKey = deps.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
    if (!siliconflowKey) {
      cb({ error: 'PDF 是扫描版且没有文字层；当前未配置视觉 OCR 服务。' });
      return;
    }
    const content = [];
    (images || []).slice(0, 4).forEach(function(image, index) {
      content.push({ type: 'text', text: '第 ' + (index + 1) + ' 页/图，请提取页面中的所有中文和英文文字。' });
      content.push({ type: 'image_url', image_url: { url: 'data:' + (image.mime || 'image/jpeg') + ';base64,' + image.base64 } });
    });
    content.push({
      type: 'text',
      text: '请做 OCR，不要总结，不要改写。按页面顺序输出纯文本；保留标题、分点、金额、日期、品牌名、达人要求、禁区和交付物信息。'
    });
    const payload = JSON.stringify({
      model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      messages: [{ role: 'user', content: content }],
      max_tokens: 12000,
      temperature: 0.1
    });
    const req = https.request({
      hostname: 'api.siliconflow.cn',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': 'Bearer ' + siliconflowKey
      }
    }, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          cb({ error: '视觉 OCR HTTP ' + res.statusCode + ': ' + data.substring(0, 200) });
          return;
        }
        try {
          const parsed = JSON.parse(data);
          const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
          const text = cleanText(message ? (message.content || '') : '');
          cb(text ? { ok: true, text: text, ocr: true } : { error: '视觉 OCR 没有返回文字' });
        } catch (e) {
          cb({ error: '视觉 OCR 结果解析失败：' + e.message });
        }
      });
    });
    req.on('error', function(e) { cb({ error: e.message }); });
    req.setTimeout(180000, function() {
      req.destroy(new Error('视觉 OCR 请求超时'));
    });
    req.write(payload);
    req.end();
  }

  return {
    '/api/workflow/styles': function(body, cb) {
      try {
        loadWorkflowStyles(function(styles) {
          cb({ root: styleLibraryRoot, styles: styles });
        });
      } catch (e) {
        cb({ error: e.message || String(e), styles: [] });
      }
    },

    '/api/workflow/parse-document': function(body, cb) {
      const filename = body.filename || body.file_name || 'document';
      const fileData = body.file_data || body.file_base64 || '';
      if (!fileData) { cb({ error: 'missing file data' }); return; }
      logger.info('/api/workflow/parse-document', { filename: filename, size: Number(body.size) || 0 });
      const mime = String(body.mime || body.type || '').toLowerCase();
      const ext = String(filename).toLowerCase().split('.').pop() || '';
      if (mime.indexOf('image/') === 0 || /^(png|jpg|jpeg|webp|gif|bmp)$/.test(ext)) {
        const base64 = String(fileData).split(',', 2).pop();
        if (!base64) { cb({ error: 'missing image data' }); return; }
        callVisionOcr([{ mime: mime || 'image/jpeg', base64: base64 }], function(ocrResult) {
          if (ocrResult.error) {
            cb({ error: ocrResult.error });
            return;
          }
          cb({
            ok: true,
            title: String(filename).replace(/\.[^.]+$/, ''),
            text: ocrResult.text,
            ocr: true,
            image: true
          });
        });
        return;
      }
      runPython('parse_document.py', 'parse', {
        filename: filename,
        file_data: fileData
      }, 60).then(function(result) {
        if (result && result.needs_ocr && Array.isArray(result.images) && result.images.length) {
          callVisionOcr(result.images, function(ocrResult) {
            if (ocrResult.error) {
              cb({ error: ocrResult.error });
              return;
            }
            cb({
              ok: true,
              title: result.title || String(filename).replace(/\.[^.]+$/, ''),
              text: ocrResult.text,
              ocr: true
            });
          });
          return;
        }
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message || String(e) });
      });
    },

    '/api/to-feishu': function(body, cb) {
      const tool = body.tool || 'doc';
      const title = body.title || '未命名';
      const content = body.content || '';
      const docId = body.doc_id || '';
      logger.info('/api/to-feishu', { tool: tool, title: title, doc_id: docId, content_len: content.length });
      runPython('feishu_writer.py', 'write', {
        tool: tool,
        title: title,
        content: content,
        doc_id: docId
      }, 60).then(function(result) {
        logger.debug('/api/to-feishu result', result);
        cb(result);
      });
    },

    '/api/transcribe': function(body, cb) {
      const url = body.url || (body.params && body.params.url);
      const account = body.account || (body.params && body.params.account) || 'common';
      logger.info('/api/transcribe', { url: url, account: account });
      if (!url) { cb({ text: 'please provide url' }); return; }
      runPython('transcribe_clean.py', 'transcribe', { url: url, account: account }, 300).then(function(result) {
        cb({ text: result.text || 'transcribe failed' });
      });
    },

    '/api/transcribe/audio': async function(body, cb) {
      const audioPath = body._tempPath || body.path || '';
      const filename = body._originalName || body.filename || 'audio';
      if (!audioPath || !fs.existsSync(audioPath)) {
        cb({ ok: false, text: '', error: 'missing uploaded audio file' });
        return;
      }
      logger.info('/api/transcribe/audio', { filename: filename });
      try {
        const result = await transcribeAudioFileWithPreferredAsr(audioPath, {
          maxSeconds: Number(body.max_seconds || body.maxSeconds) || 1800
        });
        if (!result.text) {
          cb({
            ok: false,
            text: '',
            error: result.error || '转写失败',
            source: result.provider || ''
          });
          return;
        }
        cb({
          ok: true,
          text: result.text,
          source: result.provider || 'volcengine',
          warning: result.warning || ''
        });
      } catch(e) {
        cb({ ok: false, text: '', error: e.message || String(e) });
      } finally {
        try { fs.unlinkSync(audioPath); } catch(e) {}
      }
    },

    '/api/transcribe/douyin': function(body, cb) {
      const url = body.url || '';
      if (!url) { cb({ text: 'url required' }); return; }
      runPython('transcribe_douyin.py', 'transcribe', { url: url }, 300).then(function(result) {
        logger.debug('/api/transcribe/douyin result', result);
        if (result.error) {
          cb({
            text: '',
            error: result.error,
            title: result.title || '',
            author: result.author || '',
            platform: result.platform || 'douyin'
          });
          return;
        }
        cb({
          text: result.text || '',
          title: result.title || '',
          author: result.author || '',
          platform: result.platform || 'douyin'
        });
      }).catch(function(e) {
        logger.error('/api/transcribe/douyin failed', e);
        cb({ text: '', error: e.message || String(e), platform: 'douyin' });
      });
    },

    '/api/transcribe/bilibili': function(body, cb) {
      const url = body.url || '';
      if (!url) { cb({ text: 'url required' }); return; }
      runPython('transcribe_bilibili.py', 'transcribe', { url: url }, 900).then(async function(result) {
        let finalResult = result || {};
        if (finalResult.error && !finalResult.text) {
          logger.info('/api/transcribe/bilibili python fallback failed; trying video download', {
            bvid: finalResult.bvid || extractBvid(url),
            source: finalResult.source || '',
            error: String(finalResult.error || '').slice(0, 240)
          });
          try {
            const downloaded = await transcribeDownloadedBilibiliVideo(url, finalResult.bvid || extractBvid(url), finalResult.error);
            if (downloaded.text) {
              finalResult = Object.assign({}, finalResult, {
                text: downloaded.text,
                error: '',
                source: downloaded.source || 'bilibili-download'
              });
            } else {
              finalResult = Object.assign({}, finalResult, {
                error: downloaded.error || finalResult.error,
                source: downloaded.source || finalResult.source || 'bilibili-download'
              });
            }
          } catch (fallbackError) {
            logger.warn('/api/transcribe/bilibili video download fallback failed', fallbackError);
            finalResult = Object.assign({}, finalResult, {
              error: (finalResult.error ? finalResult.error + '；' : '') + (fallbackError.message || String(fallbackError))
            });
          }
        }
        if (finalResult.error && !finalResult.text) {
          cb({
            text: finalResult.text || '',
            error: finalResult.error,
            title: finalResult.title || '',
            author: finalResult.author || '',
            bvid: finalResult.bvid || extractBvid(url) || '',
            source: finalResult.source || ''
          });
          return;
        }
        cb({
          text: finalResult.text || '',
          title: finalResult.title || '',
          author: finalResult.author || '',
          bvid: finalResult.bvid || extractBvid(url) || '',
          source: finalResult.source || ''
        });
      }).catch(function(e) {
        logger.error('/api/transcribe/bilibili failed', e);
        cb({ text: '', error: e.message || String(e) });
      });
    },

    '/api/douyin/downloader': function(body, cb) {
      const action = body.action || 'download';
      const timeout = action === 'download' ? 1800 : 300;

      // 支持多URL批量处理
      const urls = body.urls;
      if (urls && Array.isArray(urls) && urls.length > 1) {
        // 多URL并行处理
        const results = [];
        let completed = 0;
        const total = urls.length;

        logger.info('/api/douyin/downloader batch', { count: total });

        urls.forEach((url, index) => {
          const payload = { ...publicPayload(body), url: url, _batch_index: index };
          runPython('douyin_downloader_bridge.py', action, payload, timeout).then(function(result) {
            results[index] = { url: url, ...result };
            completed++;
            if (completed === total) {
              // 所有任务完成，聚合结果
              const allTexts = results.map(r => r.transcript_text || '').filter(t => t);
              const allFiles = results.flatMap(r => r.files || []);
              const allItems = results.flatMap(r => r.items || []);
              cb({
                success: results.some(r => r.success !== false),
                message: `批量完成 ${completed}/${total}`,
                results: results,
                transcript_text: allTexts.join('\n\n---\n\n'),
                files: allFiles,
                items: allItems
              });
            }
          }).catch(function(e) {
            results[index] = { url: url, error: e.message };
            completed++;
            if (completed === total) {
              cb({
                success: false,
                message: `批量完成 ${completed}/${total} (部分失败)`,
                results: results
              });
            }
          });
        });
        return;
      }

      // 单URL处理（原有逻辑）
      runPython('douyin_downloader_bridge.py', action, publicPayload(body), timeout).then(function(result) {
        if (result && result.author) {
          cb(result);
          return;
        }
        const sourceForAuthor = [
          body.url,
          result && result.url,
          result && result.log,
          result && result.stderr,
          result && Array.isArray(result.files) ? JSON.stringify(result.files) : '',
          result && result.transcript_file ? JSON.stringify(result.transcript_file) : '',
          result && Array.isArray(result.items) ? JSON.stringify(result.items) : ''
        ].filter(Boolean).join('\n');
        getDouyinAuthorByOpenCli(sourceForAuthor).then(function(authorResult) {
          if (authorResult.author) {
            cb(Object.assign({}, result, { author: authorResult.author, author_source: authorResult.source || 'opencli:browser:douyin-page' }));
          } else {
            cb(Object.assign({}, result, { author_error: authorResult.error || '' }));
          }
        }).catch(function(e) {
          cb(Object.assign({}, result, { author_error: e.message || String(e) }));
        });
      });
    },

    '/api/douyin/play-count-status': function(body, cb) {
      const key = normalizeDouyinPlayCountKey(body && (body.input || body.url || body.video_url));
      cb(Object.assign({ ok: true }, playCountCooldownPayload(key)));
    },

    '/api/douyin/play-count': function(body, cb) {
      const input = String(body && (body.input || body.url || body.video_url) || '').trim();
      const key = normalizeDouyinPlayCountKey(input);
      if (!input) {
        cb({ ok: false, error: '请先粘贴抖音视频链接或分享口令' });
        return;
      }
      if (!key) {
        cb({ ok: false, error: '没有识别到有效的抖音视频链接' });
        return;
      }
      if (douyinPlayCountState.running) {
        cb(Object.assign({ ok: false, reason: 'running', message: '上一条播放量查询还在进行中，请稍等' }, playCountCooldownPayload(key)));
        return;
      }
      const cooldownUntil = Number(douyinPlayCountState.cooldowns.get(key) || 0);
      if (cooldownUntil > Date.now()) {
        cb(Object.assign({
          ok: false,
          reason: 'cooldown',
          message: '同一条视频处于查询冷却中'
        }, playCountCooldownPayload(key)));
        return;
      }

      douyinPlayCountState.running = true;
      let responded = false;
      const totalTimeout = setTimeout(function() {
        if (responded) return;
        responded = true;
        douyinPlayCountState.running = false;
        cb(Object.assign({
          ok: false,
          reason: 'timeout',
          message: '播放量查询超时，已释放查询锁，请稍后重试'
        }, playCountCooldownPayload(key)));
      }, Number(process.env.DOUYIN_PLAY_COUNT_TOTAL_TIMEOUT_MS || 65000));

      function finish(payload) {
        if (responded) return;
        responded = true;
        clearTimeout(totalTimeout);
        cb(payload);
      }

      queryDouyinPlayCountWithChabofang(input).then(function(payload) {
        douyinPlayCountState.running = false;
        if (responded) return;
        if (payload && payload.result) {
          const next = Date.now() + douyinPlayCountCooldownMs();
          douyinPlayCountState.cooldowns.set(key, next);
          douyinPlayCountState.lastResult = Object.assign({}, payload.result, {
            input: input,
            key: key,
            queriedAt: new Date().toISOString(),
            nextAvailableAt: new Date(next).toISOString()
          });
          finish(Object.assign({ ok: true, result: douyinPlayCountState.lastResult }, playCountCooldownPayload(key)));
          return;
        }
        const reason = payload && payload.reason || 'failed';
        finish(Object.assign({
          ok: false,
          reason: reason,
          message: payload && payload.message || '播放量查询失败'
        }, playCountCooldownPayload(key)));
      }).catch(function(e) {
        douyinPlayCountState.running = false;
        if (responded) return;
        logger.error('/api/douyin/play-count failed', e);
        finish(Object.assign({
          ok: false,
          error: e.message || String(e),
          message: e.message || String(e)
        }, playCountCooldownPayload(key)));
      }).finally(function() {
        douyinPlayCountState.running = false;
      });
    },

    '/api/posttools/video-download': function(body, cb) {
      const platform = String(body.platform || '').toLowerCase();
      const url = String(body.url || '').trim();
      const quality = String(body.quality || body.downloadQuality || '1080').toLowerCase();
      if (!url) { cb({ ok: false, error: 'url required' }); return; }
      if (platform !== 'douyin' && platform !== 'bilibili') {
        cb({ ok: false, error: 'unsupported platform' });
        return;
      }

      logger.info('/api/posttools/video-download', { platform: platform, url: url });

      if (platform === 'douyin') {
        runPython('douyin_downloader_bridge.py', 'download', {
          url: url,
          autoTranscript: false,
          downloadAssets: true,
          downloadType: 'mp4',
          quality: quality === '720' || quality === '720p' ? '720' : '1080'
        }, 1800).then(function(result) {
          const files = Array.isArray(result.files) ? result.files : [];
          cb(Object.assign({}, result, {
            ok: result.success !== false && files.length > 0,
            platform: 'douyin',
            files: files,
            error: result.success === false || !files.length ? (result.error || result.stderr || result.log || result.message || '抖音视频下载失败') : ''
          }));
        }).catch(function(e) {
          logger.error('/api/posttools/video-download douyin failed', e);
          cb({ ok: false, platform: 'douyin', error: e.message || String(e), files: [] });
        });
        return;
      }

      const bvid = extractBvid(url);
      if (!bvid) {
        cb({ ok: false, platform: 'bilibili', error: '未识别到 B站 BV 号', files: [] });
        return;
      }
      const outputDir = path.join(root, 'public', 'uploads', 'posttools', 'bilibili');
      downloadAdapters.downloadBilibili({
        root: root,
        bvid: bvid,
        url: url,
        outputDir: outputDir,
        quality: quality === '720' || quality === '720p' ? '720P \u9ad8\u6e05' : '1080P \u9ad8\u7801\u7387, 1080P \u9ad8\u6e05, 720P \u9ad8\u6e05',
        timeout: 15 * 60 * 1000
      }).then(function(result) {
        const files = (result.files || [])
          .filter(function(file) { return fs.existsSync(file); })
          .map(fileEntryFromAbsolute);
        cb({
          ok: result.ok && files.length > 0,
          platform: 'bilibili',
          tool: result.tool || '',
          files: files,
          attempts: result.attempts || [],
          error: result.ok && files.length ? '' : (result.error || 'B站视频下载失败')
        });
      }).catch(function(e) {
        logger.error('/api/posttools/video-download bilibili failed', e);
        cb({ ok: false, platform: 'bilibili', error: e.message || String(e), files: [] });
      });
    },

    '/api/posttools/video-download': function(body, cb) {
      downloadPosttoolsVideo(body || {}).then(cb).catch(function(e) {
        cb({ ok: false, error: e.message || String(e), files: [] });
      });
    },

    '/api/posttools/video-download-batch-start': function(body, cb) {
      const job = createPosttoolsDownloadJob(body || {});
      if (!job) {
        cb({ ok: false, error: '请先粘贴抖音或 B 站视频链接', job: null });
        return;
      }
      cb({ ok: true, job: snapshotPosttoolsDownloadJob(job) });
    },

    '/api/posttools/video-download-batch-status': function(body, cb) {
      const id = String(body && body.id || '').trim();
      const job = id ? posttoolsDownloadJobs.get(id) : null;
      if (!job) {
        cb({ ok: false, error: '未找到批量下载任务', job: null });
        return;
      }
      cb({ ok: true, job: snapshotPosttoolsDownloadJob(job) });
    },

    '/api/posttools/video-download-batch-latest': function(body, cb) {
      const files = listPosttoolsDownloadZips(body && body.limit);
      cb({ ok: true, files: files, latest: files[0] || null });
    },

    '/api/posttools/video-download-batch-jobs': function(body, cb) {
      const limit = Math.max(1, Number(body && body.limit) || 10);
      const jobs = Array.from(posttoolsDownloadJobs.values())
        .sort(function(a, b) { return Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''); })
        .slice(0, limit)
        .map(snapshotPosttoolsDownloadJob);
      cb({ ok: true, jobs: jobs });
    },

    '/api/posttools/media-convert': function(body, cb) {
      const action = String(body.action || '').trim();
      const source = String(body.source || '').trim();
      const sourcePath = resolveUploadPath(source);
      if (!sourcePath || !fs.existsSync(sourcePath)) {
        cb({ ok: false, error: '请先上传本地文件，或使用视频下载动作处理链接', files: [] });
        return;
      }

      const outDir = path.join(root, 'public', 'uploads', 'posttools', 'converted');
      try { fs.mkdirSync(outDir, { recursive: true }); } catch(e) {}
      const base = safeMediaName(path.basename(sourcePath, path.extname(sourcePath)));
      const stamp = Date.now();
      let outPath = '';
      let args = [];

      if (action === 'extract-mp3') {
        outPath = path.join(outDir, stamp + '_' + base + '.mp3');
        args = ['-y', '-i', sourcePath, '-vn', '-ac', '2', '-ar', '44100', '-b:a', '192k', outPath];
      } else if (action === 'convert-mp4') {
        outPath = path.join(outDir, stamp + '_' + base + '.mp4');
        args = ['-y', '-i', sourcePath, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-movflags', '+faststart', outPath];
      } else if (action === 'compress-720p') {
        outPath = path.join(outDir, stamp + '_' + base + '_720p.mp4');
        args = ['-y', '-i', sourcePath, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outPath];
      } else if (action === 'cover-jpg') {
        outPath = path.join(outDir, stamp + '_' + base + '_cover.jpg');
        args = ['-y', '-ss', '00:00:01', '-i', sourcePath, '-frames:v', '1', '-q:v', '2', outPath];
      } else {
        cb({ ok: false, error: 'unsupported action', files: [] });
        return;
      }

      logger.info('/api/posttools/media-convert', { action: action, source: source });
      runFfmpeg(args, 15 * 60 * 1000).then(function(result) {
        if (!result.ok || !fs.existsSync(outPath)) {
          cb({ ok: false, error: cleanText(result.stderr || result.stdout || 'ffmpeg failed').slice(-1200), files: [] });
          return;
        }
        cb({ ok: true, action: action, files: [fileEntryFromAbsolute(outPath)] });
      }).catch(function(e) {
        cb({ ok: false, error: e.message || String(e), files: [] });
      });
    },

    '/api/hot/search': function(body, cb) {
      const query = String(body.query || body.keyword || '').trim();
      const sourceText = String(body.source_text || body.sourceText || '').trim();
      if (!query) { cb({ error: 'keyword required' }); return; }
      const queries = hotSearchQueries(query, sourceText);
      runNativeHotResearch(queries.join(' / '), sourceText).then(function(payload) {
        cb(payload);
      }).catch(function(researchError) {
        Promise.all(queries.map(runHotSearchWorker)).then(function(payloads) {
        const payload = mergeHotPayloads(payloads, queries, sourceText);
        const results = normalizeHotResults(payload);
        summarizeHotResults(queries.join(' / '), sourceText, results, function(analysis) {
          cb({
            results: results,
            query: query,
            queries: queries,
            analysis: analysis,
            source: payload.source || '',
            errors: [summarizeWebResearchFailure(researchError)].filter(Boolean).concat(payload.errors || []),
            mode: 'legacy_search'
          });
        });
        }).catch(function(e) {
          cb({ results: [], query: query, queries: queries, error: e.message, errors: [summarizeWebResearchFailure(researchError)].filter(Boolean), mode: 'legacy_search' });
        });
      });
    },

    '/api/search-intent': function(body, cb) {
      const sourceText = String(body.text || body.source_text || body.sourceText || body.query || '').trim();
      const mode = String(body.mode || 'default');
      if (!sourceText) { cb({ error: 'text required' }); return; }
      const intent = searchIntent.extractSearchIntent(sourceText, {
        queryLimit: mode === 'platform' ? 5 : 4,
        entityLimit: 6
      });
      cb(Object.assign({ ok: true, mode }, intent));
    },

    '/api/platform/search': async function(body, cb) {
      const sourceText = String(body.source_text || body.sourceText || '');
      const intent = searchIntent.extractSearchIntent(sourceText, { queryLimit: 5, entityLimit: 6 });
      const query = String(body.query || body.keyword || '').trim() || intent.query || extractPlatformKeywords(sourceText);
      const platforms = ['bilibili'];
      const limit = Math.max(1, Math.min(Number(body.limit || 5), 20));
      const transcribeLimit = Math.max(1, Math.min(Number(body.transcribe_limit || body.transcribeLimit || 3), 3));
      if (!query) { cb({ enabled: true, error: 'missing query', query: '', candidates: [], selected: [], results: [] }); return; }
      try {
        const searched = await searchBilibiliCandidates(query, limit);
        const candidates = (searched.items || [])
          .map(function(item, index) { return mapPlatformCandidate(item, index, intent, query); })
          .sort(function(a, b) { return (b.relevance - a.relevance) || (Number(b.score || 0) - Number(a.score || 0)); })
          .slice(0, limit)
          .map(function(item, index) {
            return Object.assign({}, item, {
              selected: index < transcribeLimit,
              reason: index < transcribeLimit ? item.reason : '候选补充，未默认入选'
            });
          });
        const selected = candidates.filter(function(item) { return item.selected; }).slice(0, transcribeLimit);
        cb({
          enabled: true,
          query: query,
          intent: intent,
          source: searched.source,
          warning: searched.ok ? '' : (searched.error || 'B站搜索没有返回候选'),
          platforms: platforms,
          limit: limit,
          transcribe_limit: transcribeLimit,
          candidates: candidates,
          results: candidates,
          selected: selected,
          plan: {
            status: searched.ok ? 'searched' : 'empty',
            selection_rule: '按主体命中、意图词命中和播放指标排序，默认选 Top ' + transcribeLimit,
            steps: [
              '提取主体和搜索意图',
              '搜索 B站候选视频',
              '按标题/作者/描述相关性排序',
              '默认选择 Top ' + transcribeLimit + ' 个候选，后续再接真实转写'
            ]
          },
          message: searched.ok ? 'B站候选搜索完成' : 'B站搜索暂未找到可用候选'
        });
      } catch (e) {
        cb({
          enabled: true,
          query: query,
          platforms: platforms,
          limit: limit,
          transcribe_limit: transcribeLimit,
          candidates: [],
          results: [],
          selected: [],
          error: e.message || String(e),
          warning: 'B站搜索失败'
        });
      }
    },

    '/api/chat-minimax': function(body, cb) {
      const messages = [{ role: 'system', content: body.system || '你是乌萨奇，陈的AI助手。实用、直接、有个性。' }];
      (body.history || []).forEach(function(item) {
        messages.push({ role: item.role === 'user' ? 'user' : 'assistant', content: item.content || '' });
      });
      messages.push({ role: 'user', content: body.prompt || body.message || '' });
      if (callOpenAICompatible) {
        callOpenAICompatible(messages, {
          model: body.model || 'gpt-5.5',
          temperature: body.temperature === undefined ? 0.7 : body.temperature,
          maxTokens: body.max_tokens || body.maxTokens || 2000,
          timeoutMs: body.timeoutMs || body.timeout_ms || 180000
        }).then(function(reply) {
          cb({ reply: reply || 'no reply', model: body.model || 'gpt-5.5' });
        }).catch(function(err) {
          cb({ reply: 'error: ' + err.message });
        });
        return;
      }
      callMiniMaxMessages(messages, 0.7, body.max_tokens || body.maxTokens || 2000, function(err, reply) {
        if (err) { cb({ reply: 'error: ' + err.message }); return; }
        cb({ reply: reply || 'no reply' });
      }, { timeoutMs: body.timeoutMs || body.timeout_ms || 180000 });
    },

    '/api/ai-fix': function(body, cb) {
      logger.info('/api/ai-fix', { text_len: (body.text || '').length });
      const text = body.text || '';
      if (!text) { cb({ error: 'text required' }); return; }
      const messages = [
        { role: 'system', content: '【强制规则】1. 删除所有emoji表情符号，用文字替代或直接删除；2. 修正错别字、漏字、错听词；3. 修正语序混乱、搭配不当、成分残缺等病句；4. 按自然语义补齐标点、断句和分段，让正文更适合直接发布；5. 严禁改变原意，严禁扩写观点，严禁添加解释、备注、标题、思考过程。输出格式：仅输出纠错排版后的正文。' },
        { role: 'user', content: '请严格按规则纠错并排版，只输出正文：\n\n' + text }
      ];
      callMiniMaxMessages(messages, 0.1, 2000, function(err, rawReply) {
        if (err) { cb({ reply: 'error: ' + err.message }); return; }
        const clean = String(rawReply || '')
          .replace(/<think>[\s\S]*?<\/think>/gi, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        cb({ reply: clean || rawReply || 'no reply' });
      });
    },

    '/api/ai_extract': function(body, cb) {
      runPython('transcribe_clean.py', 'extract', {
        text: body.text || '',
        account: body.account || '通用',
        scene: body.scene || '开场'
      }, 90).then(cb);
    },

    '/api/feishu/read': function(body, cb) {
      const docId = body.doc_id || body.docId || '';
      const url = body.url || body.link || body.feishu_url || body.feishuUrl || '';
      if (!docId && !url) { cb({ error: 'doc_id or url required' }); return; }
      runPython('feishu_reader.py', 'read', { doc_id: docId, url: url }, 90).then(cb);
    },

    '/api/comment/batch': function(body, cb) {
      const account = body.account || '';
      const videoUrl = body.videoUrl || '';
      const content = body.content || '';
      const styles = body.styles || ['风趣'];
      const count = body.count || 30;
      if (!account || !content) {
        cb({ success: false, error: 'account and content are required' });
        return;
      }

      const styleText = styles.join('、');
      const prompt = `你是一个短视频评论区运营专家。请为以下内容生成${count}条评论，风格要求：${styleText}。

账号：${account}
视频原文：${content}
${videoUrl ? '视频链接：' + videoUrl : ''}

要求：
1. 评论要符合账号人设
2. ${styleText}风格
3. 内容多样化，不要重复
4. 每条评论控制在20字以内
5. 直接输出${count}条评论，用换行分隔，不要编号，不要其他说明

格式：
评论1
评论2
...`;

      handleChatRequest(prompt, [], function(err, result) {
        if (err) { cb({ success: false, error: err.message }); return; }
        const comments = (result.reply || '').split('\n').filter(function(line) {
          return line.trim().length > 0;
        }).slice(0, count);

        let docContent = '账号名: ' + account + '\n';
        if (videoUrl) docContent += '链接: ' + videoUrl + '\n';
        docContent += '\n评论:\n';
        comments.forEach(function(comment, index) {
          docContent += (index + 1) + '. ' + comment.trim() + '\n';
        });

        runPython('feishu_writer.py', 'write', {
          title: account + ' 评论生成 ' + new Date().toLocaleDateString('zh-CN'),
          content: docContent
        }, 60).then(function(result) {
          cb({ success: true, count: comments.length, comments: comments, docUrl: result.doc_url || '' });
        }).catch(function() {
          cb({ success: true, count: comments.length, comments: comments, docUrl: '' });
        });
      });
    },

    '/api/comment/generate': function(body, cb) {
      const raw = (body.script || '')
        .replace(/复制此链接[，,]?\s*打开(?:抖音|Dou音|抖音搜索|Douyin)[^\n。；;]*/gi, '')
        .replace(/https?:\/\/[^\s\u4e00-\u9fff]*/gi, '')
        .replace(/\b[A-Za-z0-9]{1,20}@[A-Za-z0-9]{1,20}\b/g, '')
        .replace(/^\d+\.\d+\s*[^\s]{1,8}:\/\s*\S+\s+\d{2}\/\d{2}\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      let count = parseInt(body.count, 10) || 30;
      const rawScenario = body.scenario || '';
      const account = body.account || '';
      const mode = String(body.mode || body.type || '').trim();
      const hasExplicitMode = Boolean(mode);
      const isDanmaku = hasExplicitMode
        ? /弹幕|danmaku|barrage/i.test(mode)
        : /弹幕|danmaku|barrage/i.test(rawScenario);
      const scenario = !isDanmaku && /弹幕|danmaku|barrage/i.test(rawScenario) ? '' : rawScenario;
      const script = compactCommentSource(raw, isDanmaku ? 5200 : 6800);
      if (!script) { cb({ error: '请提供视频文案' }); return; }

      count = Math.min(Math.max(count, 10), 300);
      const itemLabel = isDanmaku ? '弹幕' : '评论';
      const scenarioDesc = isDanmaku
        ? (scenario ? '重点使用“' + scenario + '”风格，' : '按 B 站弹幕语境生成，')
        : (scenario ? '重点使用“' + scenario + '”风格，' : '五大风格（逻辑鬼才、本地业内人、抽象乐子人、阴阳怪气高手、暴躁狂热老铁）混合使用，');
      const accountLine = account ? '\n账号倾向：' + account + '（可用该账号的人设语气）' : '';
      const targetCount = count;
      (async function() {
        const comments = [];
        const seen = new Set();
        const debugPreviews = [];
        const batchAngles = isDanmaku
          ? ['震惊反应', '现场吐槽', '抽象玩梗', '节奏跟拍', '夸张惊呼']
          : ['更毒舌', '更共鸣', '更抽象', '更拆解', '更戏谑'];
        const batchProfiles = isDanmaku
          ? [
              { label: '短弹幕', rule: '以 4-12 字短句为主，像屏幕上一闪而过的真实弹幕。', tokenPerItem: 28 },
              { label: '玩梗弹幕', rule: '混入网络梗、抽象反应、无厘头吐槽，但不要低俗攻击。', tokenPerItem: 30 },
              { label: '反应弹幕', rule: '写即时反应、惊讶、笑点、疑问，尽量短。', tokenPerItem: 28 },
              { label: '正常弹幕', rule: '写自然口语弹幕，长度 8-20 字，别像文案。', tokenPerItem: 34 }
            ]
          : [
              { label: '短梗', rule: '至少一半写成 5-16 字短评，像路人顺手发的短梗。', tokenPerItem: 30 },
              { label: '正常短评', rule: '以 12-35 字短评为主，口语、具体、不要长篇分析。', tokenPerItem: 42 },
              { label: '细节吐槽', rule: '抓视频里的具体点吐槽，长度 20-55 字，别写成小作文。', tokenPerItem: 58 },
              { label: '无厘头玩梗', rule: '混入几条抽象、玩梗、反差感评论，可以很短，但不要尬解释。', tokenPerItem: 34 },
              { label: '认真共鸣', rule: '少量认真共鸣型评论，控制在 25-60 字，不要全都很长。', tokenPerItem: 62 }
            ];
        const parallelLimit = Math.min(4, Math.max(1, Number(process.env.COMMENT_GENERATE_CONCURRENCY || 3)));
        const maxWaves = 4;
        let lastError = '';

        function plannedBatchCount(remaining) {
          const targetBatchSize = isDanmaku ? 18 : 24;
          const maxBatchCount = isDanmaku ? 14 : 10;
          return Math.max(1, Math.min(maxBatchCount, Math.ceil(remaining / targetBatchSize)));
        }

        async function runWave(waveIndex) {
          const remaining = targetCount - comments.length;
          const batchCount = plannedBatchCount(remaining);
          const baseSize = Math.ceil(remaining / batchCount);
          const batchMaxSize = isDanmaku ? 22 : 30;
          const extraPerBatch = batchCount === 1 ? 0 : (remaining >= 100 ? 8 : 3);
          const promptIntro = isDanmaku
            ? '你只负责生成中文短视频弹幕。'
            : '你只负责生成中文短视频评论。';
          const styleRule = isDanmaku
            ? '每条弹幕要短、口语、有画面感。'
            : '每条评论要像真实网友评论，口语、具体、有梗，不要官方腔。';
          const specs = [];
          for (let index = 0; index < batchCount; index += 1) {
            specs.push({
              requestCount: Math.min(batchMaxSize, Math.ceil((baseSize + extraPerBatch) * 1.15)),
              angle: batchAngles[(waveIndex + index) % batchAngles.length],
              profile: batchProfiles[(waveIndex + index) % batchProfiles.length],
              slot: index + 1
            });
          }

          async function runSpec(spec) {
            let userPrompt = [
              '根据下面内容生成 ' + spec.requestCount + ' 条' + itemLabel + '：',
              script.slice(0, 900),
              accountLine || '',
              scenarioDesc + '本批风格重点：' + spec.angle + '。',
              '本批评论形态：' + spec.profile.label + '。' + spec.profile.rule,
              isDanmaku ? '长度配比：短弹幕优先，允许少量 2-5 字反应。' : '长度配比：约 45% 短评/短梗，40% 正常短评，15% 稍长细节评论；不要全写成长段。',
              styleRule,
              '硬性要求：只输出' + itemLabel + '本身；每行一条；不要编号；不要标题；不要解释；不要重复；不要写“第几个角度”；不要写“继续讨论的空间”。'
            ].filter(Boolean).join('\n');

            if (comments.length) {
              userPrompt += '\n\n已生成内容（不要重复）：\n' + comments.slice(-30).join('\n');
            }

            return callTextModelWithRetry(promptIntro, userPrompt, {
              model: process.env.COMMENT_MODEL || process.env.FHL_DEFAULT_MODEL || 'gpt-5.5',
              apiKey: process.env.COMMENT_API_KEY,
              baseUrl: process.env.COMMENT_BASE_URL,
              maxTokens: Math.min(2500, Math.max(700, spec.requestCount * spec.profile.tokenPerItem)),
              temperature: spec.profile.label.includes('梗') || spec.profile.label.includes('无厘头') ? 0.9 : (isDanmaku ? 0.84 : 0.78),
              timeoutMs: 35000,
              attempts: 1
            });
          }

          const results = new Array(specs.length);
          let cursor = 0;
          async function worker(workerIndex) {
            while (cursor < specs.length) {
              const index = cursor;
              cursor += 1;
              if (index > 0) await delay(180 + workerIndex * 140);
              try {
                results[index] = { status: 'fulfilled', value: await runSpec(specs[index]) };
              } catch (error) {
                results[index] = { status: 'rejected', reason: error };
              }
            }
          }
          await Promise.all(Array.from({ length: Math.min(parallelLimit, specs.length) }, function(_, index) {
            return worker(index);
          }));

          let added = 0;
          results.forEach(function(result, index) {
            if (result.status !== 'fulfilled') {
              lastError = String(result.reason && result.reason.message || result.reason || '').slice(0, 180);
              return;
            }
            const parsedLines = parseGeneratedCommentLines(result.value, specs[index].requestCount * 2);
            if (!parsedLines.length) {
              debugPreviews.push({
                batch: index + 1,
                type: typeof result.value,
                preview: String(result.value || '').slice(0, 500)
              });
              logger.warn('comment model reply parsed zero', {
                batch: index + 1,
                requested: specs[index].requestCount,
                replyPreview: String(result.value || '').slice(0, 500)
              });
            }
            parsedLines.forEach(function(line) {
              const key = line.replace(/\s+/g, '');
              if (!seen.has(key)) {
                seen.add(key);
                comments.push(line);
                added += 1;
              }
            });
          });

          if (!added && !lastError) {
            lastError = '模型返回内容无法解析';
          }
          return added;
        }

        for (let wave = 0; comments.length < targetCount && wave < maxWaves; wave += 1) {
          const added = await runWave(wave);
          if (!added && comments.length < targetCount) {
            lastError = lastError || '模型返回内容无法解析';
            break;
          }
        }

        if (comments.length < targetCount) {
          buildLocalCommentFallback(script, targetCount - comments.length, isDanmaku, seen).forEach(function(line) {
            comments.push(line);
          });
        }

        cb({
          comments: comments.slice(0, targetCount),
          fallback: Boolean(lastError),
          warning: lastError ? ('部分批次失败，已用本地短评模板补齐；' + lastError) : ''
        });
      })().catch(function(e) {
        cb({
          error: String(e && e.message || e).slice(0, 220),
          comments: [],
          fallback: false,
          debugPreviews: body.debug ? (e && e.debugPreviews || []) : undefined,
          debugConfig: body.debug ? {
            model: process.env.COMMENT_MODEL || process.env.FHL_DEFAULT_MODEL || 'gpt-5.5',
            baseUrl: process.env.COMMENT_BASE_URL || process.env.FHL_BASE_URL || '',
            hasCommentKey: Boolean(process.env.COMMENT_API_KEY)
          } : undefined
        });
      });
    },
    '/api/audit': function(body, cb) {
      const urlA = body.urlA || '';
      const urlB = body.urlB || '';
      const auditType = body.type || 'all';
      if (!urlA || !urlB) { cb({ error: 'urlA and urlB are required' }); return; }

      const typeDesc = auditType === 'content' ? '内容问题' : (auditType === 'missing' ? '漏提审' : '全部');
      const prompt = `你是一个专业的视频内容审计专家。请对比分析以下两个飞书表格链接中的内容：

表格A（标准）：${urlA}
表格B（待审计）：${urlB}
审计类型：${typeDesc}

请执行以下分析：
1. 找出表格B中与表格A不一致的内容问题
2. 找出表格B中漏提审的视频
3. 给出详细的审计报告

请用JSON格式输出：
{
  "problems": ["问题1描述", "问题2描述", ...],
  "missing": ["漏提审视频1", "漏提审视频2", ...],
  "summary": "总体分析"
}`;

      handleChatRequest(prompt, [], function(err, result) {
        if (err) { cb({ error: err.message }); return; }
        const reply = result.reply || '';
        try {
          const match = reply.match(/\{[\s\S]*\}/);
          cb({ report: match ? JSON.parse(match[0]) : { problems: [reply], missing: [], summary: '分析完成' } });
        } catch(e) {
          cb({ report: { problems: [reply], missing: [], summary: '分析完成' } });
        }
      });
    },

    '/api/status': function(body, cb) {
      cb({ status: 'connected' });
    },

    '/api/system/health': function(body, cb) {
      try {
        buildSystemHealth(cb);
      } catch (e) {
        cb({
          ok: true,
          checkedAt: Date.now(),
          api: { ok: true, port: Number(process.env.PORT) || 5555 },
          styleWorkbench: { ok: false, native: true, error: e.message },
          opencli: { ok: false, error: e.message },
          siliconflow: { ok: Boolean(process.env.SILICONFLOW_API_KEY || deps.siliconflowApiKey), configured: Boolean(process.env.SILICONFLOW_API_KEY || deps.siliconflowApiKey) },
          chat: { ok: Boolean(process.env.FHL_API_KEY || process.env.OPENAI_API_KEY || deps.minimaxApiKey), configured: Boolean(process.env.FHL_API_KEY || process.env.OPENAI_API_KEY || deps.minimaxApiKey), model: process.env.FHL_DEFAULT_MODEL || 'gpt-5.5', proxyConfigured: Boolean(process.env.FHL_PROXY_URL || process.env.MODEL_PROXY_URL) },
          feishu: { ok: false, configured: false, error: e.message }
        });
      }
    },

    '/api/upload': function(body, cb) {
      cb({ path: '' });
    },

    '/api/posttools/ncm-convert': function(body, cb) {
      const tempPath = body._tempPath;
      const originalName = body._originalName;

      if (!tempPath) {
        cb({ ok: false, error: 'no file uploaded' });
        return;
      }
      logger.info('/api/posttools/ncm-convert', { tempPath: tempPath, originalName: originalName });

      const { spawn } = require('child_process');
      const fs = require('fs');
      const bundledNcmExe = path.join(serverDir, 'bin', 'ncm-converter.exe');
      const legacyNcmExe = 'D:\\jiji\\Ncm转mp3拖一拖.exe';
      const NCM_EXE = fs.existsSync(bundledNcmExe) ? bundledNcmExe : legacyNcmExe;
      if (!fs.existsSync(NCM_EXE)) {
        cb({ ok: false, error: 'NCM 转换器不存在，请检查 server/bin/ncm-converter.exe' });
        return;
      }

      // 先清理同名旧mp3（如果存在）
      const mp3Path = tempPath.replace(/\.ncm$/i, '.mp3')
      try { if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path); } catch(e) {}

      // 调用exe转换（分离模式：GUI exe不会自己退出，靠文件轮询检测完成）
      const py = spawn(NCM_EXE, [tempPath], {
        detached: true,
        stdio: 'ignore',
        shell: false
      });
      py.unref(); // 允许父进程独立退出，不阻塞

      let done = false;

      const timer = setTimeout(function() {
        if (done) return;
        done = true;
        try { py.kill(); } catch(e) {}
        try { fs.unlinkSync(tempPath); } catch(e) {}
        logger.error('/api/posttools/ncm-convert timeout');
        cb({ ok: false, error: '转换超时（60秒）' });
      }, 60000);

      // 轮询检查mp3文件是否生成（exe写入后即返回，不等进程退出）
      const poll = setInterval(function() {
        if (done) { clearInterval(poll); return; }
        if (fs.existsSync(mp3Path)) {
          done = true;
          clearInterval(poll);
          clearTimeout(timer);
          // 复制到可访问目录
          const rootDir = path.resolve(serverDir, '..');
          const uploadDir = path.join(rootDir, 'public', 'uploads', 'audio');
          try { fs.mkdirSync(uploadDir, { recursive: true }); } catch(e) {}
          const audioFileName = Date.now() + '_' + (originalName || 'audio').replace(/\.ncm$/i, '.mp3');
          const audioPath = path.join(uploadDir, audioFileName);
          try {
            fs.copyFileSync(mp3Path, audioPath);
            fs.unlinkSync(mp3Path);
          } catch(e) { logger.warn('failed to copy mp3', e); }
          try { fs.unlinkSync(tempPath); } catch(e) {}
          const downloadUrl = '/uploads/audio/' + audioFileName;
          logger.debug('/api/posttools/ncm-convert done', { audioPath: downloadUrl });
          cb({ ok: true, mp3_path: downloadUrl });
        }
      }, 1000);

      py.on('error', function(e) {
        if (done) return;
        done = true;
        clearInterval(poll);
        clearTimeout(timer);
        try { fs.unlinkSync(tempPath); } catch(e) {}
        logger.error('/api/posttools/ncm-convert error', e);
        cb({ ok: false, error: e.message });
      });
    },

    '/api/posttools/video-analyze': function(body, cb) {
      const url = body.url || '';
      const provider = body.provider || 'dashscope'; // 默认用dashscope qwen3.6-plus
      if (!url) { cb({ error: 'url required' }); return; }
      logger.info('/api/posttools/video-analyze', { url, provider });

      const fs = require('fs');
      const os = require('os');
      const isLocal = url.startsWith('/uploads/') || url.startsWith('/');

      // 获取DashScope API Key (优先用配置的，否则用环境变量)
      const dashscopeKey = deps.dashscopeApiKey || process.env.DASHSCOPE_API_KEY || '';
      // SiliconFlow key
      const siliconflowKey = deps.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';

      if (provider === 'dashscope') {
        // ========== DashScope qwen3.6-plus 视频理解 ==========
        if (!dashscopeKey) {
          cb({ error: 'DASHSCOPE_API_KEY is not configured' });
          return;
        }

        function sendToDashScope(videoData) {
          // videoData 可以是URL字符串或 data:...;base64,xxx 格式
          const contentItems = typeof videoData === 'string' && videoData.startsWith('data:')
            ? [{ type: 'video_url', video_url: { url: videoData } }]
            : [{ type: 'video_url', video_url: { url: videoData } }];

          const payload = JSON.stringify({
            model: 'qwen3.6-plus',
            messages: [{
              role: 'user',
              content: contentItems.concat([{
                type: 'text',
                text: '请分析这个视频，找出其中有趣、有看点的时间点。用JSON格式返回，格式如下：{"segments":[{"timestamp":"0:00-0:30","description":"视频开头展示了..."},...]}。请找出5-10个有意思的时间段，给出大致的时间戳和描述。'
              }])
            }],
            max_tokens: 4000,
            temperature: 0.7
          });

          const req = https.request({
            hostname: 'dashscope.aliyuncs.com',
            port: 443,
            path: '/compatible-mode/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'Authorization': 'Bearer ' + dashscopeKey
            }
          }, function(res) {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', function() {
              if (res.statusCode < 200 || res.statusCode >= 300) {
                cb({ error: 'DashScope HTTP ' + res.statusCode + ': ' + data.substring(0, 300) });
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
                const content = message ? (message.content || '') : '';
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  cb(JSON.parse(jsonMatch[0]));
                } else {
                  cb({ segments: [{ timestamp: '0:00', description: content }] });
                }
              } catch(e) {
                cb({ error: '解析失败: ' + e.message + ', raw: ' + data.substring(0, 200) });
              }
            });
          });
          req.on('error', function(e) { cb({ error: e.message }); });
          req.setTimeout(180000, function() {
            req.destroy(new Error('DashScope request timeout'));
          });
          req.write(payload);
          req.end();
        }

        if (isLocal) {
          // 本地视频：读取文件base64编码后直接发给DashScope
          const ROOT = process.env.USAGI_RUNTIME_ROOT || path.join(__dirname, '..');
          const videoPath = url.startsWith('/')
            ? path.join(ROOT, 'public', url.replace(/^\//, ''))
            : path.join(ROOT, 'public', url);
          if (!fs.existsSync(videoPath)) {
            cb({ error: '视频文件不存在: ' + url });
            return;
          }
          const buf = fs.readFileSync(videoPath);
          const mime = 'video/mp4';
          const base64 = buf.toString('base64');
          const dataUrl = 'data:' + mime + ';base64,' + base64;
          logger.info('/api/posttools/video-analyze dashscope local', { size: base64.length });
          sendToDashScope(dataUrl);
        } else {
          // 公网URL：直接传URL
          sendToDashScope(url);
        }
        return;
      }

      // ========== SiliconFlow Qwen3-VL 帧图方式 (provider=siliconflow) ==========
      if (!siliconflowKey) {
        cb({ error: 'SILICONFLOW_API_KEY is not configured' });
        return;
      }

      function formatSegmentTime(seconds) {
        const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
        const minutes = Math.floor(safeSeconds / 60);
        const secs = safeSeconds % 60;
        return minutes + ':' + String(secs).padStart(2, '0');
      }

      function timestampToSeconds(value) {
        const match = String(value || '').match(/(\d+):(\d+)/);
        if (!match) return 0;
        return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
      }

      function normalizeSegments(data, durationSec) {
        if (!data || !Array.isArray(data.segments)) return data;
        const safeDuration = Math.max(1, Math.floor(Number(durationSec) || 1));
        const fallbackSpan = Math.max(2, Math.min(6, Math.ceil(safeDuration / 4)));
        data.segments = data.segments.slice(0, 5).map(function(seg) {
          const rawTimestamp = String(seg.timestamp || '');
          const parts = rawTimestamp.match(/(\d+):(\d+)/g) || [];
          let start = timestampToSeconds(parts[0] || rawTimestamp);
          let end = parts[1] ? timestampToSeconds(parts[1]) : start + fallbackSpan;
          start = Math.max(0, Math.min(start, safeDuration));
          end = Math.max(start + 1, Math.min(end, safeDuration));
          return {
            timestamp: formatSegmentTime(start) + '-' + formatSegmentTime(end),
            description: String(seg.description || '').trim()
          };
        }).filter(function(seg) {
          return seg.description;
        });
        return data;
      }

      function withAnalyzeMeta(data, meta) {
        const result = data && typeof data === 'object' ? data : {};
        result.meta = {
          provider: 'siliconflow',
          vision_model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
          transcript_model: 'FunAudioLLM/SenseVoiceSmall',
          transcript_used: Boolean(meta && meta.transcript),
          transcript_length: String(meta && meta.transcript || '').length,
          duration: Math.max(1, Math.floor(Number(meta && meta.durationSec) || 1)),
          frames: Array.isArray(meta && meta.frameTimeline) ? meta.frameTimeline.length : 0
        };
        return result;
      }

      function transcribeLocalVideo(videoPath, done) {
        const audioPath = path.join(os.tmpdir(), 'posttools_audio_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '.mp3');
        const ff = spawn('ffmpeg', [
          '-y',
          '-i', videoPath,
          '-vn',
          '-ac', '1',
          '-ar', '16000',
          '-t', '180',
          '-f', 'mp3',
          audioPath
        ]);
        ff.stderr.on('data', () => {});
        ff.on('error', function(err) {
          logger.warn('/api/posttools/video-analyze audio extract failed', err);
          done('');
        });
        ff.on('close', function(code) {
          if (code !== 0 || !fs.existsSync(audioPath)) {
            try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch(e) {}
            done('');
            return;
          }

          let audioBuffer;
          try {
            audioBuffer = fs.readFileSync(audioPath);
          } catch(e) {
            try { fs.unlinkSync(audioPath); } catch(cleanErr) {}
            done('');
            return;
          }

          const boundary = '----posttools-' + Date.now();
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

          const req = https.request({
            hostname: 'api.siliconflow.cn',
            port: 443,
            path: '/v1/audio/transcriptions',
            method: 'POST',
            headers: {
              'Content-Type': 'multipart/form-data; boundary=' + boundary,
              'Content-Length': body.length,
              'Authorization': 'Bearer ' + siliconflowKey
            }
          }, function(res) {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', function() {
              try { fs.unlinkSync(audioPath); } catch(e) {}
              if (res.statusCode < 200 || res.statusCode >= 300) {
                logger.warn('/api/posttools/video-analyze transcribe http ' + res.statusCode, data.substring(0, 160));
                done('');
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const text = String(parsed.text || '').trim();
                done(text);
              } catch(e) {
                logger.warn('/api/posttools/video-analyze transcribe parse failed', e);
                done('');
              }
            });
          });
          req.on('error', function(err) {
            try { fs.unlinkSync(audioPath); } catch(e) {}
            logger.warn('/api/posttools/video-analyze transcribe failed', err);
            done('');
          });
          req.setTimeout(180000, function() {
            req.destroy(new Error('SiliconFlow transcription timeout'));
          });
          req.write(body);
          req.end();
        });
      }

      function sendToSiliconFlow(contentItems, meta) {
        const durationSec = Math.max(1, Math.floor(Number(meta && meta.durationSec) || 1));
        const durationText = formatSegmentTime(durationSec);
        const frameTimeline = (meta && meta.frameTimeline || []).map(function(item) {
          return item.label + '帧=' + formatSegmentTime(item.seconds);
        }).join('，');
        const transcript = String(meta && meta.transcript || '').trim().slice(0, 3000);
        const transcriptHint = transcript
          ? '已自动转写到口播/字幕文本如下，请把它作为内容判断线索，并结合画面帧时间线合并成少量关键打点，不要逐句拆分：\n' + transcript + '\n'
          : '没有拿到可用转写文本，请主要根据画面帧判断。\n';
        const payload = JSON.stringify({
          model: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
          messages: [{
            role: 'user',
            content: contentItems.concat([{
              type: 'text',
              text: '你正在分析一个短视频的抽帧。视频真实总时长是 ' + durationText + '（' + durationSec + ' 秒），抽帧时间线：' + frameTimeline + '。' + transcriptHint + '请只根据真实时间点判断，不要编造超过总时长的时间戳。输出 3-5 个关键打点即可，不要拆太细；优先合并成“开头钩子 / 信息推进 / 转折或重点 / 结尾收束”这类剪辑节点。每个打点描述一个明显画面、剧情、情绪或口播内容变化，时间段控制在真实总时长内。只返回JSON，格式：{"segments":[{"timestamp":"0:00-0:03","description":"..." }]}。'
            }])
          }],
          max_tokens: 4000,
          temperature: 0.2
        });

        const req = https.request({
          hostname: 'api.siliconflow.cn',
          port: 443,
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Authorization': 'Bearer ' + siliconflowKey
          }
        }, function(res) {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', function() {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              cb({ error: 'SiliconFlow HTTP ' + res.statusCode + ': ' + data.substring(0, 200) });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
              const content = message ? (message.content || '') : '';
              const jsonMatch = content.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                cb(withAnalyzeMeta(normalizeSegments(JSON.parse(jsonMatch[0]), durationSec), meta));
              } else {
                cb(withAnalyzeMeta({
                  segments: [{ timestamp: '0:00-' + formatSegmentTime(Math.min(durationSec, 5)), description: content }]
                }, meta));
              }
            } catch(e) {
              cb({ error: '解析失败: ' + e.message + ', raw: ' + data.substring(0, 200) });
            }
          });
        });
        req.on('error', function(e) { cb({ error: e.message }); });
        req.setTimeout(180000, function() {
          req.destroy(new Error('SiliconFlow request timeout'));
        });
        req.write(payload);
        req.end();
      }

      if (isLocal) {
        // 本地视频：提取多帧图片后发送
        const ROOT = process.env.USAGI_RUNTIME_ROOT || path.join(__dirname, '..');
        const videoPath = url.startsWith('/')
          ? path.join(ROOT, 'public', url.replace(/^\//, ''))
          : path.join(ROOT, 'public', url);
        if (!fs.existsSync(videoPath)) {
          cb({ error: '视频文件不存在: ' + url });
          return;
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video_frames_'));
        const frameCount = 6;
        const frameFiles = [];
        const frameTimeline = [];
        let frameIdx = 0;

        function extractNextFrame(frameInfo) {
          const outPath = path.join(tmpDir, 'frame_' + String(frameIdx).padStart(3, '0') + '.jpg');
          frameFiles.push(outPath);
          frameTimeline.push(frameInfo);
          const proc = spawn('ffmpeg', [
            '-y', '-ss', frameInfo.ffmpegTime, '-i', videoPath,
            '-vframes', '1', '-q:v', '2', '-f', 'image2', outPath
          ]);
          proc.stderr.on('data', () => {});
          proc.on('error', () => {
            frameIdx++;
            if (frameIdx < frameCount) {
              extractNextFrame(getFrameInfo(frameIdx, frameCount, totalDurationSec));
            } else {
              finishFrames();
            }
          });
          proc.on('close', code => {
            frameIdx++;
            if (frameIdx < frameCount) {
              extractNextFrame(getFrameInfo(frameIdx, frameCount, totalDurationSec));
            } else {
              finishFrames();
            }
          });
        }

        function getFrameInfo(idx, total, durationSec) {
          const ratio = (idx / total) * 0.9;
          const sec = Math.min(Math.max(0, Math.floor(durationSec * ratio)), Math.max(0, durationSec - 1));
          const mm = String(Math.floor(sec / 60)).padStart(2, '0');
          const ss = String(sec % 60).padStart(2, '0');
          return {
            label: '第' + (idx + 1),
            seconds: sec,
            ffmpegTime: mm + ':' + ss
          };
        }

        function finishFrames() {
          const contentItems = [];
          const validTimeline = [];
          for (let i = 0; i < frameFiles.length; i++) {
            const fp = frameFiles[i];
            if (fs.existsSync(fp)) {
              const buf = fs.readFileSync(fp);
              const info = frameTimeline[i] || { label: '第' + (i + 1), seconds: 0 };
              validTimeline.push(info);
              contentItems.push({
                type: 'text',
                text: info.label + '帧，真实时间点：' + formatSegmentTime(info.seconds)
              });
              contentItems.push({
                type: 'image_url',
                image_url: { url: 'data:image/jpeg;base64,' + buf.toString('base64') }
              });
            }
          }
          try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
          if (contentItems.length === 0) {
            cb({ error: '无法提取视频帧，请确认视频文件有效' });
            return;
          }
          logger.info('/api/posttools/video-analyze', { local: true, frames: validTimeline.length, duration: totalDurationSec });
          transcribeLocalVideo(videoPath, function(transcript) {
            logger.info('/api/posttools/video-analyze', { transcript: Boolean(transcript), transcript_len: transcript.length });
            sendToSiliconFlow(contentItems, {
              durationSec: totalDurationSec,
              frameTimeline: validTimeline,
              transcript: transcript
            });
          });
        }

        let totalDurationSec = 60;
        const durProc = spawn('ffmpeg', ['-i', videoPath]);
        let durStdout = '';
        durProc.stdout.on('data', c => durStdout += c);
        durProc.stderr.on('data', c => durStdout += c);
        durProc.on('close', () => {
          const match = durStdout.match(/Duration: (\d+):(\d+):(\d+)(?:\.(\d+))?/);
          if (match) {
            totalDurationSec = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
          }
          extractNextFrame(getFrameInfo(0, frameCount, totalDurationSec));
        });
      } else {
        // 公网URL：直接用video_url
        sendToSiliconFlow([{
          type: 'video_url',
          video_url: { url: url }
        }], { durationSec: 60, frameTimeline: [] });
      }
    },

    '/api/posttools/ai-recommend': function(body, cb) {
      const text = body.text || '';
      if (!text) { cb({ error: 'text required' }); return; }
      logger.info('/api/posttools/ai-recommend', { text_len: text.length });

      const https = require('https');
      const SiliconFlow_KEY = deps.siliconflowApiKey || process.env.SILICONFLOW_API_KEY || process.env.SF_KEY || '';
      if (!SiliconFlow_KEY) {
        cb({ error: 'SILICONFLOW_API_KEY is not configured' });
        return;
      }

      const payload = JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [{
          role: 'user',
          content: `你是一个专业的视频剪辑策划师。请根据以下文案内容，提供画面建议和剪辑思路。

文案内容：
${text}

请以JSON格式返回，格式如下：
{
  "scenes": [
    {"time": "0:00-0:30", "visual": "远景切换到近景", "description": "开场展示整体环境"},
    {"time": "0:30-1:00", "visual": "特写镜头", "description": "人物表情细节"}
  ],
  "editing_tips": [
    "节奏把控：开头3秒要抓住观众",
    "转场建议：使用淡入淡出过渡",
    "背景音乐：建议使用轻快的背景音乐"
  ],
  "highlights": [
    "第一个笑点出现在0:45左右",
    "高潮部分在2:00-2:30"
  ]
}

要求：
- scenes 包含5-8个场景片段，每个包含time(时间范围)、visual(画面建议)、description(描述)
- editing_tips 包含3-5条剪辑技巧建议
- highlights 包含2-3个视频亮点时间点
- 只返回JSON，不要其他内容`
        }],
        max_tokens: 4000,
        temperature: 0.7
      });

      const req = https.request({
        hostname: 'api.siliconflow.cn',
        port: 443,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Authorization': 'Bearer ' + SiliconFlow_KEY
        }
      }, function(res) {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', function() {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            cb({ error: 'SiliconFlow HTTP ' + res.statusCode + ': ' + data.substring(0, 200) });
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const message = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
            const content = message ? (message.content || '') : '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              cb(JSON.parse(jsonMatch[0]));
            } else {
              cb({ scenes: [], editing_tips: [content], highlights: [] });
            }
          } catch(e) {
            cb({ error: '解析失败: ' + e.message });
          }
        });
      });
      req.on('error', function(e) { cb({ error: e.message }); });
      req.setTimeout(120000, function() {
        req.destroy(new Error('SiliconFlow request timeout'));
      });
      req.write(payload);
      req.end();
    }
  };
};
