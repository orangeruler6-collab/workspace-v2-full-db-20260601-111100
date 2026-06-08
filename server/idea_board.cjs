const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const url = require('url');
const createLogger = require('./lib/logger.cjs');

const logger = createLogger('idea-board');

// ─── SQLite 轻量封装 ───────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', 'data', 'ideas.db');

function getDb() {
  const sqlite3 = require('sqlite3').verbose();
  return new sqlite3.Database(DB_PATH);
}

function initDb() {
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database(DB_PATH);
  db.run(`CREATE TABLE IF NOT EXISTS ideas (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name  TEXT    NOT NULL,
    platform   TEXT    NOT NULL,
    video_url  TEXT    NOT NULL,
    video_title TEXT   DEFAULT '',
    summary    TEXT    DEFAULT '',
    tags       TEXT    DEFAULT '[]',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);
  db.close();
}

// 确保 data 目录存在
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
initDb();

// ─── 工具函数 ───────────────────────────────────────────────────────────────
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function runPython(script, action, params, timeoutSec) {
  return new Promise(function(resolve) {
    const tmpFile = path.join(os.tmpdir(), 'usagi_idea_' + Date.now() + '.json');
    fs.writeFileSync(tmpFile, JSON.stringify({ action: action, params: params }), 'utf8');
    const scriptPath = path.join(__dirname, script);
    const py = spawn('C:\\Users\\Administrator\\AppData\\Local\\Python\\pythoncore-3.14-64\\python.exe', [scriptPath, tmpFile], {
      env: Object.assign({}, process.env, { PYTHONIOENCODGE: 'utf-8' })
    });
    const outChunks = [], errChunks = [];
    let timer;
    if (timeoutSec) {
      timer = setTimeout(() => { py.kill(); resolve({ error: 'timeout after ' + timeoutSec + 's' }); }, timeoutSec * 1000);
    }
    py.stdout.on('data', c => outChunks.push(c));
    py.stderr.on('data', c => errChunks.push(c));
    py.on('close', () => {
      if (timer) clearTimeout(timer);
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      const outStr = Buffer.concat(outChunks).toString('utf8');
      const errStr = Buffer.concat(errChunks).toString('utf8');
      try {
        resolve(JSON.parse(outStr));
      } catch(e) {
        resolve({ raw: outStr.substring(0, 500), error: errStr.trim().substring(0, 200) });
      }
    });
    py.stdin.end();
  });
}

// ─── 视频解析 ──────────────────────────────────────────────────────────────
async function parseVideo(videoUrl) {
  // 检测平台
  const isBilibili = videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv');
  const isDouyin = videoUrl.includes('douyin.com') || videoUrl.includes('v.douyin.com');

  try {
    let result;
    if (isBilibili) {
      result = await runPython('transcribe_bilibili.py', 'parse', { url: videoUrl }, 60);
    } else if (isDouyin) {
      result = await runPython('transcribe_douyin.py', 'parse', { url: videoUrl }, 60);
    } else {
      return { error: '不支持的平台，仅支持抖音和B站' };
    }
    return result;
  } catch(e) {
    return { error: '解析失败: ' + e.message };
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // ── GET /api/ideas ── 获取全部便签
  if (req.method === 'GET' && pathname === '/api/ideas') {
    const db = getDb();
    db.all("SELECT * FROM ideas ORDER BY created_at DESC", [], (err, rows) => {
      db.close();
      if (err) return sendJSON(res, 500, { error: err.message });
      // 解析 tags JSON
      const ideas = rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') }));
      sendJSON(res, 200, { ideas });
    });
    return;
  }

  // ── POST /api/ideas ── 新增便签
  if (req.method === 'POST' && pathname === '/api/ideas') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { user_name, platform, video_url, video_title, summary, tags } = JSON.parse(body);
        if (!user_name || !video_url) {
          return sendJSON(res, 400, { error: '缺少必填字段' });
        }
        const db = getDb();
        db.run(
          "INSERT INTO ideas (user_name, platform, video_url, video_title, summary, tags) VALUES (?,?,?,?,?,?)",
          [user_name, platform || '', video_url, video_title || '', summary || '', JSON.stringify(tags || [])],
          function(err) {
            db.close();
            if (err) return sendJSON(res, 500, { error: err.message });
            sendJSON(res, 200, { id: this.lastID });
          }
        );
      } catch(e) {
        sendJSON(res, 400, { error: e.message });
      }
    });
    return;
  }

  // ── DELETE /api/ideas/:id ── 删除便签
  if (req.method === 'DELETE' && pathname.startsWith('/api/ideas/')) {
    const id = pathname.split('/').pop();
    const parsedUrlDelete = url.parse(req.url, true);
    const user_name = parsedUrlDelete.query.user_name;

    if (!user_name) return sendJSON(res, 400, { error: '缺少 user_name' });

    const db = getDb();
    db.run("DELETE FROM ideas WHERE id = ? AND user_name = ?", [id, user_name], function(err) {
      db.close();
      if (err) return sendJSON(res, 500, { error: err.message });
      sendJSON(res, 200, { deleted: this.changes });
    });
    return;
  }

  // ── POST /api/ideas/parse ── 解析视频URL
  if (req.method === 'POST' && pathname === '/api/ideas/parse') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: videoUrl } = JSON.parse(body);
        if (!videoUrl) return sendJSON(res, 400, { error: '缺少 url' });
        const result = await parseVideo(videoUrl);
        if (result.error) return sendJSON(res, 400, result);
        sendJSON(res, 200, result);
      } catch(e) {
        sendJSON(res, 400, { error: e.message });
      }
    });
    return;
  }

  sendJSON(res, 404, { error: 'not found' });
});

const PORT = 5556;
server.listen(PORT, () => {
  logger.info('listening', { port: PORT });
});
