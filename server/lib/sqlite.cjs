const { spawn, spawnSync } = require('child_process');

function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function bindSql(sql, params) {
  const values = Array.isArray(params) ? params.slice() : [];
  return String(sql || '').replace(/\?/g, function() {
    return sqlValue(values.shift());
  });
}

function createCliDb(dbPath) {
  function runCli(sql, params, jsonMode, callback) {
    const finalSql = bindSql(sql, params).trim();
    const args = jsonMode ? ['-json', dbPath, finalSql] : [dbPath, finalSql];
    const proc = spawn('sqlite3', args);
    const out = [];
    const err = [];
    proc.stdout.on('data', chunk => out.push(chunk));
    proc.stderr.on('data', chunk => err.push(chunk));
    proc.on('error', error => callback(error));
    proc.on('close', code => {
      const stdout = Buffer.concat(out).toString('utf8').trim();
      const stderr = Buffer.concat(err).toString('utf8').trim();
      if (code !== 0) {
        callback(new Error(stderr || 'sqlite3 exited with code ' + code));
        return;
      }
      if (!jsonMode) {
        callback(null, stdout);
        return;
      }
      try {
        callback(null, stdout ? JSON.parse(stdout) : []);
      } catch(e) {
        callback(e);
      }
    });
  }

  function runCliSync(sql, params) {
    const finalSql = bindSql(sql, params).trim();
    const result = spawnSync('sqlite3', [dbPath, finalSql], { encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error((result.stderr || '').trim() || 'sqlite3 exited with code ' + result.status);
    }
  }

  return {
    run(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      params = params || [];
      if (!callback) {
        runCliSync(sql, params);
        return this;
      }

      const wantsMeta = /^\s*(insert|update|delete)\b/i.test(String(sql || ''));
      const finalSql = bindSql(sql, params).trim() +
        (wantsMeta ? ';\nSELECT last_insert_rowid() AS id, changes() AS changes' : '');
      runCli(finalSql, [], wantsMeta, function(err, result) {
        const meta = Array.isArray(result) && result[0] ? result[0] : {};
        callback.call({
          lastID: Number(meta.id) || 0,
          changes: Number(meta.changes) || 0
        }, err || null);
      });
      return this;
    },

    all(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      runCli(sql, params || [], true, function(err, rows) {
        callback(err || null, rows || []);
      });
      return this;
    },

    get(sql, params, callback) {
      if (typeof params === 'function') {
        callback = params;
        params = [];
      }
      runCli(sql, params || [], true, function(err, rows) {
        callback(err || null, rows && rows[0]);
      });
      return this;
    },

    close() {}
  };
}

module.exports = function createSqliteAdapter(options) {
  const dbPath = options.dbPath;
  const logger = options.logger;
  let sqlite3 = null;

  try {
    sqlite3 = require('sqlite3');
  } catch(e) {
    if (logger && logger.warn) {
      logger.warn('sqlite3 native module unavailable, falling back to sqlite3 CLI', e);
    }
  }

  return {
    dbPath,
    native: Boolean(sqlite3),
    createDb() {
      if (sqlite3) {
        // Return native sqlite3 Database with wrapper for callback compatibility
        const Database = sqlite3.Database;
        const db = new Database(dbPath);
        return {
          run(sql, params, callback) {
            if (typeof params === 'function') {
              callback = params;
              params = [];
            }
            params = params || [];
            if (!callback) {
              // Run synchronously without callback - blocks until complete
              db.run(sql, params);
              return this;
            }
            db.run(sql, params, function(err) {
              callback.call({ lastID: this.lastID, changes: this.changes }, err);
            });
            return this;
          },
          all(sql, params, callback) {
            if (typeof params === 'function') {
              callback = params;
              params = [];
            }
            db.all(sql, params || [], function(err, rows) {
              callback(err, rows || []);
            });
            return this;
          },
          get(sql, params, callback) {
            if (typeof params === 'function') {
              callback = params;
              params = [];
            }
            db.get(sql, params || [], function(err, row) {
              callback(err, row);
            });
            return this;
          },
          close() {
            db.close();
          }
        };
      }
      return createCliDb(dbPath);
    }
  };
};
