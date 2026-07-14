/**
 * 初始化用户数据
 * 用法: node server/scripts/initUsers.cjs
 */
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'auth.db');

// 用户名单
const USERS = [
  { name: '姚琳琳', group: '内容一部', type: '正式员工', onJob: true, isMinister: true },
  { name: '姚希', group: '内容四组', type: '正式员工', onJob: true },
  { name: '许树杰', group: '内容一部', type: '正式员工', onJob: true },
  { name: '廖李星', group: '内容一部', type: '正式员工', onJob: true },
  { name: '吴皓轩', group: '内容六组', type: '正式员工', onJob: true },
  { name: '朱信宇', group: '内容五组', type: '正式员工', onJob: true },
  { name: '许梦婷', group: '内容一部', type: '正式员工', onJob: true },
  { name: '陈健伊', group: '内容四组', type: '正式员工', onJob: true },
  { name: '刘登魁', group: '内容六组', type: '正式员工', onJob: true },
  { name: '许国锬', group: '内容一部', type: '正式员工', onJob: true },
  { name: '林孝添', group: '内容一部', type: '正式员工', onJob: true },
  { name: '宋丽佳', group: '内容四组', type: '正式员工', onJob: true },
  { name: '傅思敏', group: '内容二组', type: '正式员工', onJob: true },
  { name: '叶进生', group: '内容六组', type: '正式员工', onJob: true },
  { name: '曹媛', group: '内容三组', type: '正式员工', onJob: true },
  { name: '陈泓睿', group: '内容三组', type: '正式员工', onJob: true },
  { name: '林文涛', group: '内容三组', type: '正式员工', onJob: true },
  { name: '林心语', group: '内容五组', type: '正式员工', onJob: true },
  { name: '高明镇', group: '内容一部', type: '正式员工', onJob: true },
  { name: '赵良杰', group: '内容二组', type: '正式员工', onJob: true },
  { name: '商光涵', group: '内容五组', type: '正式员工', onJob: true },
  { name: '林语婷', group: '内容一部', type: '正式员工', onJob: true },
  { name: '林宇辰', group: '内容四组', type: '正式员工', onJob: true },
  { name: '张碧珊', group: '内容六组', type: '正式员工', onJob: false }, // 已离职
  { name: '陈乐恒', group: '内容二组', type: '正式员工', onJob: true },
  { name: '吴恒', group: '内容二组', type: '正式员工', onJob: true },
  { name: '薛荐轩', group: '内容一部', type: '正式员工', onJob: true },
  { name: '杨鸿霆', group: '内容五组', type: '正式员工', onJob: true },
  { name: '叶子健', group: '内容一部', type: '正式员工', onJob: true },
  { name: '李扬林', group: '内容二组', type: '正式员工', onJob: true },
  { name: '施律彬', group: '内容二组', type: '正式员工', onJob: false }, // 已离职
  { name: '刘佳琳', group: '内容三组', type: '实习生', onJob: true },
  { name: '罗晓棋', group: '内容二组', type: '实习生', onJob: true },
  { name: '肖子璇', group: '内容三组', type: '实习生', onJob: true },
  { name: '叶颖', group: '内容六组', type: '实习生', onJob: true },
  { name: '张莹珊', group: '内容六组', type: '正式员工', onJob: true },
  { name: '刘思嫚', group: '内容六组', type: '正式员工', onJob: true },
  { name: '邓姝', group: '内容六组', type: '正式员工', onJob: true },
  { name: '吴楷煌', group: '内容五组', type: '实习生', onJob: true },
  { name: '张家豪', group: 'MCN经纪组', type: '正式员工', onJob: true },
  { name: '钟文祯', group: 'MCN经纪组', type: '正式员工', onJob: true },
  { name: '龙星羽', group: 'MCN经纪组', type: '正式员工', onJob: true },
  { name: '吴羿玄', group: 'MCN经纪组', type: '正式员工', onJob: true },
];

