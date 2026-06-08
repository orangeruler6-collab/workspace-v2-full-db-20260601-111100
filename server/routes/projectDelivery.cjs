const fs = require('fs');
const path = require('path');
const createLogger = require('../lib/logger.cjs');
const createSqliteAdapter = require('../lib/sqlite.cjs');

const logger = createLogger('routes:projectDelivery');

function now() {
  return Math.floor(Date.now() / 1000);
}

function cleanText(value, max) {
  const text = String(value || '').replace(/\r/g, '\n').trim();
  return max ? Array.from(text).slice(0, max).join('') : text;
}

function cleanDate(value) {
  const text = cleanText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function toInt(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
}

function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || '');
    return parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function jsonValue(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function run(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID || 0, changes: this.changes || 0 });
    });
  });
}

function all(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], function(err, rows) {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function get(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], function(err, row) {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function addDays(dateText, offset) {
  const date = new Date(dateText + 'T00:00:00');
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function dateRange(startDate, endDate) {
  const start = cleanDate(startDate) || new Date().toISOString().slice(0, 10);
  const end = cleanDate(endDate) || start;
  const days = [];
  for (let i = 0; i < 370; i += 1) {
    const day = addDays(start, i);
    days.push(day);
    if (day >= end) break;
  }
  return days;
}

function normalizeStatus(value) {
  const status = cleanText(value, 40);
  if (['planned', 'material_bound', 'ready', 'published', 'blocked', 'failed', 'cancelled'].includes(status)) return status;
  return 'planned';
}

function normalizeProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || '',
    owner: row.owner || '',
    description: row.description || '',
    status: row.status || 'active',
    start_date: row.start_date || '',
    end_date: row.end_date || '',
    total_plan: Number(row.total_plan) || 0,
    created_at: row.created_at || 0,
    updated_at: row.updated_at || 0
  };
}

function normalizeTask(row) {
  const material = row.material_id ? {
    id: row.material_id,
    original: row.material_original || '',
    filename: row.material_filename || '',
    folder: row.material_folder || '/',
    type: row.material_type || ''
  } : null;
  return {
    id: row.id,
    project_id: row.project_id,
    group_name: row.group_name || '',
    owner: row.owner || '',
    plan_date: row.plan_date || '',
    title: row.title || '',
    status: row.status || 'planned',
    material_id: row.material_id || 0,
    material_count: Number(row.material_count) || (row.material_id ? 1 : 0),
    material,
    publish_job_id: row.publish_job_id || 0,
    publish_status: row.publish_status || '',
    work_url: row.work_url || '',
    latest_views: Number(row.latest_views) || 0,
    latest_views_at: row.latest_views_at || 0,
    error: row.error || '',
    note: row.note || '',
    created_at: row.created_at || 0,
    updated_at: row.updated_at || 0
  };
}

function summarize(project, tasks) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map();
  const dates = new Map();
  let materialBound = 0;
  let published = 0;
  let blocked = 0;
  let ready = 0;
  let latestViews = 0;

  tasks.forEach(task => {
    const hasMaterial = Boolean(task.material_id || task.material_count);
    const isPublished = task.status === 'published' || task.publish_status === 'published';
    const isBlocked = task.status === 'blocked' || task.status === 'failed' || task.publish_status === 'failed';
    if (hasMaterial) materialBound += 1;
    if (isPublished) published += 1;
    if (isBlocked) blocked += 1;
    if (hasMaterial && !isPublished && !isBlocked) ready += 1;
    latestViews += Number(task.latest_views) || 0;

    const groupName = task.group_name || '未分组';
    if (!groups.has(groupName)) {
      groups.set(groupName, { group_name: groupName, plan: 0, material_bound: 0, ready: 0, published: 0, blocked: 0, today_plan: 0, today_done: 0, gap: 0 });
    }
    const group = groups.get(groupName);
    group.plan += 1;
    if (hasMaterial) group.material_bound += 1;
    if (hasMaterial && !isPublished && !isBlocked) group.ready += 1;
    if (isPublished) group.published += 1;
    if (isBlocked) group.blocked += 1;
    if (task.plan_date === today) {
      group.today_plan += 1;
      if (hasMaterial || isPublished) group.today_done += 1;
    }
    group.gap = Math.max(0, group.today_plan - group.today_done);

    const day = task.plan_date || '未排期';
    if (!dates.has(day)) dates.set(day, { date: day, plan: 0, material_bound: 0, published: 0, groups: {} });
    const dateRow = dates.get(day);
    dateRow.plan += 1;
    if (hasMaterial) dateRow.material_bound += 1;
    if (isPublished) dateRow.published += 1;
    if (!dateRow.groups[groupName]) dateRow.groups[groupName] = { group_name: groupName, plan: 0, material_bound: 0, published: 0 };
    dateRow.groups[groupName].plan += 1;
    if (hasMaterial) dateRow.groups[groupName].material_bound += 1;
    if (isPublished) dateRow.groups[groupName].published += 1;
  });

  const total = tasks.length || Number(project && project.total_plan) || 0;
  return {
    total_plan: total,
    material_bound: materialBound,
    pending: Math.max(0, total - materialBound - blocked),
    ready,
    published,
    blocked,
    completion_rate: total ? Math.round((published / total) * 1000) / 10 : 0,
    latest_views: latestViews,
    group_progress: Array.from(groups.values()).sort((a, b) => a.group_name.localeCompare(b.group_name, 'zh-Hans-CN')),
    date_progress: Array.from(dates.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)))
  };
}

