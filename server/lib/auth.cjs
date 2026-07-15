const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3');
const createLogger = require('./logger.cjs');
let ProxyAgent = null;
try {
  ProxyAgent = require('undici').ProxyAgent;
} catch(e) {
  ProxyAgent = null;
}

const logger = createLogger('auth');

const SESSION_DAYS = 30;
const ERP_API_BASE = String(process.env.ERP_API_BASE || 'https://erp.changwankeji.com:8188/api.php').trim();
const ERP_AUTH_PROXY = String(process.env.ERP_AUTH_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '').trim();
const ERP_FETCH_DISPATCHER = ERP_AUTH_PROXY && ProxyAgent ? new ProxyAgent(ERP_AUTH_PROXY) : undefined;
const ERP_REQUEST_TIMEOUT_MS = Number(process.env.ERP_AUTH_TIMEOUT_MS) || 10000;
const HASH_ITERATIONS = 120000;
const HASH_BYTES = 64;
const DEFAULT_MEMBER_PERMISSIONS = [
  'projectAgent',
  'trafficPlan',
  'trafficApply',
  'dailyhot',
  'hotspotRadar',
  'importedDouyinHotlist',
  'accountmonitor',
  'styleCollect',
  'styleLibrary',
  'styleProjectWorkbench',
  'styleProjects',
  'styleWriter',
  'styleAssets',
  'styleGrossMargin',
  'styleDouyinHotlist',
  'styleDrafts',
  'tools',
  'accountStyle',
  'copygen',
  'schedule',
  'imagegen',
  'workflow',
  'material',
  'projectDelivery',
  'ideaboard',
  'videopublish',
  'posttools',
  'vector'
];
const SENSITIVE_MEMBER_MODULES = ['ops', 'commentReply'];
const ADMIN_ONLY_MODULES = ['adminUsers', 'operationLogs'];
const ALL_MODULES = DEFAULT_MEMBER_PERMISSIONS.concat(SENSITIVE_MEMBER_MODULES, ADMIN_ONLY_MODULES);
const LEGACY_DEFAULT_MEMBER_PERMISSION_SETS = [
  [
    'dailyhot',
    'tools',
    'accountStyle',
    'copygen',
    'schedule',
    'ops',
    'imagegen',
    'workflow',
    'material',
    'ideoboard',
    'posttools',
    'vector',
    'trafficPlan',
    'trafficApply'
  ]
];
const SECRET_KEYS = /pass|password|token|authorization|api.?key|secret|cookie|session|credential|video_base64|file_data|image_base64|pwd|hash|salt/i;
// 邀请码必须从环境变量读取，不允许硬编码
const CHINESE_REAL_NAME = /^[\u4e00-\u9fa5]{2,20}$/;
const VALID_GROUPS = ['内容一部', '\u5185\u5bb9\u4e00\u7ec4', '\u5185\u5bb9\u4e8c\u7ec4', '\u5185\u5bb9\u4e09\u7ec4', '\u5185\u5bb9\u56db\u7ec4', '\u5185\u5bb9\u4e94\u7ec4', '\u5185\u5bb9\u516d\u7ec4', 'MCN\u7ecf\u7eaa\u7ec4'];
const VALID_EMPLOYEE_TYPES = ['\u6b63\u5f0f\u5458\u5de5', '\u5b9e\u4e60\u751f'];

function now() {
  return Math.floor(Date.now() / 1000);
}

// Escape special LIKE characters to prevent LIKE injection
function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, '\\$&');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function parsePermissions(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch(e) {
    return [];
  }
}

function cleanPermissions(value) {
  const allowed = new Set(DEFAULT_MEMBER_PERMISSIONS.concat(SENSITIVE_MEMBER_MODULES));
  return Array.from(new Set(parsePermissions(value).filter(id => allowed.has(id))));
}

function rolePermissions(role, permissions) {
  if (role === 'admin') return ALL_MODULES.slice();
  return cleanPermissions(permissions);
}

