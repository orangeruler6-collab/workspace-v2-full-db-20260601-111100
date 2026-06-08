const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

function applyScheduleCollaborativePreset() {
  return null;
}

module.exports = function createScheduleRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dbPath = path.join(root, 'data', 'schedule.db');
  const uploadDir = path.join(root, 'public', 'uploads', 'schedule-docs');
  const scheduleGroups = [
    { label: '内容一组', members: ['许树杰', '许梦婷', '刘登魁', '许国锬', '叶进生', '高明镇', '薛荐轩', '叶颖'], accounts: ['花无缺', '葵仔不想肝', '最翁说游', '薛定谔的机', '跑腿的包子', '李野王SG', '游电工厂', '硬件侠', '素材'] },
    { label: '内容二组', members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'], accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '灵梦小师妹', '网瘾少女一条', '素材'] },
    { label: '内容三组', members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'], accounts: ['苏大强', '中二探长', '团子好贵', '嘿小虎', '素材', '饭十七', '皮皮说游戏'] },
    { label: '内容四组', members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'], accounts: ['天机妹', '花蛮楼', '麦晓花', '夏天丶Cat', '有事找学姐', '小张同学', '素材'] },
    { label: '内容五组', members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'], accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '尼大木', '麦冬冬', '素材'] },
    { label: '内容六组', members: ['廖李星', '吴皓轩', '林孝添', '林语婷', '张碧珊', '叶子健'], accounts: ['不玩就分手', '游点慌', '游戏永动机', '畅玩百晓生', '夏洛', '游侠蹦蹦', '王路飞cp', '上官北丶', '情风师兄', '素材'] }
  ];
  const validGroupNames = new Set(scheduleGroups.map(group => group.label));
  const accountToGroups = scheduleGroups.reduce(function(map, group) {
    group.accounts.forEach(function(account) {
      if (!map[account]) map[account] = [];
      map[account].push(group.label);
    });
    return map;
  }, {});

  let db = null;
  function getDb() {
    if (!db) {
      db = new sqlite3.Database(dbPath);
      db.run(`
        CREATE TABLE IF NOT EXISTS schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account TEXT,
          person TEXT,
          group_name TEXT DEFAULT '',
          type TEXT DEFAULT '日常',
          content TEXT,
          remark TEXT DEFAULT '',
          date TEXT,
          status TEXT DEFAULT 'pending',
          progress TEXT DEFAULT '',
          workflow_stage TEXT DEFAULT '文案',
          participants_json TEXT DEFAULT '[]',
          sort_order INTEGER DEFAULT 0,
          parallel_key TEXT DEFAULT '',
          schedule_hidden INTEGER DEFAULT 0,
          linked_parent_id INTEGER DEFAULT NULL,
          doc_title TEXT DEFAULT '',
          doc_url TEXT DEFAULT '',
          doc_kind TEXT DEFAULT '',
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      ensureScheduleColumns();
      db.run(`
        CREATE TABLE IF NOT EXISTS schedule_notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT DEFAULT 'handoff',
          receiver_name TEXT NOT NULL,
          sender_name TEXT DEFAULT '',
          title TEXT DEFAULT '',
          message TEXT DEFAULT '',
          task_content TEXT DEFAULT '',
          task_account TEXT DEFAULT '',
          payload TEXT DEFAULT '{}',
          read_at INTEGER DEFAULT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
    }
    return db;
  }

  function userNames(auth) {
    const names = [];
    if (auth && auth.display_name) names.push(String(auth.display_name));
    if (auth && auth.username) names.push(String(auth.username));
    return Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
  }

  function ensureScheduleColumns() {
    const database = db;
    database.serialize(function() {
      ['group_name', 'doc_title', 'doc_url', 'doc_kind', 'workflow_stage', 'participants_json'].forEach(function(column) {
        database.run("ALTER TABLE schedules ADD COLUMN " + column + " TEXT DEFAULT ''", function() {});
      });
      database.run("ALTER TABLE schedules ADD COLUMN sort_order INTEGER DEFAULT 0", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN parallel_key TEXT DEFAULT ''", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN schedule_hidden INTEGER DEFAULT 0", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN linked_parent_id INTEGER DEFAULT NULL", function() {});
    });
  }

  function isScheduleAdmin(auth) {
    if (!auth) return false;
    if (auth.role === 'admin') return true;
    const title = String(auth.title || '').trim();
    return title === '部长' || title === '组长';
  }

  function groupByMember(name) {
    const normalized = String(name || '').trim();
    if (!normalized) return null;
    return scheduleGroups.find(function(group) {
      return group.members.includes(normalized);
    }) || null;
  }

  function inferGroupName(task, fallbackGroup) {
    const explicit = String(task && task.group_name || '').trim();
    if (validGroupNames.has(explicit)) return explicit;

    const memberGroup = groupByMember(task && task.person);
    if (memberGroup) return memberGroup.label;

    const account = String(task && task.account || '').trim();
    const accountGroups = accountToGroups[account] || [];
    if (accountGroups.length === 1) return accountGroups[0];

    const fallback = String(fallbackGroup || '').trim();
    return validGroupNames.has(fallback) ? fallback : '';
  }

  function authGroupName(auth) {
    const explicit = String(auth && auth.group_name || '').trim();
    if (validGroupNames.has(explicit)) return explicit;

    const names = userNames(auth);
    for (let i = 0; i < names.length; i++) {
      const group = groupByMember(names[i]);
      if (group) return group.label;
    }
    return '';
  }

  function allowedGroupNames(auth) {
    if (isScheduleAdmin(auth)) return scheduleGroups.map(group => group.label);
    const groupName = authGroupName(auth);
    return groupName ? [groupName] : [];
  }

  function normalizeTask(task, fallbackGroup) {
    const participantsJson = String(task && task.participants_json || '').trim();
    const workflowStage = String(task && task.workflow_stage || '').trim();
    const normalized = Object.assign({}, task, {
      group_name: inferGroupName(task, fallbackGroup),
      sort_order: Number.isFinite(Number(task && task.sort_order)) ? Number(task.sort_order) : 0,
      parallel_key: String(task && task.parallel_key || ''),
      workflow_stage: workflowStage,
      participants_json: participantsJson || '[]',
      schedule_hidden: Number(task && task.schedule_hidden) ? 1 : 0,
      linked_parent_id: Number.isFinite(Number(task && task.linked_parent_id)) ? Number(task.linked_parent_id) : null
    });
    if (!participantsJson || participantsJson === '[]') {
      const collab = applyScheduleCollaborativePreset(normalized, scheduleGroups);
      if (collab && Array.isArray(collab.participants) && collab.participants.length) {
        normalized.workflow_stage = collab.workflow_stage || normalized.workflow_stage;
        normalized.participants_json = JSON.stringify(collab.participants);
        normalized.person = collab.participants[0].person || normalized.person;
      }
    }
    return normalized;
  }

  function filterVisibleTasks(tasks, auth) {
    if (isScheduleAdmin(auth)) return tasks;
    const allowed = new Set(allowedGroupNames(auth));
    return tasks.filter(function(task) {
      return !task.schedule_hidden && allowed.has(task.group_name);
    });
  }

  function updateMissingGroupNames(database, tasks) {
    const missing = tasks.filter(function(task) {
      return task.id && !task.group_name;
    });
    if (!missing.length) return;
    const stmt = database.prepare(
      "UPDATE schedules SET group_name = ? WHERE id = ? AND (group_name IS NULL OR group_name = '')"
    );
    missing.forEach(function(task) {
      stmt.run([task.group_name, task.id]);
    });
    stmt.finalize(function() {});
  }

  function buildScopedDelete(auth, groups) {
    const groupPlaceholders = groups.map(() => '?').join(',');
    const sqlParts = ["group_name IN (" + groupPlaceholders + ")"];
    const params = groups.slice();
    const allowedMembers = [];
    const allowedUniqueAccounts = [];

    scheduleGroups
      .filter(group => groups.includes(group.label))
      .forEach(function(group) {
        allowedMembers.push.apply(allowedMembers, group.members);
        group.accounts.forEach(function(account) {
          if ((accountToGroups[account] || []).length === 1) allowedUniqueAccounts.push(account);
        });
      });

    if (allowedMembers.length) {
      sqlParts.push("((group_name IS NULL OR group_name = '') AND person IN (" + allowedMembers.map(() => '?').join(',') + "))");
      params.push.apply(params, allowedMembers);
    }
    if (allowedUniqueAccounts.length) {
      sqlParts.push("((group_name IS NULL OR group_name = '') AND account IN (" + allowedUniqueAccounts.map(() => '?').join(',') + "))");
      params.push.apply(params, allowedUniqueAccounts);
    }

    return {
      sql: "DELETE FROM schedules WHERE " + sqlParts.join(' OR '),
      params
    };
  }

  function normalizeTaskId(id) {
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function persistTasks(database, tasks, cb) {
    if (!tasks.length) {
      cb({ ok: true, count: 0 });
      return;
    }

    const stmt = database.prepare(`
      INSERT INTO schedules (id, account, person, group_name, type, content, remark, date, status, progress, workflow_stage, participants_json, sort_order, parallel_key, schedule_hidden, linked_parent_id, doc_title, doc_url, doc_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        account = excluded.account,
        person = excluded.person,
        group_name = excluded.group_name,
        type = excluded.type,
        content = excluded.content,
        remark = excluded.remark,
        date = excluded.date,
        status = excluded.status,
        progress = excluded.progress,
        workflow_stage = excluded.workflow_stage,
        participants_json = excluded.participants_json,
        sort_order = excluded.sort_order,
        parallel_key = excluded.parallel_key,
        schedule_hidden = excluded.schedule_hidden,
        linked_parent_id = excluded.linked_parent_id,
        doc_title = excluded.doc_title,
        doc_url = excluded.doc_url,
        doc_kind = excluded.doc_kind
    `);

    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      stmt.run([
        normalizeTaskId(t.id),
        t.account || '',
        t.person || '',
        t.group_name || '',
        t.type || '日常',
        t.content || '',
        t.remark || '',
        t.date || '',
        t.status || 'pending',
        t.progress || '',
        t.workflow_stage || '文案',
        t.participants_json || '[]',
        Number.isFinite(Number(t.sort_order)) ? Number(t.sort_order) : 0,
        t.parallel_key || '',
        Number(t.schedule_hidden) ? 1 : 0,
        Number.isFinite(Number(t.linked_parent_id)) ? Number(t.linked_parent_id) : null,
        t.doc_title || '',
        t.doc_url || '',
        t.doc_kind || ''
      ]);
    }

    stmt.finalize(function(err) {
      if (err) {
        cb({ ok: false, error: err.message });
        return;
      }
      cb({ ok: true, count: tasks.length });
    });
  }

  function safeFileName(name) {
    const raw = String(name || '文案附件').replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    const ext = path.extname(raw).toLowerCase();
    const base = path.basename(raw, ext).slice(0, 80) || 'schedule-doc';
    return base + '-' + Date.now().toString(36) + ext;
  }

  function isAllowedDocExt(name) {
    return ['.txt', '.doc', '.docx', '.pdf'].includes(path.extname(String(name || '')).toLowerCase());
  }

  return {
    '/api/schedule/load': function(body, cb) {
      const database = getDb();
      database.all("SELECT * FROM schedules ORDER BY person, sort_order, date, id", function(err, rows) {
        if (err) {
          cb({ tasks: [], members: [], error: err.message });
          return;
        }
        rows = (rows || []).map(function(row) {
          return normalizeTask(Object.assign({}, row, {
            doc_title: row.doc_title || '',
            doc_url: row.doc_url || '',
            doc_kind: row.doc_kind || ''
          }));
        });
        updateMissingGroupNames(database, rows);
        const activeRows = rows.filter(function(row) { return !row.schedule_hidden; });
        const visibleRows = filterVisibleTasks(activeRows, body._auth || {});
        const members = Array.from(new Set(visibleRows.map(r => r.person).filter(Boolean)));
        cb({ tasks: visibleRows, members: members });
      });
    },

    '/api/schedule/save': function(body, cb) {
      const database = getDb();
      const { tasks, members } = body;

      if (!tasks || !Array.isArray(tasks)) {
        cb({ ok: false, error: 'invalid tasks' });
        return;
      }

      const auth = body._auth || {};
      const allowedGroups = allowedGroupNames(auth);
      if (!allowedGroups.length) {
        cb({ ok: false, error: 'no schedule group permission' });
        return;
      }
      const allowedSet = new Set(allowedGroups);
      const fallbackGroup = allowedGroups.length === 1 ? allowedGroups[0] : '';
      const normalizedTasks = tasks
        .map(function(task) { return normalizeTask(task, fallbackGroup); })
        .filter(function(task) { return allowedSet.has(task.group_name); });
      const groupsToReplace = Array.from(new Set(
        normalizedTasks
          .map(function(task) { return task.group_name; })
          .filter(function(groupName) { return allowedSet.has(groupName); })
      ));

      if (!groupsToReplace.length) {
        cb({ ok: true, count: 0 });
        return;
      }

      database.serialize(function() {
        const scopedDelete = buildScopedDelete(auth, groupsToReplace);
        database.run(scopedDelete.sql, scopedDelete.params, function(err) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          persistTasks(database, normalizedTasks, cb);
        });
      });
    },

    '/api/schedule/upload-doc': function(body, cb) {
      const name = String(body.name || '').trim();
      const fileData = String(body.file_data || '').trim();
      if (!name || !fileData) {
        cb({ ok: false, error: 'file required' });
        return;
      }
      if (!isAllowedDocExt(name)) {
        cb({ ok: false, error: 'only txt/doc/docx/pdf allowed' });
        return;
      }
      try {
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        const filename = safeFileName(name);
        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, Buffer.from(fileData, 'base64'));
        cb({
          ok: true,
          title: name,
          url: '/uploads/schedule-docs/' + encodeURIComponent(filename),
          kind: 'file'
        });
      } catch (e) {
        cb({ ok: false, error: e.message || String(e) });
      }
    },

    '/api/schedule/notify-handoff': function(body, cb) {
      const database = getDb();
      const toPerson = String(body.toPerson || body.receiver || '').trim();
      const fromPerson = String(body.fromPerson || body.sender || '').trim();
      const task = body.task && typeof body.task === 'object' ? body.task : {};

      if (!toPerson) {
        cb({ ok: false, error: 'receiver required' });
        return;
      }

      const auth = body._auth || {};
      const sender = fromPerson || auth.display_name || auth.username || '';
      const taskContent = String(task.content || '').slice(0, 240);
      const taskAccount = String(task.account || '').slice(0, 120);
      const payload = JSON.stringify({
        taskId: task.id || null,
        date: task.date || '',
        type: task.type || '',
        remark: task.remark || ''
      });

      database.run(
        `INSERT INTO schedule_notifications
          (type, receiver_name, sender_name, title, message, task_content, task_account, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'handoff',
          toPerson,
          sender,
          '\u60a8\u6536\u5230\u65b0\u7684\u8ba2\u5355',
          sender ? `${sender} \u4ea4\u63a5\u7ed9\u4f60\u4e00\u4e2a\u65b0\u4efb\u52a1` : '\u4f60\u6709\u4e00\u4e2a\u65b0\u4efb\u52a1',
          taskContent,
          taskAccount,
          payload
        ],
        function(err) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          cb({ ok: true, id: this.lastID });
        }
      );
    },

    '/api/schedule/notifications/unread': function(body, cb) {
      const database = getDb();
      const names = userNames(body._auth);
      if (!names.length) {
        cb({ ok: true, notifications: [] });
        return;
      }
      const placeholders = names.map(() => '?').join(',');
      database.all(
        `SELECT id, type, receiver_name, sender_name, title, message, task_content, task_account, payload, created_at
         FROM schedule_notifications
         WHERE read_at IS NULL AND receiver_name IN (${placeholders})
         ORDER BY created_at ASC, id ASC
         LIMIT 20`,
        names,
        function(err, rows) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          cb({ ok: true, notifications: rows || [] });
        }
      );
    },

    '/api/schedule/notifications/read': function(body, cb) {
      const database = getDb();
      const names = userNames(body._auth);
      const ids = Array.isArray(body.ids)
        ? body.ids.map(id => Number(id)).filter(Number.isFinite)
        : [];
      if (!names.length || !ids.length) {
        cb({ ok: true, count: 0 });
        return;
      }
      const idPlaceholders = ids.map(() => '?').join(',');
      const namePlaceholders = names.map(() => '?').join(',');
      database.run(
        `UPDATE schedule_notifications
         SET read_at = strftime('%s', 'now')
         WHERE read_at IS NULL
           AND id IN (${idPlaceholders})
           AND receiver_name IN (${namePlaceholders})`,
        ids.concat(names),
        function(err) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          cb({ ok: true, count: this.changes || 0 });
        }
      );
    }
  };
};