module.exports = function createProjectDeliveryRoutes(deps) {
  const root = deps.root;
  const dataDir = path.join(root, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'project_delivery.db');
  const adapter = createSqliteAdapter({ dbPath, logger });

  function getDb() {
    return adapter.createDb();
  }

  const schemaStatements = [
    `CREATE TABLE IF NOT EXISTS project_delivery_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner TEXT DEFAULT '',
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      total_plan INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS project_delivery_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      group_name TEXT DEFAULT '',
      owner TEXT DEFAULT '',
      plan_date TEXT DEFAULT '',
      title TEXT DEFAULT '',
      status TEXT DEFAULT 'planned',
      material_id INTEGER DEFAULT 0,
      publish_job_id INTEGER DEFAULT 0,
      publish_status TEXT DEFAULT '',
      work_url TEXT DEFAULT '',
      latest_views INTEGER DEFAULT 0,
      latest_views_at INTEGER DEFAULT 0,
      error TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS project_delivery_task_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      task_id INTEGER DEFAULT 0,
      material_id INTEGER NOT NULL,
      created_at INTEGER DEFAULT 0,
      UNIQUE(project_id, task_id, material_id)
    )`,
    `CREATE TABLE IF NOT EXISTS project_delivery_metric_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      task_id INTEGER NOT NULL,
      platform TEXT DEFAULT 'douyin',
      url TEXT DEFAULT '',
      views INTEGER DEFAULT 0,
      fetched_at INTEGER DEFAULT 0,
      source TEXT DEFAULT '',
      raw_json TEXT DEFAULT '{}'
    )`
  ];

  let schemaReady = null;
  function ensureSchema() {
    if (!schemaReady) {
      const db = getDb();
      schemaReady = (async () => {
        for (const statement of schemaStatements) {
          await run(db, statement, []);
        }
      })();
    }
    return schemaReady;
  }

  async function listProjects(db) {
    const rows = await all(db, 'SELECT * FROM project_delivery_projects ORDER BY updated_at DESC, id DESC', []);
    return rows.map(normalizeProject);
  }

  async function listTasks(db, projectId) {
    const rows = await all(db, `
      SELECT t.*,
        m.original AS material_original,
        m.filename AS material_filename,
        m.folder AS material_folder,
        m.type AS material_type,
        (SELECT COUNT(*) FROM project_delivery_task_materials tm WHERE tm.task_id=t.id) AS material_count
      FROM project_delivery_tasks t
      LEFT JOIN materials m ON m.id=t.material_id
      WHERE t.project_id=?
      ORDER BY t.plan_date ASC, t.group_name ASC, t.id ASC
    `, [projectId]);
    return rows.map(normalizeTask);
  }

  async function ensureProject(db, body) {
    const id = toInt(body.project_id || body.id);
    const ts = now();
    if (id) {
      const existing = await get(db, 'SELECT * FROM project_delivery_projects WHERE id=?', [id]);
      if (!existing) throw new Error('project not found');
      return normalizeProject(existing);
    }
    const name = cleanText(body.name || body.project_name || '逆水寒素材代做', 120);
    const result = await run(db, `INSERT INTO project_delivery_projects
      (name,owner,description,status,start_date,end_date,total_plan,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, [
      name,
      cleanText(body.owner, 80),
      cleanText(body.description, 1000),
      cleanText(body.status || 'active', 40),
      cleanDate(body.start_date),
      cleanDate(body.end_date),
      toInt(body.total_plan),
      ts,
      ts
    ]);
    const row = await get(db, 'SELECT * FROM project_delivery_projects WHERE id=?', [result.lastID]);
    return normalizeProject(row);
  }

  function attachMaterialsDb(db) {
    const materialsDbPath = path.join(dataDir, 'materials.db').replace(/\\/g, '/');
    return run(db, "ATTACH DATABASE ? AS materials_db", [materialsDbPath])
      .catch(() => null)
      .then(() => run(db, `CREATE TABLE IF NOT EXISTS materials_db.materials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT DEFAULT '',
        original TEXT DEFAULT '',
        folder TEXT DEFAULT '/',
        type TEXT DEFAULT 'video'
      )`, []).catch(() => null));
  }

  return {
    '/api/project-delivery/projects': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        if (body.save || body.name || body.project_name) {
          const id = toInt(body.id || body.project_id);
          const ts = now();
          if (id) {
            await run(db, `UPDATE project_delivery_projects SET
              name=COALESCE(NULLIF(?, ''), name),
              owner=?,
              description=?,
              status=?,
              start_date=?,
              end_date=?,
              total_plan=?,
              updated_at=?
              WHERE id=?`, [
              cleanText(body.name || body.project_name, 120),
              cleanText(body.owner, 80),
              cleanText(body.description, 1000),
              cleanText(body.status || 'active', 40),
              cleanDate(body.start_date),
              cleanDate(body.end_date),
              toInt(body.total_plan),
              ts,
              id
            ]);
          } else {
            await ensureProject(db, body);
          }
        }
        cb({ ok: true, projects: await listProjects(db) });
      })().catch(err => cb({ error: err.message }));
    },

    '/api/project-delivery/dashboard': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        const projects = await listProjects(db);
        const projectId = toInt(body.project_id) || (projects[0] && projects[0].id) || 0;
        const project = projects.find(item => item.id === projectId) || null;
        let tasks = [];
        if (projectId) {
          await attachMaterialsDb(db);
          const rows = await all(db, `
            SELECT t.*,
              m.original AS material_original,
              m.filename AS material_filename,
              m.folder AS material_folder,
              m.type AS material_type,
              (SELECT COUNT(*) FROM project_delivery_task_materials tm WHERE tm.task_id=t.id) AS material_count
            FROM project_delivery_tasks t
            LEFT JOIN materials_db.materials m ON m.id=t.material_id
            WHERE t.project_id=?
            ORDER BY t.plan_date ASC, t.group_name ASC, t.id ASC
          `, [projectId]);
          tasks = rows.map(normalizeTask);
        }
        cb({ ok: true, projects, project, tasks, summary: summarize(project, tasks) });
      })().catch(err => cb({ error: err.message }));
    },

    '/api/project-delivery/plan/generate': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        const project = await ensureProject(db, body);
        const groups = Array.isArray(body.groups) && body.groups.length
          ? body.groups.map(item => cleanText(item, 80)).filter(Boolean)
          : ['内容一组', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组'];
        const days = dateRange(body.start_date || project.start_date, body.end_date || project.end_date);
        const perGroupPerDay = Math.max(1, Math.min(100, toInt(body.daily_count || body.per_group_daily_count || 1)));
        const totalTarget = toInt(body.total_count || body.total_plan);
        const ownerMap = body.owners && typeof body.owners === 'object' ? body.owners : {};
        const titlePrefix = cleanText(body.title_prefix || project.name, 120);
        const ts = now();
        let created = 0;
        for (const day of days) {
          for (const groupName of groups) {
            for (let i = 0; i < perGroupPerDay; i += 1) {
              if (totalTarget && created >= totalTarget) break;
              await run(db, `INSERT INTO project_delivery_tasks
                (project_id,group_name,owner,plan_date,title,status,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?)`, [
                project.id,
                groupName,
                cleanText(ownerMap[groupName] || body.owner || '', 80),
                day,
                titlePrefix + ' #' + String(created + 1).padStart(3, '0'),
                'planned',
                ts,
                ts
              ]);
              created += 1;
            }
            if (totalTarget && created >= totalTarget) break;
          }
          if (totalTarget && created >= totalTarget) break;
        }
        await run(db, 'UPDATE project_delivery_projects SET start_date=?, end_date=?, total_plan=?, updated_at=? WHERE id=?', [
          days[0] || project.start_date,
          days[days.length - 1] || project.end_date,
          totalTarget || created,
          ts,
          project.id
        ]);
        cb({ ok: true, project_id: project.id, created });
      })().catch(err => cb({ error: err.message }));
    },

    '/api/project-delivery/tasks/update': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        const id = toInt(body.id || body.task_id);
        if (!id) throw new Error('missing task id');
        const fields = [];
        const args = [];
        [
          ['group_name', 80],
          ['owner', 80],
          ['plan_date', 20],
          ['title', 160],
          ['publish_status', 40],
          ['work_url', 500],
          ['error', 1000],
          ['note', 1000]
        ].forEach(([key, max]) => {
          if (body[key] !== undefined) {
            fields.push(key + '=?');
            args.push(key === 'plan_date' ? cleanDate(body[key]) : cleanText(body[key], max));
          }
        });
        if (body.status !== undefined) { fields.push('status=?'); args.push(normalizeStatus(body.status)); }
        if (body.material_id !== undefined) { fields.push('material_id=?'); args.push(toInt(body.material_id)); }
        if (body.publish_job_id !== undefined) { fields.push('publish_job_id=?'); args.push(toInt(body.publish_job_id)); }
        if (body.latest_views !== undefined) {
          fields.push('latest_views=?');
          fields.push('latest_views_at=?');
          args.push(toInt(body.latest_views), now());
        }
        if (!fields.length) throw new Error('no fields to update');
        fields.push('updated_at=?');
        args.push(now(), id);
        await run(db, 'UPDATE project_delivery_tasks SET ' + fields.join(',') + ' WHERE id=?', args);
        cb({ ok: true });
      })().catch(err => cb({ error: err.message }));
    },

    '/api/project-delivery/tasks/link-materials': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        const projectId = toInt(body.project_id);
        const taskId = toInt(body.task_id);
        const materialIds = (Array.isArray(body.material_ids) ? body.material_ids : [body.material_id]).map(toInt).filter(Boolean);
        if (!projectId) throw new Error('missing project id');
        if (!materialIds.length) throw new Error('missing material ids');
        const ts = now();
        for (const materialId of materialIds) {
          await run(db, `INSERT OR IGNORE INTO project_delivery_task_materials
            (project_id,task_id,material_id,created_at) VALUES (?,?,?,?)`, [projectId, taskId, materialId, ts]);
        }
        if (taskId && materialIds[0]) {
          await run(db, 'UPDATE project_delivery_tasks SET material_id=?, status=?, updated_at=? WHERE id=? AND project_id=?', [
            materialIds[0],
            'material_bound',
            ts,
            taskId,
            projectId
          ]);
        }
        cb({ ok: true, linked: materialIds.length });
      })().catch(err => cb({ error: err.message }));
    },

    '/api/project-delivery/metrics/refresh': function(body, cb) {
      const db = getDb();
      (async () => {
        await ensureSchema();
        const taskId = toInt(body.task_id);
        const projectId = toInt(body.project_id);
        if (!taskId || !projectId) throw new Error('missing project/task id');
        const views = toInt(body.latest_views);
        const url = cleanText(body.work_url || body.url, 500);
        if (!views && !body.force_opencli) {
          cb({ ok: false, error: '第一版播放量刷新先支持手动最新值；OpenCLI 抖音后台回填入口已预留', project_id: projectId, task_id: taskId });
          return;
        }
        const ts = now();
        await run(db, 'UPDATE project_delivery_tasks SET latest_views=?, latest_views_at=?, work_url=COALESCE(NULLIF(?, ""), work_url), updated_at=? WHERE id=? AND project_id=?', [
          views,
          ts,
          url,
          ts,
          taskId,
          projectId
        ]);
        await run(db, `INSERT INTO project_delivery_metric_snapshots
          (project_id,task_id,platform,url,views,fetched_at,source,raw_json)
          VALUES (?,?,?,?,?,?,?,?)`, [
          projectId,
          taskId,
          cleanText(body.platform || 'douyin', 40),
          url,
          views,
          ts,
          cleanText(body.source || 'manual', 40),
          jsonValue(body.raw || {})
        ]);
        cb({ ok: true, project_id: projectId, task_id: taskId, latest_views: views, latest_views_at: ts });
      })().catch(err => cb({ error: err.message }));
    },

    _dbPath: dbPath
  };
};
