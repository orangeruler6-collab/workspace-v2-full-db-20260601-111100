const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:feedback');

function now() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value, max) {
  const text = String(value || '').replace(/\r/g, '\n').trim();
  return max ? text.slice(0, max) : text;
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed === undefined ? fallback : parsed;
  } catch(e) {
    return fallback;
  }
}

function normalizeStatus(value) {
  const status = String(value || '').trim();
  if (['open', 'reviewing', 'doing', 'done', 'closed'].includes(status)) return status;
  return 'open';
}

function normalizePriority(value) {
  const priority = String(value || '').trim();
  if (['low', 'normal', 'high', 'urgent'].includes(priority)) return priority;
  return 'normal';
}

function saveScreenshot(root, payload) {
  const raw = String(payload.screenshot_data || payload.screenshotData || '').trim();
  if (!raw) return '';
  const mime = String(payload.screenshot_type || payload.screenshotType || '').toLowerCase();
  const allowed = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif'
  };
  const ext = allowed[mime] || '.png';
  const base64 = raw.includes(',') ? raw.split(',').pop() : raw;
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) return '';
  if (buffer.length > 8 * 1024 * 1024) throw new Error('截图不能超过 8MB');
  const dir = path.join(root, 'public', 'uploads', 'feedback');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const name = now() + '_' + crypto.randomBytes(5).toString('hex') + ext;
  fs.writeFileSync(path.join(dir, name), buffer);
  return '/uploads/feedback/' + encodeURIComponent(name);
}

function normalizeRow(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    module: row.module || '',
    priority: row.priority || 'normal',
    status: row.status || 'open',
    screenshot_url: row.screenshot_url || '',
    reporter: {
      username: row.user_name,
      display_name: row.display_name || row.user_name,
      group_name: row.group_name || ''
    },
    assignee: row.assignee || '',
    reply: row.reply || '',
    tags: safeJson(row.tags, []),
    created_at: row.created_at || 0,
    updated_at: row.updated_at || 0
  };
}

module.exports = function createFeedbackRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'feedback.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath, logger });
  function getDb() {
    return adapter.createDb();
  }

  const initDb = getDb();
  initDb.run(`CREATE TABLE IF NOT EXISTS feedback_items (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name      TEXT    NOT NULL,
    display_name   TEXT    DEFAULT '',
    group_name     TEXT    DEFAULT '',
    title          TEXT    NOT NULL,
    content        TEXT    NOT NULL,
    module         TEXT    DEFAULT '',
    priority       TEXT    DEFAULT 'normal',
    status         TEXT    DEFAULT 'open',
    screenshot_url TEXT    DEFAULT '',
    assignee       TEXT    DEFAULT '',
    reply          TEXT    DEFAULT '',
    tags           TEXT    DEFAULT '[]',
    created_at     INTEGER DEFAULT (strftime('%s','now')),
    updated_at     INTEGER DEFAULT (strftime('%s','now'))
  )`);
  initDb.close();

  return {
    '/api/feedback/list': function(body, cb) {
      const status = cleanText(body.status, 40);
      const moduleId = cleanText(body.module, 80);
      const keyword = cleanText(body.keyword, 100);
      const limit = Math.max(1, Math.min(200, Number(body.limit) || 100));
      const where = [];
      const args = [];
      if (status) {
        where.push('status=?');
        args.push(status);
      }
      if (moduleId) {
        where.push('module=?');
        args.push(moduleId);
      }
      if (keyword) {
        where.push('(title LIKE ? OR content LIKE ? OR user_name LIKE ? OR display_name LIKE ?)');
        const like = '%' + keyword + '%';
        args.push(like, like, like, like);
      }
      const sql = 'SELECT * FROM feedback_items' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC, id DESC LIMIT ?';
      args.push(limit);
      const db = getDb();
      db.all(sql, args, function(err, rows) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, items: (rows || []).map(normalizeRow) });
      });
    },

    '/api/feedback/create': function(body, cb) {
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      const displayName = auth.display_name || auth.real_name || userName;
      const groupName = auth.group_name || '';
      const title = cleanText(body.title, 100);
      const content = cleanText(body.content, 3000);
      if (!userName || !title || !content) {
        cb({ error: '请填写标题和反馈内容' });
        return;
      }
      let screenshotUrl = '';
      try {
        screenshotUrl = saveScreenshot(root, body);
      } catch(e) {
        cb({ error: e.message });
        return;
      }
      const ts = now();
      const db = getDb();
      db.run(
        `INSERT INTO feedback_items (
          user_name,display_name,group_name,title,content,module,priority,status,screenshot_url,tags,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          userName,
          displayName,
          groupName,
          title,
          content,
          cleanText(body.module, 80),
          normalizePriority(body.priority),
          'open',
          screenshotUrl,
          JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
          ts,
          ts
        ],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ ok: true, id: this.lastID, screenshot_url: screenshotUrl });
        }
      );
    },

    '/api/feedback/update': function(body, cb) {
      const id = Number(body.id || 0);
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      db.run(
        `UPDATE feedback_items
         SET status=?, priority=?, assignee=?, reply=?, updated_at=?
         WHERE id=?`,
        [
          normalizeStatus(body.status),
          normalizePriority(body.priority),
          cleanText(body.assignee, 80),
          cleanText(body.reply, 1200),
          now(),
          id
        ],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ ok: true, updated: this.changes });
        }
      );
    },

    '/api/feedback/delete': function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      if (!id) { cb({ error: 'missing id' }); return; }
      const db = getDb();
      const sql = auth.role === 'admin'
        ? 'DELETE FROM feedback_items WHERE id=?'
        : 'DELETE FROM feedback_items WHERE id=? AND user_name=?';
      const args = auth.role === 'admin' ? [id] : [id, auth.username || ''];
      db.run(sql, args, function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, deleted: this.changes });
      });
    }
  };
};
