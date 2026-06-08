const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('materials:db');

module.exports = function createMaterialsDb(options) {
  const dataDir = options.dataDir;
  const dbPath = options.dbPath || path.join(dataDir, 'materials.db');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const adapter = createSqliteAdapter({ dbPath: dbPath, logger: logger });
  const db = adapter.createDb();
  db.run(`CREATE TABLE IF NOT EXISTS materials (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT    NOT NULL,
    original   TEXT    NOT NULL,
    size       INTEGER NOT NULL,
    duration   REAL    DEFAULT 0,
    width      INTEGER DEFAULT 0,
    height     INTEGER DEFAULT 0,
    thumb      TEXT    DEFAULT '',
    category   TEXT    DEFAULT '待分类',
    tags       TEXT    DEFAULT '[]',
    type       TEXT    DEFAULT 'video',
    folder     TEXT    DEFAULT '/',
    uploader   TEXT    DEFAULT '匿名',
    status     TEXT    DEFAULT 'ready',
    storage_path TEXT  DEFAULT '',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  // 迁移：旧数据库可能缺少 type 和 folder 列
  db.run(`ALTER TABLE materials ADD COLUMN type TEXT DEFAULT 'video'`, function(err) {
    // 忽略已存在列的错误
  });
  db.run(`ALTER TABLE materials ADD COLUMN folder TEXT DEFAULT '/'`, function(err) {
    // 忽略已存在列的错误
  });

  // 创建 folders 表用于文件夹管理
  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    parent     TEXT    DEFAULT '/',
    type       TEXT    DEFAULT 'video',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  )`);

  db.run(`ALTER TABLE materials ADD COLUMN status TEXT DEFAULT 'ready'`, function(err) {
    // ignore existing column
  });
  db.run(`ALTER TABLE materials ADD COLUMN storage_path TEXT DEFAULT ''`, function(err) {
    // ignore existing column
  });

  return {
    getDb() {
      return db;
    },
    dbPath: dbPath
  };
};
