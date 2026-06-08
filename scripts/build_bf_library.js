/**
 * 批量导入 BF 文档到向量库
 * 用法: node build_bf_library.js
 *
 * 直接写入 SQLite 数据库，不依赖后端 API。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('D:/workspace-v2/node_modules/sqlite3');

const BF_ANALYSIS_DIR = 'C:\\Users\\Administrator\\.openclaw\\workspace\\bf_analysis';
const BF_RAW_DOCS_DIR = 'C:\\Users\\Administrator\\.openclaw\\workspace\\bf_raw_docs';
const DB_PATH = 'D:\\workspace-v2\\data\\vector_store.db';

// JSON标题 → MD文件名映射（已验证存在的文件名）
const TITLE_TO_MD = {
  '心灵渡船kol需求文档': '心灵渡船kol需求文档_原文对照版.md',
  '【忍3】26年5月游戏达人BF（4.16-5.27发布）': '忍3_5月游戏达人BF_原文对照版.md',
  '26年寒假-银枭版本bf（2.6）': '忍3_银枭版本bf_原文对照版.md',
  '潮汐守望者视频Brief_26.03': '潮汐守望者视频Brief_原文对照版.md',
  '魔兽春节预热传播-BF': '魔兽春节预热传播BF_原文对照版.md',
};

function titleToMdFilename(title) {
  if (!title) return null;
  return TITLE_TO_MD[title] || null;
}

// Vite dev server address
const API_BASE = 'http://localhost:3000';

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({ error: d.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

function flattenDirections(doc) {
  const parts = [];
  if (doc.directions) {
    for (const dir of doc.directions) {
      parts.push(`【方向${dir.direction_id}】${dir.direction_name}`);
      if (dir.scripts && Array.isArray(dir.scripts)) {
        for (const s of dir.scripts) parts.push(s);
      }
      if (dir.content) parts.push(dir.content);
    }
  }
  return parts.join('\n');
}

function buildText(doc) {
  const lines = [];
  lines.push(`【标题】${doc.title}`);
  if (doc.game_name) lines.push(`【游戏】${doc.game_name}`);
  if (doc.platform) lines.push(`【平台】${doc.platform}`);
  if (doc.version) lines.push(`【版本】${doc.version}`);
  if (doc.version_period || doc.publish_period) lines.push(`【发布周期】${doc.version_period || doc.publish_period}`);
  if (doc.publish_date) lines.push(`【发布日期】${doc.publish_date}`);
  if (doc.core_keywords) lines.push(`【核心关键词】${Array.isArray(doc.core_keywords) ? doc.core_keywords.join('、') : doc.core_keywords}`);
  if (doc.genre) lines.push(`【类型】${doc.genre}`);
  if (doc.game_type) lines.push(`【游戏类型】${doc.game_type}`);

  // 游戏特色/亮点
  if (doc.game_highlights) {
    lines.push('\n【游戏亮点】');
    for (const h of doc.game_highlights) {
      lines.push(`${h.name}：${h.sub_points ? h.sub_points.join('；') : ''}`);
    }
  }

  // 版本内容
  if (doc.version_content) {
    const vc = doc.version_content;
    lines.push('\n【版本内容】');
    if (vc.new_character) lines.push(`新角色：${vc.new_character.name}（${vc.new_character.type}）特点：${Array.isArray(vc.new_character.features) ? vc.new_character.features.join('、') : vc.new_character.features}`);
    if (vc.new_weapon) lines.push(`新武器：${vc.new_weapon.name}（${vc.new_weapon.type}）`);
    if (vc.event_content) lines.push(`活动内容：${Array.isArray(vc.event_content) ? vc.event_content.join('、') : vc.event_content}`);
    if (vc.welfare) lines.push(`福利：${JSON.stringify(vc.welfare)}`);
  }

  // 视频要求
  if (doc.video_requirements) {
    const vr = doc.video_requirements;
    lines.push('\n【视频要求】');
    if (vr.duration) lines.push(`时长：${vr.duration}`);
    if (vr.ratio) lines.push(`比例：${vr.ratio}`);
    if (vr.style) lines.push(`风格：${vr.style}`);
    if (vr.bgm_style) lines.push(`BGM风格：${vr.bgm_style}`);
    if (vr.voice_style) lines.push(`配音风格：${vr.voice_style}`);
  }

  // 必含信息
  if (doc.must_include) {
    lines.push('\n【必须包含】');
    const mi = Array.isArray(doc.must_include) ? doc.must_include : [doc.must_include];
    for (const m of mi) lines.push(`· ${m}`);
  }

  // 敏感点
  if (doc.sensitive_points) {
    lines.push('\n【敏感点/禁止】');
    for (const sp of doc.sensitive_points) lines.push(`✗ ${sp}`);
  }

  // 创作方向（重点）
  if (doc.directions) {
    lines.push('\n【创作方向】');
    for (const dir of doc.directions) {
      lines.push(`\n${dir.direction_id}. ${dir.direction_name}`);
      if (dir.content) lines.push(`内容方向：${dir.content}`);
      if (dir.scripts && Array.isArray(dir.scripts)) {
        lines.push('参考脚本：');
        for (const s of dir.scripts) lines.push(`  "${s}"`);
      }
      if (dir.examples) {
        const ex = Array.isArray(dir.examples) ? dir.examples : [dir.examples];
        lines.push(`示例：${ex.join(' | ')}`);
      }
      if (dir.sub_types) {
        for (const st of dir.sub_types) {
          if (typeof st === 'string') lines.push(`  · ${st}`);
          else {
            lines.push(`  · ${st.name}`);
            if (st.scripts) for (const s of st.scripts) lines.push(`    "${s}"`);
          }
        }
      }
    }
  }

  // 物料
  if (doc.materials) {
    lines.push('\n【物料素材】');
    for (const [k, v] of Object.entries(doc.materials)) {
      lines.push(`${k}：${Array.isArray(v) ? v.join(' | ') : v}`);
    }
  }

  return lines.join('\n');
}

function buildTags(doc) {
  const tags = [];
  if (doc.game_name) tags.push(doc.game_name);
  if (doc.platform) tags.push(doc.platform);
  if (doc.version) tags.push(doc.version);
  if (doc.core_keywords && Array.isArray(doc.core_keywords)) tags.push(...doc.core_keywords);
  if (doc.genre) tags.push(doc.genre);
  if (doc.game_type) tags.push(doc.game_type);
  if (doc.tags && Array.isArray(doc.tags)) tags.push(...doc.tags);
  return [...new Set(tags)].join(',');
}

function buildHook(doc) {
  // 用标题+平台+游戏名做hook
  const parts = [];
  if (doc.title) parts.push(doc.title);
  if (doc.game_name) parts.push(doc.game_name);
  if (doc.platform) parts.push(doc.platform);
  return parts.join(' | ');
}

function buildGoldenLine(doc) {
  // 找第一个有脚本的方向
  if (doc.directions) {
    for (const dir of doc.directions) {
      if (dir.scripts && dir.scripts.length > 0) return dir.scripts[0];
      if (dir.content) return dir.content;
    }
  }
  if (doc.key_messages && doc.key_messages.length > 0) return doc.key_messages[0];
  if (doc.entry_angles && doc.entry_angles.length > 0) return doc.entry_angles[0];
  return doc.title || '';
}

function buildProgression(doc) {
  if (!doc.directions) return '';
  return doc.directions.map(d => `${d.direction_id}. ${d.direction_name}`).join(' → ');
}

function buildSummary(doc) {
  const parts = [];
  if (doc.title) parts.push(doc.title);
  if (doc.game_name) parts.push(`游戏:${doc.game_name}`);
  if (doc.platform) parts.push(`平台:${doc.platform}`);
  if (doc.core_keywords && Array.isArray(doc.core_keywords)) parts.push(`关键词:${doc.core_keywords.slice(0, 5).join(',')}`);
  if (doc.version || doc.version_period || doc.publish_period) parts.push(`周期:${doc.version || doc.version_period || doc.publish_period}`);
  return parts.join(' | ');
}

async function importFile(db, doc, mdFileName) {
  let source = '';
  if (mdFileName) {
    const mdPath = path.join(BF_RAW_DOCS_DIR, mdFileName);
    if (fs.existsSync(mdPath)) {
      source = '/raw_bf/' + mdFileName;
    }
  }

  const text = buildText(doc);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();

  const row = {
    id, collection: 'bf',
    text, account: '通用', scene: 'BF参考', type: 'bf',
    hook: buildHook(doc),
    golden_line: buildGoldenLine(doc),
    progression: buildProgression(doc),
    tags: buildTags(doc),
    summary: buildSummary(doc),
    source,
    created_at: now, updated_at: now
  };

  console.log(`\n导入: ${doc.title}`);
  console.log(`  游戏: ${doc.game_name || '-'}`);
  console.log(`  平台: ${doc.platform || '-'}`);
  console.log(`  方向数: ${doc.directions ? doc.directions.length : 0}`);
  console.log(`  原文: ${source || '(未找到)'}`);

  return new Promise((resolve, reject) => {
    db.run(`
      INSERT INTO vector_items
        (id, collection, text, account, scene, type, hook, golden_line, progression, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [row.id, row.collection, row.text, row.account, row.scene, row.type,
        row.hook, row.golden_line, row.progression, row.source, row.created_at, row.updated_at],
    function(err) {
      if (err) {
        console.log(`  ❌ 数据库错误: ${err.message}`);
        reject(err);
      } else {
        console.log(`  ✅ 成功 (id: ${id})`);
        resolve();
      }
    });
  });
}

async function main() {
  // 确保数据库目录存在
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const db = new sqlite3.Database(DB_PATH);

  // 确保表结构是最新的（含 source 字段）
  await new Promise(res => db.run(`
    CREATE TABLE IF NOT EXISTS vector_items (
      id TEXT PRIMARY KEY, collection TEXT NOT NULL, text TEXT NOT NULL,
      account TEXT DEFAULT '通用', scene TEXT DEFAULT '素材',
      type TEXT DEFAULT 'template', hook TEXT DEFAULT '',
      golden_line TEXT DEFAULT '', progression TEXT DEFAULT '',
      source TEXT DEFAULT '', created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0
    )
  `, res));

  // 如果 source 列不存在则添加
  await new Promise(res => {
    db.all("PRAGMA table_info(vector_items)", (err, cols) => {
      if (!err && cols && !cols.find(c => c.name === 'source')) {
        db.run("ALTER TABLE vector_items ADD COLUMN source TEXT DEFAULT ''", res);
      } else {
        res();
      }
    });
  });

  const files = fs.readdirSync(BF_ANALYSIS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(BF_ANALYSIS_DIR, f))
    .sort();

  console.log(`找到 ${files.length} 个 BF 文档：`);
  for (const f of files) console.log(`  - ${path.basename(f)}`);

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const doc = JSON.parse(content);
    const mdFileName = titleToMdFilename(doc.title);
    await importFile(db, doc, mdFileName);
  }

  db.close();
  console.log('\n全部完成！');
}

main().catch(err => { console.error(err); process.exit(1); });