function isLegacyDefaultMemberPermissionSet(permissions) {
  const parsed = parsePermissions(permissions);
  if (parsed.indexOf('ops') < 0) return false;
  const sorted = parsed.slice().sort().join('\n');
  const currentDefaultWithOps = DEFAULT_MEMBER_PERMISSIONS.concat('ops').slice().sort().join('\n');
  if (sorted === currentDefaultWithOps) return true;
  return LEGACY_DEFAULT_MEMBER_PERMISSION_SETS.some(set => sorted === set.slice().sort().join('\n'));
}

function removePermission(permissions, moduleId) {
  return parsePermissions(permissions).filter(id => id !== moduleId);
}

function hashPassword(password, salt) {
  const finalSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password || ''), finalSalt, HASH_ITERATIONS, HASH_BYTES, 'sha512').toString('hex');
  return { salt: finalSalt, hash: hash };
}

function safeParseMeta(value) {
  try { return JSON.parse(value || '{}'); }
  catch(e) { return {}; }
}

function sanitizeMeta(value, depth) {
  if (depth > 4) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(item => sanitizeMeta(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).slice(0, 80).forEach(key => {
      if (SECRET_KEYS.test(key)) {
        out[key] = '[redacted]';
        return;
      }
      out[key] = sanitizeMeta(value[key], depth + 1);
    });
    return out;
  }
  const text = String(value);
  if (text.length > 600) return text.slice(0, 600) + '...[truncated]';
  return value;
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || '';
}

function isAdminLike(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const title = user.title || '';
  return title === '组长' || title === '部长';
}

function publicUser(row) {
  if (!row) return null;
  const role = row.role === 'admin' ? 'admin' : 'member';
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    real_name: row.real_name || '',
    group_name: row.group_name || '',
    employee_type: row.employee_type || '正式员工',
    title: row.title || '',
    role: role,
    permissions: rolePermissions(role, row.permissions),
    active: Number(row.active) === 1,
    is_on_job: Number(row.is_on_job) === 1,
    is_pending: Number(row.pending) === 1,
    created_at: row.created_at || 0,
    updated_at: row.updated_at || 0,
    last_login_at: row.last_login_at || 0
  };
}

function cleanExternalText(value, limit) {
  return String(value || '').trim().slice(0, limit || 120);
}

function normalizeErpUserInfo(data) {
  const source = data && data.data && typeof data.data === 'object' ? data.data : data || {};
  return {
    uid: cleanExternalText(source.uid, 64),
    name: cleanExternalText(source.name, 80),
    user: cleanExternalText(source.user, 80),
    centerid: cleanExternalText(source.centerid, 64),
    centername: cleanExternalText(source.centername, 120),
    deptid: cleanExternalText(source.deptid, 64),
    deptname: cleanExternalText(source.deptname, 120)
  };
}