function now() {
  return Math.floor(Date.now() / 1000);
}

// 组长名单
const LEADERS = ['薛荐轩', '傅思敏', '陈健伊', '曹媛', '杨鸿霆', '刘登魁'];

async function init() {
  const db = new sqlite3.Database(DB_PATH);

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

  // Ensure columns exist and fix NULL values
  const columns = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(users)", function(err, rows) {
      if (err) reject(err);
      else resolve(rows.map(r => r.name));
    });
  });

  if (!columns.includes('group_name')) {
    await run("ALTER TABLE users ADD COLUMN group_name TEXT DEFAULT ''");
    console.log('Added group_name column');
  }
  if (!columns.includes('real_name')) {
    await run("ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''");
    console.log('Added real_name column');
  }
  if (!columns.includes('employee_type')) {
    await run("ALTER TABLE users ADD COLUMN employee_type TEXT DEFAULT '正式员工'");
    console.log('Added employee_type column');
  }
  if (!columns.includes('is_on_job')) {
    await run("ALTER TABLE users ADD COLUMN is_on_job INTEGER DEFAULT 1");
    console.log('Added is_on_job column');
  }
  if (!columns.includes('pending')) {
    await run("ALTER TABLE users ADD COLUMN pending INTEGER DEFAULT 1");
    console.log('Added pending column');
  }
  if (!columns.includes('title')) {
    await run("ALTER TABLE users ADD COLUMN title TEXT DEFAULT ''");
    console.log('Added title column');
  }

  // Fix existing NULL password_hash/password_salt
  await run("UPDATE users SET password_hash='' WHERE password_hash IS NULL");
  await run("UPDATE users SET password_salt='' WHERE password_salt IS NULL");
  await run("UPDATE users SET pending=0 WHERE pending IS NULL");
  await run("UPDATE users SET is_on_job=1 WHERE is_on_job IS NULL");
  console.log('Fixed NULL values in existing users');

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // 只导入在职员工
  const activeUsers = USERS.filter(u => u.onJob);
  console.log(`过滤后在职员工：${activeUsers.length} 人（原列表 ${USERS.length} 人）`);

  for (const user of activeUsers) {
    const existing = await get('SELECT id, pending FROM users WHERE username=?', [user.name]);
    const title = user.isMinister ? '部长' : (LEADERS.includes(user.name) ? '组长' : '');

    if (existing) {
      // Update existing user info
      await run(
        `UPDATE users SET group_name=?, employee_type=?, is_on_job=1, pending=0, title=?, updated_at=? WHERE id=?`,
        [user.group, user.type, title, now(), existing.id]
      );
      console.log(`Updated: ${user.name} (${user.group}, ${user.type}, ${title || '成员'})`);
      updated++;
    } else {
      // Create new pending user (no password yet, will be set during registration)
      await run(
        `INSERT INTO users (username, display_name, real_name, group_name, employee_type, title, role, permissions, password_hash, password_salt, pending, is_on_job, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'member', '[]', '', '', 1, 1, 1, ?, ?)`,
        [user.name, user.name, user.name, user.group, user.type, title, now(), now()]
      );
      console.log(`Created: ${user.name} (${user.group}, ${user.type}, ${title || '成员'})`);
      created++;
    }
  }

  const inactiveUsers = USERS.filter(u => !u.onJob);
  for (const user of inactiveUsers) {
    const existing = await get('SELECT id FROM users WHERE username=?', [user.name]);
    if (!existing) continue;
    await run(
      `UPDATE users SET group_name=?, employee_type=?, is_on_job=0, title='', updated_at=? WHERE id=?`,
      [user.group, user.type, now(), existing.id]
    );
    console.log(`Marked off-job: ${user.name} (${user.group}, ${user.type})`);
    updated++;
  }

  console.log(`\n完成！新建 ${created} 个用户，更新 ${updated} 个用户，跳过 ${skipped} 个`);
  db.close();
}

init().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
