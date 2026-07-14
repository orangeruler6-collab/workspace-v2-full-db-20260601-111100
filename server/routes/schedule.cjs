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
    { label: '内容一部', aliases: ['内容一组'], leader: '薛荐轩', members: ['薛荐轩', '廖李星', '高明镇', '林孝添', '叶子健', '许国锬', '许树杰', '林语婷', '许梦婷'], accounts: ['最游话说', '薛定谔的机', '李野王SG', '游电工厂', '硬件侠', '情风师兄', '上官北丶', '王路飞CP', '素材'] },
    { label: '内容二组', leader: '傅思敏', members: ['傅思敏', '赵良杰', '陈乐恒', '吴恒', '李扬林', '施律彬', '罗晓棋'], accounts: ['痞仔伯爵', '暴走星号键', '雷鸭Fist', '报告砖家', '沙雕101', '网瘾少女一条', '素材'] },
    { label: '内容三组', leader: '曹媛', members: ['曹媛', '陈泓睿', '林文涛', '刘佳琳', '肖子璇'], accounts: ['策划克星阿强', '中二探长', '团子好贵', '嘿小虎', '灵梦小师妹', '跑腿的包子', '娱乐小狮酱', '甄有话说', '素材', '饭十七', '皮皮说游戏'] },
    { label: '内容四组', leader: '陈健伊', members: ['姚希', '陈健伊', '宋丽佳', '林宇辰'], accounts: ['天机妹', '花蛮楼', '麦小雯', '夏天丶Cat', '有事找学姐', '小张同学', '素材'] },
    { label: '内容五组', leader: '杨鸿霆', members: ['朱信宇', '林心语', '商光涵', '杨鸿霆', '吴楷煌'], accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬', '素材'] },
    { label: '内容六组', leader: '刘登魁', members: ['张莹珊', '刘思嫚', '吴皓轩', '邓姝', '叶进生', '叶颖', '刘登魁'], accounts: ['花无缺', '葵仔不想肝', '游戏永动机', '畅玩百晓生', '素材'] },
    { label: 'MCN经纪组', aliases: ['MCN经济组', '经济组'], leader: '', members: ['张家豪', '钟文祯', '龙星羽', '吴羿玄'], accounts: ['素材'] }
  ];
  function normalizeGroupKey(value) {
    return String(value || '').trim().replace(/内容/g, '').replace(/组/g, '').replace(/部/g, '');
  }

  function findScheduleGroupByName(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const key = normalizeGroupKey(text);
    return scheduleGroups.find(function(group) {
      return group.label === text
        || String(group.id || '') === text
        || normalizeGroupKey(group.label) === key
        || (group.aliases || []).some(function(alias) {
          return alias === text || normalizeGroupKey(alias) === key;
        });
    }) || null;
  }

  const validGroupNames = new Set(scheduleGroups.flatMap(group => [group.label].concat(group.aliases || [])));
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
          activity_json TEXT DEFAULT '[]',
          stack_count INTEGER DEFAULT 1,
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
      db.run(`
        CREATE TABLE IF NOT EXISTS schedule_todos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          group_name TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT DEFAULT '',
          due_at TEXT DEFAULT '',
          important INTEGER DEFAULT 0,
          status TEXT DEFAULT 'open',
          progress INTEGER DEFAULT 0,
          assignee TEXT DEFAULT '',
          created_by TEXT DEFAULT '',
          updated_at INTEGER DEFAULT (strftime('%s', 'now')),
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS schedule_todo_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_id INTEGER DEFAULT 0,
          group_name TEXT NOT NULL,
          title TEXT NOT NULL,
          detail TEXT DEFAULT '',
          due_at TEXT DEFAULT '',
          important INTEGER DEFAULT 0,
          status TEXT DEFAULT 'done',
          progress INTEGER DEFAULT 100,
          created_by TEXT DEFAULT '',
          original_updated_at INTEGER DEFAULT 0,
          original_created_at INTEGER DEFAULT 0,
          archive_week TEXT DEFAULT '',
          archived_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
      ensureTodoColumns();
      db.run(`
        CREATE TABLE IF NOT EXISTS schedule_meta (
          key TEXT PRIMARY KEY,
          value TEXT DEFAULT '',
          updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);
    }
    return db;
  }

  function readScheduleRevision(database, cb) {
    database.run(
      `INSERT OR IGNORE INTO schedule_meta (key, value, updated_at) VALUES ('revision', '0', strftime('%s', 'now'))`,
      [],
      function(insertErr) {
        if (insertErr) {
          cb(insertErr);
          return;
        }
        database.get(`SELECT value, updated_at FROM schedule_meta WHERE key='revision'`, [], function(err, row) {
          if (err) {
            cb(err);
            return;
          }
          cb(null, {
            revision: Number(row && row.value || 0) || 0,
            updated_at: Number(row && row.updated_at || 0) || 0
          });
        });
      }
    );
  }

  function bumpScheduleRevision(database, cb) {
    database.serialize(function() {
      database.run(
        `INSERT OR IGNORE INTO schedule_meta (key, value, updated_at) VALUES ('revision', '0', strftime('%s', 'now'))`
      );
      database.run(
        `UPDATE schedule_meta SET value = CAST(COALESCE(value, '0') AS INTEGER) + 1, updated_at = strftime('%s', 'now') WHERE key='revision'`,
        [],
        function(err) {
          if (err) {
            cb(err);
            return;
          }
          readScheduleRevision(database, cb);
        }
      );
    });
  }

  function localDateKey(date) {
    const pad = number => String(number).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join('-');
  }

  function currentWeekKey() {
    const date = new Date();
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + diff);
    return localDateKey(date);
  }

  function archiveCompletedTodosIfNeeded(database, cb) {
    const weekKey = currentWeekKey();
    database.serialize(function() {
      database.run(
        `INSERT OR IGNORE INTO schedule_meta (key, value, updated_at) VALUES ('todo_completed_archive_week', '', strftime('%s', 'now'))`
      );
      database.get(`SELECT value FROM schedule_meta WHERE key='todo_completed_archive_week'`, [], function(metaErr, row) {
        if (metaErr) {
          cb(metaErr);
          return;
        }
        const archivedWeek = String(row && row.value || '');
        if (!archivedWeek) {
          database.run(
            `UPDATE schedule_meta SET value=?, updated_at=strftime('%s', 'now') WHERE key='todo_completed_archive_week'`,
            [weekKey],
            function(initErr) {
              cb(initErr || null);
            }
          );
          return;
        }
        if (archivedWeek === weekKey) {
          cb(null);
          return;
        }
        database.run(
          `INSERT INTO schedule_todo_history
            (original_id, group_name, title, detail, due_at, important, status, progress, created_by, original_updated_at, original_created_at, archive_week)
           SELECT id, group_name, title, detail, due_at, important, status, progress, created_by, updated_at, created_at, ?
           FROM schedule_todos
           WHERE status='done'`,
          [weekKey],
          function(insertErr) {
            if (insertErr) {
              cb(insertErr);
              return;
            }
            database.run(`DELETE FROM schedule_todos WHERE status='done'`, [], function(deleteErr) {
              if (deleteErr) {
                cb(deleteErr);
                return;
              }
              database.run(
                `UPDATE schedule_meta SET value=?, updated_at=strftime('%s', 'now') WHERE key='todo_completed_archive_week'`,
                [weekKey],
                function(updateErr) {
                  cb(updateErr || null);
                }
              );
            });
          }
        );
      });
    });
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
      ['group_name', 'doc_title', 'doc_url', 'doc_kind', 'workflow_stage', 'participants_json', 'activity_json'].forEach(function(column) {
        database.run("ALTER TABLE schedules ADD COLUMN " + column + " TEXT DEFAULT ''", function() {});
      });
      database.run("ALTER TABLE schedules ADD COLUMN stack_count INTEGER DEFAULT 1", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN sort_order INTEGER DEFAULT 0", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN parallel_key TEXT DEFAULT ''", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN schedule_hidden INTEGER DEFAULT 0", function() {});
      database.run("ALTER TABLE schedules ADD COLUMN linked_parent_id INTEGER DEFAULT NULL", function() {});
    });
  }

  function ensureTodoColumns() {
    const database = db;
    database.serialize(function() {
      database.run("ALTER TABLE schedule_todos ADD COLUMN progress INTEGER DEFAULT 0", function() {});
      database.run("ALTER TABLE schedule_todos ADD COLUMN assignee TEXT DEFAULT ''", function() {});
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
    const explicitGroup = findScheduleGroupByName(explicit);
    if (explicitGroup) return explicitGroup.label;

    const memberGroup = groupByMember(task && task.person);
    if (memberGroup) return memberGroup.label;

    const account = String(task && task.account || '').trim();
    const accountGroups = accountToGroups[account] || [];
    if (accountGroups.length === 1) return accountGroups[0];

    const fallback = String(fallbackGroup || '').trim();
    const fallbackMatch = findScheduleGroupByName(fallback);
    return fallbackMatch ? fallbackMatch.label : '';
  }

  function authGroupName(auth) {
    const explicit = String(auth && auth.group_name || '').trim();
    const explicitGroup = findScheduleGroupByName(explicit);
    if (explicitGroup) return explicitGroup.label;

    const names = userNames(auth);
    for (let i = 0; i < names.length; i++) {
      const group = groupByMember(names[i]);
      if (group) return group.label;
    }
    return '';
  }

  function groupNamesWithAliases(groupName) {
    const group = findScheduleGroupByName(groupName);
    if (!group) return groupName ? [groupName] : [];
    return [group.label].concat(group.aliases || []);
  }

  function allowedGroupNames(auth) {
    if (isScheduleAdmin(auth)) return scheduleGroups.flatMap(group => [group.label].concat(group.aliases || []));
    const groupName = authGroupName(auth);
    return groupNamesWithAliases(groupName);
  }

  function normalizeTask(task, fallbackGroup) {
    const participantsJson = String(task && task.participants_json || '').trim();
    const activityJson = String(task && task.activity_json || '').trim();
    const workflowStage = String(task && task.workflow_stage || '').trim();
    const stackCount = normalizeStackCount(task);
    const normalized = Object.assign({}, task, {
      group_name: inferGroupName(task, fallbackGroup),
      sort_order: Number.isFinite(Number(task && task.sort_order)) ? Number(task.sort_order) : 0,
      parallel_key: String(task && task.parallel_key || ''),
      workflow_stage: workflowStage,
      participants_json: participantsJson || '[]',
      activity_json: activityJson || '[]',
      stack_count: stackCount,
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

  function normalizeStackCount(task) {
    const type = String(task && task.type || '');
    if (!type.includes('星广') && type !== '素材代做') return 1;
    const raw = Number((task && (task.stack_count || task.stackCount || task.itemCount || task.quantity)) || 1);
    if (!Number.isFinite(raw)) return 1;
    return Math.max(1, Math.min(99, Math.round(raw)));
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

  function normalizeTodoId(id) {
    const parsed = Number(id);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function normalizeTodo(todo, auth) {
    const source = todo && typeof todo === 'object' ? todo : {};
    const title = String(source.title || '').trim().slice(0, 160);
    const detail = String(source.detail || '').trim().slice(0, 1000);
    const groupName = String(source.group_name || source.groupName || '').trim();
    const group = findScheduleGroupByName(groupName);
    const dueAt = String(source.due_at || source.dueAt || '').trim().slice(0, 40);
    const status = String(source.status || 'open').trim() === 'done' ? 'done' : 'open';
    const progress = Math.max(0, Math.min(100, Math.round(Number(source.progress || 0) || 0)));
    const assignee = String(source.assignee || source.person || '').trim().slice(0, 80);
    return {
      id: normalizeTodoId(source.id),
      group_name: group ? group.label : authGroupName(auth),
      title,
      detail,
      due_at: dueAt,
      important: Number(source.important) ? 1 : 0,
      progress,
      assignee,
      status
    };
  }

  function todoAllowed(todo, auth) {
    const allowed = allowedGroupNames(auth);
    return allowed.includes(todo.group_name);
  }

  function persistTasks(database, tasks, cb) {
    if (!tasks.length) {
      cb({ ok: true, count: 0 });
      return;
    }

    const stmt = database.prepare(`
      INSERT INTO schedules (id, account, person, group_name, type, content, remark, date, status, progress, workflow_stage, participants_json, activity_json, stack_count, sort_order, parallel_key, schedule_hidden, linked_parent_id, doc_title, doc_url, doc_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        activity_json = excluded.activity_json,
        stack_count = excluded.stack_count,
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
        t.activity_json || '[]',
        normalizeStackCount(t),
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

  function shortText(value, fallback) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return (text || fallback || '未命名').slice(0, 80);
  }

  function actorName(auth) {
    return String(auth && (auth.display_name || auth.username) || '').trim() || '未知用户';
  }

  function taskLabel(task) {
    const account = shortText(task && task.account, '');
    const content = shortText(task && task.content, '选题待定');
    return account ? `【${account} / ${content}】` : `【${content}】`;
  }

  function todoLabel(todo) {
    return `【${shortText(todo && todo.title, '未命名待办')}】`;
  }

  function logScheduleOperation(body, info) {
    if (!deps.authStore || !deps.authStore.logOperation || !body || !body._auth) return;
    deps.authStore.logOperation(Object.assign({
      module: 'schedule',
      target_type: 'schedule',
      metadata: {}
    }, info, {
      auth: body._auth,
      req: body._req
    })).catch(function() {});
  }

  function compactScheduleMetadata(task) {
    return {
      id: task && task.id || null,
      account: task && task.account || '',
      person: task && task.person || '',
      group_name: task && task.group_name || '',
      date: task && task.date || '',
      type: task && task.type || '',
      content: task && task.content || '',
      status: task && task.status || '',
      progress: task && task.progress || '',
      workflow_stage: task && task.workflow_stage || '',
      stack_count: task && task.stack_count || 1
    };
  }

  function collectScheduleAuditEntries(oldRows, newTasks) {
    const oldById = new Map((oldRows || []).filter(row => row && row.id).map(row => [Number(row.id), row]));
    const newById = new Map((newTasks || []).filter(task => task && task.id).map(task => [Number(task.id), task]));
    const entries = [];

    (newTasks || []).forEach(function(task) {
      const id = normalizeTaskId(task.id);
      const previous = id ? oldById.get(id) : null;
      if (!previous) {
        entries.push({
          action: 'schedule.task.create',
          target_id: id || '',
          summary: '新建排期任务：' + taskLabel(task),
          metadata: { after: compactScheduleMetadata(task) }
        });
        return;
      }

      const changes = [];
      function changed(key, label) {
        const beforeValue = String(previous[key] || '').trim();
        const afterValue = String(task[key] || '').trim();
        if (beforeValue !== afterValue) changes.push({ key, label, before: beforeValue, after: afterValue });
      }
      changed('content', '内容');
      changed('remark', '备注');
      changed('status', '状态');
      changed('progress', '进度');
      changed('workflow_stage', '阶段');
      changed('type', '类型');
      if (Number(previous.stack_count || 1) !== Number(task.stack_count || 1)) {
        changes.push({ key: 'stack_count', label: '堆叠条数', before: String(previous.stack_count || 1), after: String(task.stack_count || 1) });
      }

      if (!changes.length) return;
      const stageChange = changes.find(change => change.key === 'workflow_stage');
      const action = stageChange ? 'schedule.task.progress' : 'schedule.task.update';
      const changeText = changes.slice(0, 4).map(change => `${change.label} ${change.before || '空'} -> ${change.after || '空'}`).join('，');
      entries.push({
        action,
        target_id: id || '',
        summary: (stageChange ? '推进排期任务：' : '修改排期任务：') + taskLabel(task) + '（' + changeText + '）',
        metadata: {
          before: compactScheduleMetadata(previous),
          after: compactScheduleMetadata(task),
          changes
        }
      });
    });

    (oldRows || []).forEach(function(row) {
      const id = normalizeTaskId(row.id);
      if (!id || newById.has(id)) return;
      entries.push({
        action: 'schedule.task.delete',
        target_id: id,
        summary: '删除排期任务：' + taskLabel(row),
        metadata: { before: compactScheduleMetadata(row) }
      });
    });

    return entries.slice(0, 30);
  }

  function logScheduleTaskDiff(body, oldRows, newTasks) {
    const entries = collectScheduleAuditEntries(oldRows, newTasks);
    if (!entries.length) return;
    entries.forEach(function(entry) {
      logScheduleOperation(body, Object.assign({
        target_type: 'schedule_task'
      }, entry));
    });
  }

  function logTodoOperation(body, action, todo, summary, metadata) {
    logScheduleOperation(body, {
      action,
      target_type: 'schedule_todo',
      target_id: todo && todo.id || '',
      summary,
      metadata: Object.assign({
        id: todo && todo.id || null,
        group_name: todo && todo.group_name || '',
        title: todo && todo.title || '',
        due_at: todo && todo.due_at || '',
        status: todo && todo.status || '',
        progress: todo && todo.progress || 0
      }, metadata || {})
    });
  }

  return {
    '/api/schedule/revision': function(body, cb) {
      const database = getDb();
      readScheduleRevision(database, function(err, meta) {
        if (err) {
          cb({ ok: false, error: err.message });
          return;
        }
        cb({ ok: true, revision: meta.revision, updated_at: meta.updated_at });
      });
    },

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
        readScheduleRevision(database, function(revisionErr, meta) {
          if (revisionErr) {
            cb({ tasks: visibleRows, members: members, revision: 0, updated_at: 0, error: revisionErr.message });
            return;
          }
          cb({ tasks: visibleRows, members: members, revision: meta.revision, updated_at: meta.updated_at });
        });
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

      const hasBaseRevision = body.revision !== undefined && body.revision !== null
        || body.baseRevision !== undefined && body.baseRevision !== null;
      const baseRevision = Number(body.revision || body.baseRevision || 0) || 0;
      readScheduleRevision(database, function(revisionErr, currentMeta) {
        if (revisionErr) {
          cb({ ok: false, error: revisionErr.message });
          return;
        }
        if (hasBaseRevision && baseRevision !== currentMeta.revision) {
          cb({
            ok: false,
            code: 'schedule_conflict',
            error: '排期已被其他人更新，请同步最新版本后重试',
            revision: currentMeta.revision,
            updated_at: currentMeta.updated_at
          });
          return;
        }

        database.serialize(function() {
          const scopedDelete = buildScopedDelete(auth, groupsToReplace);
          database.all(scopedDelete.sql.replace(/^DELETE FROM schedules WHERE /, 'SELECT * FROM schedules WHERE '), scopedDelete.params, function(readErr, oldRows) {
            if (readErr) {
              cb({ ok: false, error: readErr.message });
              return;
            }
            database.run(scopedDelete.sql, scopedDelete.params, function(err) {
              if (err) {
                cb({ ok: false, error: err.message });
                return;
              }
              persistTasks(database, normalizedTasks, function(result) {
                if (!result || result.ok === false) {
                  cb(result || { ok: false, error: 'save schedule failed' });
                  return;
                }
                bumpScheduleRevision(database, function(bumpErr, nextMeta) {
                  if (bumpErr) {
                    cb({ ok: false, error: bumpErr.message });
                    return;
                  }
                  logScheduleTaskDiff(body, oldRows || [], normalizedTasks);
                  cb(Object.assign({}, result, { revision: nextMeta.revision, updated_at: nextMeta.updated_at }));
                });
              });
            });
          });
        });
      });
    },

    '/api/schedule/todos/load': function(body, cb) {
      const database = getDb();
      const allowed = allowedGroupNames(body._auth || {});
      if (!allowed.length) {
        cb({ ok: true, todos: [] });
        return;
      }
      archiveCompletedTodosIfNeeded(database, function(archiveErr) {
        if (archiveErr) {
          cb({ ok: false, error: archiveErr.message });
          return;
        }
        const placeholders = allowed.map(() => '?').join(',');
        database.all(
          `SELECT id, group_name, title, detail, due_at, important, status, progress, assignee, created_by, updated_at, created_at
           FROM schedule_todos
           WHERE group_name IN (${placeholders})
           ORDER BY status ASC, important DESC, due_at ASC, created_at DESC, id DESC`,
          allowed,
          function(err, rows) {
            if (err) {
              cb({ ok: false, error: err.message });
              return;
            }
            cb({ ok: true, todos: rows || [] });
          }
        );
      });
    },

    '/api/schedule/todos/history': function(body, cb) {
      const database = getDb();
      const allowed = allowedGroupNames(body._auth || {});
      if (!allowed.length) {
        cb({ ok: true, todos: [] });
        return;
      }
      const limit = Math.max(20, Math.min(500, Number(body.limit || 200) || 200));
      const placeholders = allowed.map(() => '?').join(',');
      database.all(
        `SELECT id, original_id, group_name, title, detail, due_at, important, status, progress, created_by,
                original_updated_at, original_created_at, archive_week, archived_at
         FROM schedule_todo_history
         WHERE group_name IN (${placeholders})
         ORDER BY archived_at DESC, id DESC
         LIMIT ?`,
        allowed.concat([limit]),
        function(err, rows) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          cb({ ok: true, todos: rows || [] });
        }
      );
    },

    '/api/schedule/todos/save': function(body, cb) {
      const database = getDb();
      const auth = body._auth || {};
      const todo = normalizeTodo(body.todo, auth);
      if (!todo.title) {
        cb({ ok: false, error: 'todo title required' });
        return;
      }
      if (!todo.group_name || (!todo.id && !todoAllowed(todo, auth))) {
        cb({ ok: false, error: 'no schedule group permission' });
        return;
      }

      if (todo.id) {
        database.get(
          `SELECT id, group_name, title, detail, due_at, important, status, progress, assignee, created_by, updated_at, created_at
           FROM schedule_todos
           WHERE id = ?`,
          [todo.id],
          function(readErr, previous) {
            if (readErr) {
              cb({ ok: false, error: readErr.message });
              return;
            }
            database.run(
              `UPDATE schedule_todos
               SET group_name = ?, title = ?, detail = ?, due_at = ?, important = ?, status = ?, progress = ?, assignee = ?, updated_at = strftime('%s', 'now')
               WHERE id = ?`,
              [todo.group_name, todo.title, todo.detail, todo.due_at, todo.important, todo.status, todo.progress, todo.assignee, todo.id],
              function(err) {
                if (err) {
                  cb({ ok: false, error: err.message });
                  return;
                }
                if ((this.changes || 0) > 0) {
                  const changes = [];
                  [
                    ['group_name', '分组'],
                    ['title', '标题'],
                    ['detail', '详情'],
                    ['due_at', '时间'],
                    ['important', '重要'],
                    ['status', '状态'],
                    ['progress', '进度']
                  ].forEach(function(item) {
                    const key = item[0];
                    const label = item[1];
                    const beforeValue = String(previous && previous[key] || '').trim();
                    const afterValue = String(todo[key] || '').trim();
                    if (beforeValue !== afterValue) changes.push({ key, label, before: beforeValue, after: afterValue });
                  });
                  const changeText = changes.length
                    ? changes.slice(0, 4).map(change => `${change.label} ${change.before || '空'} -> ${change.after || '空'}`).join('，')
                    : '保存待办';
                  logTodoOperation(
                    body,
                    'schedule.todo.update',
                    Object.assign({}, previous || {}, todo),
                    `${actorName(auth)} 修改部门待办：${todoLabel(todo)}（${changeText}）`,
                    { before: previous || null, after: todo, changes }
                  );
                }
                cb({ ok: true, id: todo.id, changes: this.changes || 0 });
              }
            );
          }
        );
        return;
      }

      const createdBy = (auth.display_name || auth.username || '').trim();
      database.run(
        `INSERT INTO schedule_todos
          (group_name, title, detail, due_at, important, status, progress, assignee, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [todo.group_name, todo.title, todo.detail, todo.due_at, todo.important, todo.status, todo.progress, todo.assignee, createdBy],
        function(err) {
          if (err) {
            cb({ ok: false, error: err.message });
            return;
          }
          const savedTodo = Object.assign({}, todo, { id: this.lastID, created_by: createdBy });
          logTodoOperation(
            body,
            'schedule.todo.create',
            savedTodo,
            `${actorName(auth)} 新建部门待办：${todoLabel(savedTodo)}（${savedTodo.group_name || '未分组'}）`,
            { after: savedTodo }
          );
          cb({ ok: true, id: this.lastID });
        }
      );
    },

    '/api/schedule/todos/status': function(body, cb) {
      const database = getDb();
      const id = normalizeTodoId(body.id);
      const status = String(body.status || '').trim() === 'done' ? 'done' : 'open';
      const allowed = allowedGroupNames(body._auth || {});
      if (!id || !allowed.length) {
        cb({ ok: false, error: 'invalid todo' });
        return;
      }
      const placeholders = allowed.map(() => '?').join(',');
      database.get(
        `SELECT id, group_name, title, detail, due_at, important, status, progress, created_by, updated_at, created_at
         FROM schedule_todos
         WHERE id = ? AND group_name IN (${placeholders})`,
        [id].concat(allowed),
        function(readErr, previous) {
          if (readErr) {
            cb({ ok: false, error: readErr.message });
            return;
          }
          database.run(
            `UPDATE schedule_todos
             SET status = ?, updated_at = strftime('%s', 'now')
             WHERE id = ? AND group_name IN (${placeholders})`,
            [status, id].concat(allowed),
            function(err) {
              if (err) {
                cb({ ok: false, error: err.message });
                return;
              }
              if ((this.changes || 0) > 0) {
                const nextTodo = Object.assign({}, previous || {}, { id, status });
                logTodoOperation(
                  body,
                  status === 'done' ? 'schedule.todo.done' : 'schedule.todo.reopen',
                  nextTodo,
                  `${actorName(body._auth || {})} ${status === 'done' ? '完成' : '重新打开'}部门待办：${todoLabel(nextTodo)}`,
                  { before: previous || null, after: nextTodo }
                );
              }
              cb({ ok: true, count: this.changes || 0 });
            }
          );
        }
      );
    },

    '/api/schedule/todos/delete': function(body, cb) {
      const database = getDb();
      const id = normalizeTodoId(body.id);
      const allowed = allowedGroupNames(body._auth || {});
      if (!id || !allowed.length) {
        cb({ ok: false, error: 'invalid todo' });
        return;
      }
      const placeholders = allowed.map(() => '?').join(',');
      database.get(
        `SELECT id, group_name, title, detail, due_at, important, status, progress, created_by, updated_at, created_at
         FROM schedule_todos
         WHERE id = ? AND group_name IN (${placeholders})`,
        [id].concat(allowed),
        function(readErr, previous) {
          if (readErr) {
            cb({ ok: false, error: readErr.message });
            return;
          }
          database.run(
            `DELETE FROM schedule_todos
             WHERE id = ? AND group_name IN (${placeholders})`,
            [id].concat(allowed),
            function(err) {
              if (err) {
                cb({ ok: false, error: err.message });
                return;
              }
              if ((this.changes || 0) > 0) {
                logTodoOperation(
                  body,
                  'schedule.todo.delete',
                  previous || { id },
                  `${actorName(body._auth || {})} 删除部门待办：${todoLabel(previous || { id })}`,
                  { before: previous || null }
                );
              }
              cb({ ok: true, count: this.changes || 0 });
            }
          );
        }
      );
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
          logScheduleOperation(body, {
            action: 'schedule.task.handoff',
            target_type: 'schedule_task',
            target_id: task.id || '',
            summary: `${actorName(auth)} 交接排期任务给 ${toPerson}：${taskLabel(task)}`,
            metadata: {
              task: compactScheduleMetadata(task),
              from: sender,
              to: toPerson,
              notification_id: this.lastID
            }
          });
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