function createAuthStore(options) {
  const root = options.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = path.join(dataDir, 'auth.db');
  logger.info('auth db path', { root, dataDir, dbPath, dbExists: fs.existsSync(dbPath) });
  const db = new sqlite3.Database(dbPath);

  function run(sql, params) {
    return new Promise((resolve, reject) => {
      db.run(sql, params || [], function(err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  function get(sql, params) {
    return new Promise((resolve, reject) => {
      db.get(sql, params || [], function(err, row) {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  function all(sql, params) {
    return new Promise((resolve, reject) => {
      db.all(sql, params || [], function(err, rows) {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  async function init() {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT DEFAULT '',
      real_name TEXT DEFAULT '',
      group_name TEXT DEFAULT '',
      employee_type TEXT DEFAULT '正式员工',
      role TEXT NOT NULL DEFAULT 'member',
      permissions TEXT NOT NULL DEFAULT '[]',
      password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      is_on_job INTEGER NOT NULL DEFAULT 1,
      pending INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER DEFAULT 0
    )`);
    // Add new columns if they don't exist (for existing databases)
    try {
      await run(`ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN group_name TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN employee_type TEXT DEFAULT '正式员工'`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN is_on_job INTEGER DEFAULT 1`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN pending INTEGER DEFAULT 1`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN title TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN password_salt TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN erp_uid TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN erp_user TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN erp_deptname TEXT DEFAULT ''`);
    } catch(e) {}
    try {
      await run(`ALTER TABLE users ADD COLUMN erp_centername TEXT DEFAULT ''`);
    } catch(e) {}
    await run("UPDATE users SET pending=0 WHERE active=1 AND length(coalesce(password_hash,''))>0");
    await run(`CREATE TABLE IF NOT EXISTS auth_migrations (
      key TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )`);
    const opsMigration = await get("SELECT key FROM auth_migrations WHERE key='remove_ops_from_legacy_member_defaults_v1'");
    if (!opsMigration) {
      const legacyRows = await all("SELECT id, permissions FROM users WHERE role='member' AND permissions LIKE '%ops%'");
      for (const row of legacyRows) {
        if (isLegacyDefaultMemberPermissionSet(row.permissions)) {
          await run('UPDATE users SET permissions=? WHERE id=?', [JSON.stringify(removePermission(row.permissions, 'ops')), row.id]);
        }
      }
      await run("INSERT OR REPLACE INTO auth_migrations (key, applied_at) VALUES (?, ?)", ['remove_ops_from_legacy_member_defaults_v1', now()]);
    }
    await run(`CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER DEFAULT 0
    )`);
    await run(`CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      username TEXT DEFAULT '',
      role TEXT DEFAULT '',
      module TEXT DEFAULT '',
      action TEXT DEFAULT '',
      target_type TEXT DEFAULT '',
      target_id TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      metadata TEXT DEFAULT '{}',
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    )`);
    await seedAdmin();
  }

  async function seedAdmin() {
    const countRow = await get("SELECT COUNT(*) AS cnt FROM users WHERE role='admin' AND active=1");
    if (Number(countRow && countRow.cnt) > 0) return;

    const username = String(process.env.USAGI_ADMIN_USER || process.env.ADMIN_USER || 'admin').trim() || 'admin';
    const password = process.env.USAGI_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || process.env.GATEWAY_TOKEN || '';
    if (!password) {
      logger.warn('No admin password configured. Set USAGI_ADMIN_PASSWORD in .env before logging in.');
      return;
    }

    const existing = await get('SELECT * FROM users WHERE username=?', [username]);
    const passwordData = hashPassword(password);
    const ts = now();
    if (existing) {
      await run(
        "UPDATE users SET role='admin', permissions=?, active=1, pending=0, password_hash=?, password_salt=?, updated_at=? WHERE id=?",
        [JSON.stringify(ALL_MODULES), passwordData.hash, passwordData.salt, ts, existing.id]
      );
      return;
    }

    await run(
      `INSERT INTO users (username,display_name,role,permissions,password_hash,password_salt,active,pending,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [username, username, 'admin', JSON.stringify(ALL_MODULES), passwordData.hash, passwordData.salt, 1, 0, ts, ts]
    );
  }

  async function logOperation(input) {
    const auth = input.auth || {};
    const req = input.req || {};
    const metadata = sanitizeMeta(input.metadata || {}, 0);
    await run(
      `INSERT INTO operation_logs (user_id,username,role,module,action,target_type,target_id,summary,metadata,ip,user_agent,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        auth.id || 0,
        input.username || auth.username || '',
        input.role || auth.role || '',
        input.module || '',
        input.action || '',
        input.target_type || '',
        input.target_id === undefined || input.target_id === null ? '' : String(input.target_id),
        input.summary || '',
        JSON.stringify(metadata),
        input.ip || (req.headers ? requestIp(req) : ''),
        input.user_agent || (req.headers && req.headers['user-agent'] || ''),
        now()
      ]
    );
  }

  async function login(username, password, req) {
    const rawUsername = String(username || '').trim();
    logger.info('login attempt', { username: rawUsername });
    const user = rawUsername ? await get('SELECT * FROM users WHERE username=?', [rawUsername]) : null;
    logger.info('user from db', { user: user ? { id: user.id, username: user.username, active: user.active, is_on_job: user.is_on_job } : null });
    const fail = async function(reason) {
      logger.warn('login failed', { username: rawUsername, reason: reason });
      await logOperation({
        username: rawUsername,
        module: 'auth',
        action: 'login.failed',
        summary: rawUsername ? '登录失败：' + rawUsername : '登录失败：空用户名',
        metadata: { reason: reason },
        req: req
      });
      return { error: '用户名或密码错误' };
    };

    if (!user) return fail('user_not_found');
    if (Number(user.active) !== 1) return fail('user_not_active');
    if (Number(user.is_on_job) !== 1) return fail('user_off_job');
    if (Number(user.pending) === 1) return fail('user_pending');
    const passwordData = hashPassword(password, user.password_salt);
    if (passwordData.hash !== user.password_hash) return fail('password_mismatch');

    const token = crypto.randomBytes(32).toString('hex');
    const ts = now();
    await run(
      'INSERT INTO sessions (token_hash,user_id,created_at,expires_at,revoked_at) VALUES (?,?,?,?,0)',
      [sha256(token), user.id, ts, ts + SESSION_DAYS * 86400]
    );
    await run('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?', [ts, ts, user.id]);
    const freshUser = await get('SELECT * FROM users WHERE id=?', [user.id]);
    await logOperation({
      auth: publicUser(freshUser),
      module: 'auth',
      action: 'login.success',
      summary: '登录成功：' + freshUser.username,
      req: req
    });
    return { token: token, user: publicUser(freshUser) };
  }

  async function createSessionForUser(user, req, action, summary) {
    const token = crypto.randomBytes(32).toString('hex');
    const ts = now();
    await run(
      'INSERT INTO sessions (token_hash,user_id,created_at,expires_at,revoked_at) VALUES (?,?,?,?,0)',
      [sha256(token), user.id, ts, ts + SESSION_DAYS * 86400]
    );
    await run('UPDATE users SET last_login_at=?, updated_at=? WHERE id=?', [ts, ts, user.id]);
    const freshUser = await get('SELECT * FROM users WHERE id=?', [user.id]);
    await logOperation({
      auth: publicUser(freshUser),
      module: 'auth',
      action: action,
      summary: summary,
      req: req
    });
    return { token: token, user: publicUser(freshUser) };
  }

  async function callErpAuthApi(action, authToken) {
    if (!ERP_API_BASE) throw new Error('ERP 登录接口未配置');
    if (!authToken) throw new Error('缺少 ERP auth_token');
    const controller = new AbortController();
    const timer = setTimeout(function() { controller.abort(); }, ERP_REQUEST_TIMEOUT_MS);
    try {
      const url = new URL(ERP_API_BASE);
      url.searchParams.set('m', 'openexternapi');
      url.searchParams.set('a', action);
      url.searchParams.set('auth_token', authToken);
      const fetchOptions = { method: action === 'refreshtoken' ? 'POST' : 'GET', signal: controller.signal };
      if (ERP_FETCH_DISPATCHER) fetchOptions.dispatcher = ERP_FETCH_DISPATCHER;
      const response = await fetch(url.toString(), fetchOptions);
      const data = await response.json().catch(async function() {
        const text = await response.text().catch(function() { return ''; });
        throw new Error(text || 'ERP 登录接口返回异常');
      });
      if (!response.ok) throw new Error(data.msg || data.error || ('ERP HTTP ' + response.status));
      if (Number(data.code) !== 200) throw new Error(data.msg || data.error || 'ERP token 无效或已过期');
      return data;
    } catch(e) {
      if (e.name === 'AbortError') throw new Error('ERP 登录接口响应超时');
      if (e.cause && e.cause.code) throw new Error('无法连接 ERP 登录服务：' + e.cause.code);
      if (/fetch failed/i.test(e.message || '')) throw new Error('无法连接 ERP 登录服务');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function findUserForErp(erp) {
    const names = Array.from(new Set([erp.name, erp.user].filter(Boolean)));
    const uid = String(erp.uid || '');
    if (uid) {
      const byUid = await get('SELECT * FROM users WHERE erp_uid=?', [uid]);
      if (byUid) return byUid;
    }
    if (erp.user) {
      const byErpUser = await get('SELECT * FROM users WHERE erp_user=? OR username=?', [erp.user, erp.user]);
      if (byErpUser) return byErpUser;
    }
    for (const name of names) {
      const row = await get('SELECT * FROM users WHERE username=? OR real_name=? OR display_name=?', [name, name, name]);
      if (row) return row;
    }
    return null;
  }

  async function upsertErpUser(erp) {
    const ts = now();
    const username = erp.name || erp.user;
    if (!username) throw new Error('ERP 未返回用户姓名');
    const existing = await findUserForErp(erp);
    if (existing) {
      if (Number(existing.active) !== 1) throw new Error('当前账号已停用，请联系管理员');
      if (Number(existing.is_on_job) !== 1) throw new Error('当前账号已离职，无法登录');
      await run(
        `UPDATE users SET
          display_name=?,
          real_name=?,
          group_name=CASE WHEN trim(coalesce(group_name,''))='' THEN ? ELSE group_name END,
          erp_uid=?,
          erp_user=?,
          erp_deptname=?,
          erp_centername=?,
          pending=0,
          updated_at=?
         WHERE id=?`,
        [
          existing.display_name || erp.name || existing.username,
          existing.real_name || erp.name || existing.username,
          erp.deptname || '',
          erp.uid || '',
          erp.user || '',
          erp.deptname || '',
          erp.centername || '',
          ts,
          existing.id
        ]
      );
      return get('SELECT * FROM users WHERE id=?', [existing.id]);
    }

    const result = await run(
      `INSERT INTO users (
        username,display_name,real_name,group_name,employee_type,role,permissions,
        password_hash,password_salt,active,pending,is_on_job,erp_uid,erp_user,erp_deptname,erp_centername,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        username,
        erp.name || username,
        erp.name || username,
        erp.deptname || '',
        '正式员工',
        'member',
        JSON.stringify(DEFAULT_MEMBER_PERMISSIONS),
        '',
        '',
        1,
        0,
        1,
        erp.uid || '',
        erp.user || '',
        erp.deptname || '',
        erp.centername || '',
        ts,
        ts
      ]
    );
    return get('SELECT * FROM users WHERE id=?', [result.lastID]);
  }

  function decodeErpTokenCandidate(token) {
    const normalized = String(token || '').replace(/!/g, '+').replace(/\./g, '/').replace(/:/g, '=');
    try {
      return Buffer.from(normalized, 'base64').toString('utf8').trim();
    } catch(e) {
      return '';
    }
  }

  function buildErpTokenCandidates(input) {
    const rawList = Array.isArray(input) ? input : [input];
    const candidates = [];
    rawList.forEach(function(item) {
      const token = String(item || '').trim();
      if (!token) return;
      candidates.push(token);
      try {
        candidates.push(decodeURIComponent(token));
      } catch(e) {}
      const decoded = decodeErpTokenCandidate(token);
      if (decoded) candidates.push(decoded);
    });
    return Array.from(new Set(candidates.map(function(token) {
      return String(token || '').trim();
    }).filter(Boolean)));
  }

  async function erpLogin(authToken, req) {
    const tokens = buildErpTokenCandidates(authToken);
    if (!tokens.length) throw new Error('缺少 ERP auth_token');
    let info = null;
    let lastError = null;
    for (const token of tokens) {
      try {
        info = normalizeErpUserInfo(await callErpAuthApi('getuserinfo', token));
        break;
      } catch(e) {
        lastError = e;
      }
    }
    if (!info) throw lastError || new Error('ERP token 无效或已过期');
    const user = await upsertErpUser(info);
    const result = await createSessionForUser(user, req, 'erp_login.success', 'ERP 登录成功：' + (user.username || info.name || info.user));
    return Object.assign({}, result, {
      erp: {
        uid: info.uid,
        name: info.name,
        user: info.user,
        deptname: info.deptname,
        centername: info.centername
      },
      session_days: SESSION_DAYS
    });
  }

  async function register(data, req) {
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    const groupName = String(data.group_name || '').trim();
    const realName = String(data.real_name || username).trim();
    const employeeType = VALID_EMPLOYEE_TYPES.includes(data.employee_type) ? data.employee_type : '正式员工';

    const fail = async function(reason, message) {
      await logOperation({
        username: username,
        module: 'auth',
        action: 'register.failed',
        summary: username ? '注册失败：' + username : '注册失败：空用户名',
        metadata: { reason: reason },
        req: req
      });
      return { error: message || '注册失败' };
    };

    if (!CHINESE_REAL_NAME.test(username)) return fail('invalid_username', '账号名必须使用 2-20 个中文字符的真名');
    if (!CHINESE_REAL_NAME.test(realName)) return fail('invalid_real_name', '真名必须使用 2-20 个中文字符');
    if (password.length < 6) return fail('password_too_short', '密码至少 6 位');
    if (groupName && !VALID_GROUPS.includes(groupName)) return fail('invalid_group', '组别无效');

    // Check existing user
    const existing = await get('SELECT * FROM users WHERE username=?', [username]);

    // Case 1: Pending user exists - activate them
    if (existing && Number(existing.pending) === 1) {
      if (Number(existing.is_on_job) !== 1) return fail('user_off_job', '该员工已离职，无法注册');
      const passwordData = hashPassword(password);
      const ts = now();
      await run(
        `UPDATE users SET password_hash=?, password_salt=?, real_name=?, group_name=?, employee_type=?, pending=0, active=1, updated_at=? WHERE id=?`,
        [passwordData.hash, passwordData.salt, realName, groupName, employeeType, ts, existing.id]
      );
      const user = await get('SELECT * FROM users WHERE id=?', [existing.id]);
      return createSessionForUser(user, req, 'register.success', '注册成功：' + username);
    }

    // Case 2: User already exists and activated
    if (existing) return fail('username_exists', '用户名已存在，请直接登录');

    // Case 3: New user registration - keep it pending until an admin enables it.
    const passwordData = hashPassword(password);
    const ts = now();
    try {
      const result = await run(
        `INSERT INTO users (username,display_name,real_name,group_name,employee_type,role,permissions,password_hash,password_salt,active,pending,is_on_job,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [username, username, realName, groupName, employeeType, 'member', JSON.stringify(DEFAULT_MEMBER_PERMISSIONS), passwordData.hash, passwordData.salt, 0, 1, 1, ts, ts]
      );
      return { success: true, message: '注册成功，请等待管理员激活账号：' + username };
    } catch(e) {
      if (/UNIQUE/i.test(e.message)) return fail('username_exists', '用户名已存在');
      return fail('db_error', e.message);
    }
  }

  async function authenticate(token) {
    if (!token) return null;
    const row = await get(
      `SELECT sessions.id AS session_id, sessions.expires_at, users.*
       FROM sessions JOIN users ON users.id=sessions.user_id
       WHERE sessions.token_hash=? AND sessions.revoked_at=0`,
      [sha256(token)]
    );
    if (!row || Number(row.active) !== 1 || Number(row.pending) === 1 || Number(row.expires_at) <= now()) return null;
    const user = publicUser(row);
    user.session_id = row.session_id;
    return user;
  }

  async function logout(token, auth, req) {
    if (!token) return { ok: true };
    const result = await run('UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at=0', [now(), sha256(token)]);
    if (auth && result.changes) {
      await logOperation({
        auth: auth,
        module: 'auth',
        action: 'logout',
        summary: '退出登录：' + auth.username,
        req: req
      });
    }
    return { ok: true };
  }

  async function listUsers() {
    const rows = await all('SELECT * FROM users ORDER BY role ASC, username ASC');
    return rows.map(publicUser);
  }

  async function createUser(data) {
    const username = String(data.username || '').trim();
    const password = String(data.password || '');
    if (!username || !password) return { error: 'username and password required' };
    if (password.length < 6) return { error: '密码至少 6 位' };
    const role = data.role === 'admin' ? 'admin' : 'member';
    const permissions = rolePermissions(role, data.permissions || DEFAULT_MEMBER_PERMISSIONS);
    const passwordData = hashPassword(password);
    const ts = now();
    try {
      const result = await run(
        `INSERT INTO users (username,display_name,real_name,group_name,employee_type,role,permissions,password_hash,password_salt,active,pending,is_on_job,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          username,
          String(data.display_name || username).trim() || username,
          String(data.real_name || data.display_name || username).trim() || username,
          String(data.group_name || '').trim(),
          VALID_EMPLOYEE_TYPES.includes(data.employee_type) ? data.employee_type : '正式员工',
          role,
          JSON.stringify(permissions),
          passwordData.hash,
          passwordData.salt,
          data.active === false ? 0 : 1,
          0,
          data.is_on_job === false ? 0 : 1,
          ts,
          ts
        ]
      );
      return { user: publicUser(await get('SELECT * FROM users WHERE id=?', [result.lastID])) };
    } catch(e) {
      if (/UNIQUE/i.test(e.message)) return { error: '用户名已存在' };
      return { error: e.message };
    }
  }

  async function activeAdminCount(exceptUserId, nextRole, nextActive) {
    const rows = await all("SELECT id FROM users WHERE role='admin' AND active=1");
    return rows.filter(row => {
      if (Number(row.id) !== Number(exceptUserId)) return true;
      return nextRole === 'admin' && Number(nextActive) === 1;
    }).length;
  }

  async function updateUser(data) {
    const id = Number(data.id);
    if (!id) return { error: 'id required' };
    const current = await get('SELECT * FROM users WHERE id=?', [id]);
    if (!current) return { error: 'user not found' };

    const role = data.role === 'admin' ? 'admin' : 'member';
    const active = data.active === false || data.active === 0 ? 0 : 1;
    const is_on_job = data.is_on_job === false || data.is_on_job === 0 ? 0 : 1;
    const actorId = Number(data._auth && data._auth.id) || 0;
    if (actorId && actorId === id) {
      if (role !== 'admin') return { error: '不能将当前登录的管理员改为成员' };
      if (active !== 1) return { error: '不能停用当前登录账号' };
    }
    if (current.role === 'admin' && (role !== 'admin' || active !== 1)) {
      const remaining = await activeAdminCount(id, role, active);
      if (remaining <= 0) return { error: '至少保留一个启用的管理员' };
    }

    const pending = active === 1 ? 0 : (data.is_pending === true || data.pending === true || Number(current.pending) === 1 ? 1 : 0);
    const permissions = rolePermissions(role, data.permissions || []);
    const ts = now();
    await run(
      'UPDATE users SET display_name=?, group_name=?, employee_type=?, is_on_job=?, role=?, permissions=?, active=?, pending=?, updated_at=? WHERE id=?',
      [
        String(data.display_name || current.username).trim() || current.username,
        String(data.group_name || '').trim(),
        VALID_EMPLOYEE_TYPES.includes(data.employee_type) ? data.employee_type : '正式员工',
        is_on_job,
        role,
        JSON.stringify(permissions),
        active,
        pending,
        ts,
        id
      ]
    );
    if (active !== 1) await run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at=0', [ts, id]);
    return { user: publicUser(await get('SELECT * FROM users WHERE id=?', [id])) };
  }

  async function deleteUser(data) {
    const id = Number(data.id);
    if (!id) return { error: 'id required' };
    const current = await get('SELECT * FROM users WHERE id=?', [id]);
    if (!current) return { error: 'user not found' };
    const actorId = Number(data._auth && data._auth.id) || 0;
    if (actorId && actorId === id) return { error: '不能删除当前登录账号' };
    if (current.role === 'admin') {
      const remaining = await activeAdminCount(id, 'member', 0);
      if (remaining <= 0) return { error: '至少保留一个启用的管理员' };
    }
    await run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at=0', [now(), id]);
    await run('DELETE FROM users WHERE id=?', [id]);
    return { ok: true, deleted: id, username: current.username };
  }

  async function resetPassword(data) {
    const id = Number(data.id);
    const password = String(data.password || '');
    if (!id || !password) return { error: 'id and password required' };
    if (password.length < 6) return { error: '密码至少 6 位' };
    const current = await get('SELECT * FROM users WHERE id=?', [id]);
    if (!current) return { error: 'user not found' };
    const passwordData = hashPassword(password);
    const ts = now();
    await run('UPDATE users SET password_hash=?, password_salt=?, updated_at=? WHERE id=?', [passwordData.hash, passwordData.salt, ts, id]);
    await run('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at=0', [ts, id]);
    return { ok: true };
  }

  async function listLogs(filters) {
    const where = [];
    const params = [];
    if (filters.user_id) { where.push('user_id=?'); params.push(Number(filters.user_id)); }
    if (filters.username) { where.push('username LIKE ?'); params.push('%' + escapeLike(filters.username) + '%'); }
    if (filters.module) { where.push('module=?'); params.push(String(filters.module)); }
    if (filters.action) { where.push('action LIKE ?'); params.push('%' + escapeLike(filters.action) + '%'); }
    if (filters.keyword) {
      const keyword = '%' + escapeLike(filters.keyword) + '%';
      where.push('(summary LIKE ? OR target_id LIKE ? OR metadata LIKE ?)');
      params.push(keyword, keyword, keyword);
    }
    if (filters.importantOnly) {
      where.push("action NOT LIKE 'api.%'");
      where.push("action <> 'schedule.save'");
    }
    if (filters.from) { where.push('created_at>=?'); params.push(Number(filters.from)); }
    if (filters.to) { where.push('created_at<=?'); params.push(Number(filters.to)); }
    const limit = Math.max(1, Math.min(200, Number(filters.limit) || 50));
    const offset = Math.max(0, Number(filters.offset) || 0);
    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const countRow = await get('SELECT COUNT(*) AS cnt FROM operation_logs' + whereSql, params);
    const rows = await all(
      `SELECT * FROM operation_logs${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      params.concat([limit, offset])
    );
    return {
      total: Number(countRow && countRow.cnt) || 0,
      logs: rows.map(row => Object.assign({}, row, { metadata: safeParseMeta(row.metadata) }))
    };
  }

  function canAccess(user, moduleId) {
    if (!user) return false;
    if (!moduleId) return false;
    if (isAdminLike(user)) return true;
    if (moduleId === 'auth') return true;
    if (moduleId === 'accountmonitor' && parsePermissions(user.permissions).indexOf('dailyhot') >= 0) return true;

    if (moduleId === 'ops' || moduleId === 'commentReply') {
      const title = user.title || '';
      return title === '部长' || title === '组长' || parsePermissions(user.permissions).indexOf(moduleId) >= 0;
    }

    if (['adminUsers', 'operationLogs'].includes(moduleId)) {
      const title = user.title || '';
      return title === '部长' || title === '组长';
    }

    if (ADMIN_ONLY_MODULES.indexOf(moduleId) >= 0) return false;
    if (DEFAULT_MEMBER_PERMISSIONS.indexOf(moduleId) >= 0) return true;
    return parsePermissions(user.permissions).indexOf(moduleId) >= 0;
  }

  return {
    ALL_MODULES,
    DEFAULT_MEMBER_PERMISSIONS,
    ADMIN_ONLY_MODULES,
    authenticate,
    canAccess,
    createUser,
    deleteUser,
    erpLogin,
    init,
    listLogs,
    listUsers,
    logOperation,
    login,
    logout,
    register,
    resetPassword,
    sanitizeMeta,
    updateUser
  };
}

module.exports = createAuthStore;
