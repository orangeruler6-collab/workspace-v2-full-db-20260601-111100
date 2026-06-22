const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const OPENCLI_MAIN = process.env.OPENCLI_MAIN ||
  path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');

const args = parseArgs(process.argv.slice(2));
const profile = args.profile || 'tianji-mei-publish';
const session = args.session || 'codex-dy-data-api';
const tab = args.tab || '';
const outDir = path.resolve(ROOT, args.outDir || path.join('data', 'data-export-tests'));
const recentDays = Number(args.days || 30);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    parsed[key] = value;
  }
  return parsed;
}

function run(command, argv, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      reject(new Error(`timeout: ${command} ${argv.join(' ')}`));
    }, options.timeoutMs || 30000);
    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function extractJson(text) {
  const clean = String(text || '').replace(/^\uFEFF/, '').trim();
  const start = clean.search(/[\[{]/);
  if (start < 0) throw new Error(`missing json output\n${clean.slice(0, 1000)}`);
  for (let end = clean.length; end > start; end -= 1) {
    const slice = clean.slice(start, end).trim();
    if (!slice) continue;
    try {
      return JSON.parse(slice);
    } catch (_) {}
  }
  throw new Error(`invalid json output\n${clean.slice(0, 1000)}`);
}

async function browserEval(source) {
  const cliArgs = [OPENCLI_MAIN, '--profile', profile, 'browser', session, 'eval'];
  if (tab) cliArgs.push('--tab', tab);
  cliArgs.push(source);
  const result = await run(process.execPath, cliArgs, { timeoutMs: 45000 });
  if (result.code !== 0) {
    throw new Error(`opencli eval failed\n${result.stdout}\n${result.stderr}`);
  }
  return extractJson(`${result.stdout}\n${result.stderr}`);
}

function metricByName(payload) {
  const map = new Map();
  for (const metric of payload.metrics || []) {
    map.set(metric.english_metric_name, metric);
  }
  return map;
}

function valueAt(metric, date) {
  if (!metric) return '';
  const hit = (metric.trends || []).find(item => item.date_time === date);
  if (!hit) return '';
  return hit.value ?? hit.douyin_value ?? '';
}

function dateLabel(raw) {
  const text = String(raw || '');
  return text.length === 8 ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text;
}

function buildRows(payload) {
  const metrics = metricByName(payload);
  const dates = Array.from(new Set(
    Array.from(metrics.values()).flatMap(metric => (metric.trends || []).map(item => item.date_time))
  )).sort();

  const fansRows = dates.map(date => ({
    '日期': dateLabel(date),
    '总粉丝量': valueAt(metrics.get('total_fans_cnt'), date),
    '净增粉丝量': valueAt(metrics.get('net_fans_cnt'), date),
    '取关粉丝量': valueAt(metrics.get('cancel_fans_cnt'), date),
    '主页访问': valueAt(metrics.get('homepage_view_cnt'), date)
  }));

  const worksRows = dates.map(date => ({
    '日期': dateLabel(date),
    '播放量': valueAt(metrics.get('play_cnt'), date),
    '作品点赞': valueAt(metrics.get('digg_cnt'), date),
    '作品分享': valueAt(metrics.get('share_count'), date),
    '作品评论': valueAt(metrics.get('comment_cnt'), date),
    '封面点击率': valueAt(metrics.get('cover_click_ratio'), date)
  }));

  return { fansRows, worksRows, metrics };
}

function writeWorkbook(filename, sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  const full = path.join(outDir, filename);
  XLSX.writeFile(workbook, full);
  return full;
}

async function main() {
  if (!fs.existsSync(OPENCLI_MAIN)) throw new Error(`opencli main not found: ${OPENCLI_MAIN}`);
  fs.mkdirSync(outDir, { recursive: true });

  const script = `(async()=>{const r=await fetch('/janus/douyin/creator/data/overview/dashboard',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({recent_days:${JSON.stringify(recentDays)}})});const j=await r.json();return {ok:r.ok,status:r.status,status_code:j.status_code,status_msg:j.status_msg,metrics:j.metrics||[]};})()`;
  const payload = await browserEval(script);
  if (!payload.ok || payload.status_code !== 0) {
    throw new Error(`douyin dashboard api failed: HTTP ${payload.status}, ${payload.status_msg || payload.status_code}`);
  }

  const { fansRows, worksRows, metrics } = buildRows(payload);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const fansFile = writeWorkbook(`douyin-fans-trend-${stamp}.xlsx`, '抖音粉丝趋势', fansRows);
  const worksFile = writeWorkbook(`douyin-dashboard-works-${stamp}.xlsx`, '抖音账号总览作品趋势', worksRows);
  const summary = {
    ok: true,
    profile,
    session,
    tab,
    recentDays,
    fansFile,
    worksFile,
    fansRows: fansRows.length,
    worksRows: worksRows.length,
    metrics: Array.from(metrics.values()).map(item => ({
      key: item.english_metric_name,
      name: item.metric_name,
      value: item.metric_value,
      trends: (item.trends || []).length
    }))
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
