const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:ideas');

module.exports = function createIdeasRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const runPython = deps.runPython;
  const dataDir = path.join(root, 'data');
  const dbPath = path.join(dataDir, 'ideas.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  function getDb() {
    return adapter.createDb();
  }

  const initDb = getDb();
  initDb.run(`CREATE TABLE IF NOT EXISTS ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name   TEXT    NOT NULL,
    platform    TEXT    NOT NULL,
    video_url   TEXT    NOT NULL,
    video_title TEXT    DEFAULT '',
    summary     TEXT    DEFAULT '',
    tags        TEXT    DEFAULT '[]',
    note        TEXT    DEFAULT '',
    click_count INTEGER DEFAULT 0,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  )`);
  initDb.run(`CREATE TABLE IF NOT EXISTS idea_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    idea_id     INTEGER NOT NULL,
    user_name   TEXT    NOT NULL,
    text        TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s','now'))
  )`);
  initDb.run(`CREATE TABLE IF NOT EXISTS idea_favorites (
    idea_id     INTEGER NOT NULL,
    user_name   TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s','now')),
    PRIMARY KEY (idea_id, user_name)
  )`);
  initDb.run(`ALTER TABLE ideas ADD COLUMN click_count INTEGER DEFAULT 0`, [], function() {
    initDb.close();
  });

  return {
    '/api/ideas/list': function(body, cb) {
      const auth = body._auth || {};
      const currentUser = auth.username || body.user_name || '';
      const db = getDb();
      db.all('SELECT * FROM ideas ORDER BY created_at DESC', [], function(err, rows) {
        if (err) { cb({ error: err.message }); return; }
        const ideas = rows.map(function(row) {
          try { row.tags = JSON.parse(row.tags || '[]'); }
          catch(e) { row.tags = []; }
          row.comments = [];
          return row;
        });
        if (!ideas.length) {
          db.close();
          cb({ ideas: ideas });
          return;
        }
        const ids = ideas.map(function(row) { return row.id; });
        const placeholders = ids.map(function() { return '?'; }).join(',');
        db.all('SELECT * FROM idea_comments WHERE idea_id IN (' + placeholders + ') ORDER BY created_at ASC, id ASC', ids, function(commentErr, commentRows) {
          if (commentErr) { db.close(); cb({ error: commentErr.message }); return; }
          const byIdea = {};
          ideas.forEach(function(idea) { byIdea[idea.id] = idea; });
          (commentRows || []).forEach(function(comment) {
            if (byIdea[comment.idea_id]) byIdea[comment.idea_id].comments.push(comment);
          });
          db.all('SELECT idea_id, user_name FROM idea_favorites WHERE idea_id IN (' + placeholders + ')', ids, function(favErr, favoriteRows) {
            db.close();
            if (favErr) { cb({ error: favErr.message }); return; }
            const favoriteCounts = {};
            const myFavorites = {};
            (favoriteRows || []).forEach(function(row) {
              favoriteCounts[row.idea_id] = (favoriteCounts[row.idea_id] || 0) + 1;
              if (currentUser && row.user_name === currentUser) myFavorites[row.idea_id] = true;
            });
            ideas.forEach(function(idea) {
              idea.favorite_count = favoriteCounts[idea.id] || 0;
              idea.is_favorited = !!myFavorites[idea.id];
            });
            cb({ ideas: ideas });
          });
        });
      });
    },

    '/api/ideas/add': function(body, cb) {
      const userName = (body._auth && body._auth.username) || body.user_name || '';
      const platform = body.platform || '';
      const videoUrl = body.video_url || '';
      const videoTitle = body.video_title || '';
      const summary = body.summary || '';
      const tags = JSON.stringify(body.tags || []);
      const note = body.note || '';
      if (!userName || !videoUrl) { cb({ error: '缺少必填字段' }); return; }

      const db = getDb();
      db.run(
        'INSERT INTO ideas (user_name,platform,video_url,video_title,summary,tags,note) VALUES (?,?,?,?,?,?,?)',
        [userName, platform, videoUrl, videoTitle, summary, tags, note],
        function(err) {
          db.close();
          if (err) { cb({ error: err.message }); return; }
          cb({ id: this.lastID });
        }
      );
    },

    '/api/ideas/update': function(body, cb) {
      const id = body.id || '';
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      const platform = body.platform || '';
      const videoUrl = body.video_url || '';
      const videoTitle = body.video_title || '';
      const summary = body.summary || '';
      const tags = JSON.stringify(Array.isArray(body.tags) ? body.tags : []);
      const note = body.note || '';
      if (!id || !videoUrl || (!userName && auth.role !== 'admin')) {
        cb({ error: 'missing required fields' });
        return;
      }
      const db = getDb();
      const sql = auth.role === 'admin' && !body.user_name
        ? 'UPDATE ideas SET platform=?, video_url=?, video_title=?, summary=?, tags=?, note=? WHERE id=?'
        : 'UPDATE ideas SET platform=?, video_url=?, video_title=?, summary=?, tags=?, note=? WHERE id=? AND user_name=?';
      const args = auth.role === 'admin' && !body.user_name
        ? [platform, videoUrl, videoTitle, summary, tags, note, id]
        : [platform, videoUrl, videoTitle, summary, tags, note, id, userName];
      db.run(sql, args, function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ updated: this.changes });
      });
    },

    '/api/ideas/delete': function(body, cb) {
      const id = body.id || '';
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      if (!id || (!userName && auth.role !== 'admin')) { cb({ error: '缺少参数' }); return; }
      const db = getDb();
      const sql = auth.role === 'admin' && !body.user_name ? 'DELETE FROM ideas WHERE id=?' : 'DELETE FROM ideas WHERE id=? AND user_name=?';
      const args = auth.role === 'admin' && !body.user_name ? [id] : [id, userName];
      db.run(sql, args, function(err) {
        if (err) { cb({ error: err.message }); return; }
        const deleted = this.changes;
        if (!deleted) {
          db.close();
          cb({ deleted: deleted });
          return;
        }
        db.run('DELETE FROM idea_comments WHERE idea_id=?', [id], function(commentErr) {
          if (commentErr) { db.close(); cb({ error: commentErr.message }); return; }
          db.run('DELETE FROM idea_favorites WHERE idea_id=?', [id], function(favErr) {
            db.close();
            if (favErr) { cb({ error: favErr.message }); return; }
            cb({ deleted: deleted });
          });
        });
      });
    },

    '/api/ideas/comment/add': function(body, cb) {
      const ideaId = Number(body.idea_id || body.ideaId || 0);
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      const text = String(body.text || '').trim().slice(0, 80);
      if (!ideaId || !userName || !text) {
        cb({ error: 'missing required fields' });
        return;
      }
      const db = getDb();
      db.get('SELECT id FROM ideas WHERE id=?', [ideaId], function(ideaErr, idea) {
        if (ideaErr) {
          db.close();
          cb({ error: ideaErr.message });
          return;
        }
        if (!idea) {
          db.close();
          cb({ error: 'idea not found' });
          return;
        }
        db.run(
          'INSERT INTO idea_comments (idea_id,user_name,text) VALUES (?,?,?)',
          [ideaId, userName, text],
          function(err) {
            if (err) {
              db.close();
              cb({ error: err.message });
              return;
            }
            const id = this.lastID;
            db.get('SELECT * FROM idea_comments WHERE id=?', [id], function(readErr, row) {
              db.close();
              if (readErr) { cb({ error: readErr.message }); return; }
              cb({ comment: row });
            });
          }
        );
      });
    },

    '/api/ideas/comment/delete': function(body, cb) {
      const id = Number(body.id || 0);
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      if (!id || (!userName && auth.role !== 'admin')) {
        cb({ error: 'missing required fields' });
        return;
      }
      const db = getDb();
      const sql = auth.role === 'admin'
        ? 'DELETE FROM idea_comments WHERE id=?'
        : 'DELETE FROM idea_comments WHERE id=? AND user_name=?';
      const args = auth.role === 'admin' ? [id] : [id, userName];
      db.run(sql, args, function(err) {
        db.close();
        if (err) { cb({ error: err.message }); return; }
        cb({ deleted: this.changes });
      });
    },

    '/api/ideas/favorite/toggle': function(body, cb) {
      const ideaId = Number(body.id || body.idea_id || body.ideaId || 0);
      const auth = body._auth || {};
      const userName = auth.username || body.user_name || '';
      const favorite = body.favorite !== false;
      if (!ideaId || !userName) {
        cb({ error: 'missing required fields' });
        return;
      }
      const db = getDb();
      db.get('SELECT id FROM ideas WHERE id=?', [ideaId], function(ideaErr, idea) {
        if (ideaErr) {
          db.close();
          cb({ error: ideaErr.message });
          return;
        }
        if (!idea) {
          db.close();
          cb({ error: 'idea not found' });
          return;
        }
        const done = function(err) {
          if (err) {
            db.close();
            cb({ error: err.message });
            return;
          }
          db.get(
            'SELECT COUNT(*) AS count FROM idea_favorites WHERE idea_id=?',
            [ideaId],
            function(countErr, row) {
              db.close();
              if (countErr) { cb({ error: countErr.message }); return; }
              cb({
                id: ideaId,
                is_favorited: favorite,
                favorite_count: row ? Number(row.count || 0) : 0
              });
            }
          );
        };
        if (favorite) {
          db.run(
            'INSERT OR IGNORE INTO idea_favorites (idea_id,user_name) VALUES (?,?)',
            [ideaId, userName],
            done
          );
        } else {
          db.run(
            'DELETE FROM idea_favorites WHERE idea_id=? AND user_name=?',
            [ideaId, userName],
            done
          );
        }
      });
    },

    '/api/ideas/click': function(body, cb) {
      const ideaId = Number(body.id || body.idea_id || body.ideaId || 0);
      if (!ideaId) {
        cb({ error: 'missing required fields' });
        return;
      }
      const db = getDb();
      db.run(
        'UPDATE ideas SET click_count=COALESCE(click_count,0)+1 WHERE id=?',
        [ideaId],
        function(err) {
          if (err) {
            db.close();
            cb({ error: err.message });
            return;
          }
          if (!this.changes) {
            db.close();
            cb({ error: 'idea not found' });
            return;
          }
          db.get('SELECT click_count FROM ideas WHERE id=?', [ideaId], function(readErr, row) {
            db.close();
            if (readErr) { cb({ error: readErr.message }); return; }
            cb({
              id: ideaId,
              click_count: row ? Number(row.click_count || 0) : 0
            });
          });
        }
      );
    },

    '/api/ideas/parse': function(body, cb) {
      const videoUrl = body.url || '';
      if (!videoUrl) { cb({ error: 'url required' }); return; }
      const script = videoUrl.includes('bilibili.com') || videoUrl.includes('b23.tv')
        ? 'transcribe_bilibili.py'
        : 'transcribe_douyin.py';
      runPython(script, 'parse', { url: videoUrl }, 60).then(function(result) {
        cb(result);
      }).catch(function(e) {
        cb({ error: e.message });
      });
    }
  };
};
