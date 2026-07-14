const fs = require('fs');
const path = require('path');
const { publishAccountCatalog, dashboardProfileMeta } = require('../server/lib/accountCatalog.cjs');

const ROOT = path.resolve(__dirname, '..');
const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(ROOT, args.outDir || path.join('data', 'data-export-tests'));
const outputFile = path.resolve(ROOT, args.output || path.join('data', 'account-platform-status.json'));
const sessionPrefix = String(args.sessionPrefix || '').trim();
const platforms = splitArg(args.platforms || 'douyin,kuaishou,bilibili');
const platformSet = new Set(platforms);
const preserveOnGlobalFailure = args.preserveOnGlobalFailure !== 'false';
const profileMeta = dashboardProfileMeta();

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    parsed[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return parsed;
}

function splitArg(value) {
  return String(value || '').split(',').map(item => item.trim()).filter(Boolean);
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (_) { return null; }
}

function safeWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function summaryFiles() {
  if (!fs.existsSync(outDir)) return [];
  return fs.readdirSync(outDir)
    .filter(name => /^platform-data-summary-.+\.json$/i.test(name))
    .filter(name => !sessionPrefix || name.includes(sessionPrefix))
    .map(name => {
      const full = path.join(outDir, name);
      let mtimeMs = 0;
      try { mtimeMs = fs.statSync(full).mtimeMs; } catch (_) {}
      return { name, full, mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
}

function configuredPlatformsByProfile() {
  const map = new Map();
  for (const account of publishAccountCatalog()) {
    for (const platform of account.platforms || []) {
      const alias = String(platform.profile_alias || platform.profile || '').trim();
      const platformId = String(platform.id || '').trim();
      if (!alias || !platformId || !platformSet.has(platformId)) continue;
      if (platform.collect_status === 'not_applicable' || platform.status === 'not_applicable') continue;
      if (!map.has(alias)) map.set(alias, new Set());
      map.get(alias).add(platformId);
    }
  }
  return map;
}

function actualProfileKey(summary) {
  return String(summary && (summary.resolvedProfile || (summary.profileState && summary.profileState.resolvedProfile) || summary.profile) || '').trim();
}

function platformFromSummaryName(name) {
  const match = String(name || '').match(/-(douyin|kuaishou|bilibili)-\d{14}\.json$/i);
  return match ? match[1].toLowerCase() : '';
}

function summaryPlatformIds(summary, fileName, configuredForProfile) {
  const ids = new Set();
  for (const item of Array.isArray(summary && summary.platforms) ? summary.platforms : []) {
    const id = String(item && (item.platform || item.id || item.platformId) || '').trim();
    if (id) ids.add(id);
  }
  for (const dataset of Array.isArray(summary && summary.datasets) ? summary.datasets : []) {
    const id = String(dataset && dataset.platform || '').trim();
    if (id) ids.add(id);
  }
  const fromName = platformFromSummaryName(fileName);
  if (fromName) ids.add(fromName);
  return Array.from(ids).filter(id => platformSet.has(id) && configuredForProfile.has(id));
}

function sameLogicalProfile(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (!a || !b || a === b) return true;
  const leftMeta = profileMeta[a];
  const rightMeta = profileMeta[b];
  return Boolean(leftMeta && rightMeta && leftMeta.accountId && leftMeta.accountId === rightMeta.accountId);
}

function classifyError(error) {
  const text = String(error || '').trim();
  if (/not connected|profile not connected|Browser profile/i.test(text)) {
    return { status: 'profile_not_connected', reason: text || 'profile not connected' };
  }
  if (/needs login|passport\.bilibili\.com\/login|login|unauthorized|forbidden|cookie|\u672a\u767b\u5f55|\u767b\u5f55|401|403/i.test(text)) {
    return { status: 'needs_login', reason: text || 'needs login' };
  }
  if (/timeout|\u8d85\u65f6/i.test(text)) {
    return { status: 'verify', reason: text || 'timeout, needs verify' };
  }
  return { status: 'verify', reason: text || 'needs verify' };
}

function setPlatform(profiles, profile, platform, patch) {
  if (!profile || !platform || !platformSet.has(platform)) return;
  if (!profiles[profile]) profiles[profile] = { platforms: {} };
  const previous = profiles[profile].platforms[platform] || {};
  if (
    previous.status === 'ready'
    && patch.status === 'verify'
    && /collected 0 rows/i.test(String(patch.reason || ''))
  ) {
    profiles[profile].platforms[platform] = Object.assign({}, previous, {
      zeroRowDatasets: Array.from(new Set([].concat(previous.zeroRowDatasets || [], patch.dataset || []).filter(Boolean))),
      lastCheckedAt: patch.lastCheckedAt || previous.lastCheckedAt || new Date().toISOString()
    });
    return;
  }
  if (
    previous.sourceSummary
    && patch.sourceSummary
    && previous.sourceSummary === patch.sourceSummary
    && previous.status === 'needs_login'
    && patch.status !== 'ready'
  ) {
    return;
  }
  profiles[profile].platforms[platform] = Object.assign({}, previous, patch, {
    lastCheckedAt: patch.lastCheckedAt || previous.lastCheckedAt || new Date().toISOString()
  });
}

function buildStatus() {
  const configured = configuredPlatformsByProfile();
  const profiles = {};
  const files = summaryFiles();
  for (const item of files) {
    const summary = safeReadJson(item.full);
    if (!summary) continue;
    const profile = String(summary.requestedProfile || summary.profile || '').trim();
    if (!configured.has(profile)) continue;
    const actualProfile = actualProfileKey(summary);
    const hasDatasets = Array.isArray(summary.datasets) && summary.datasets.length > 0;
    if (!hasDatasets && !sameLogicalProfile(profile, actualProfile)) continue;
    const checkedAt = summary.finishedAt || summary.startedAt || new Date(item.mtimeMs).toISOString();
    const configuredForProfile = configured.get(profile);
    const profileError = summary.profileState && summary.profileState.ok === false
      ? summary.profileState.error
      : (summary.skipped ? summary.skipReason || 'profile skipped' : '');
    if (profile && (summary.skipped || profileError) && !hasDatasets) {
      const classified = classifyError(profileError || 'profile not connected');
      const targetPlatforms = summaryPlatformIds(summary, item.name, configuredForProfile);
      for (const platform of (targetPlatforms.length ? targetPlatforms : Array.from(configuredForProfile))) {
        setPlatform(profiles, profile, platform, {
          status: classified.status === 'needs_login' ? 'profile_not_connected' : classified.status,
          reason: classified.reason,
          sourceSummary: item.full,
          lastCheckedAt: checkedAt
        });
      }
    }
    for (const dataset of summary.datasets || []) {
      const platform = String(dataset.platform || '').trim();
      if (!platformSet.has(platform)) continue;
      if (!configuredForProfile.has(platform)) continue;
      if (dataset.ok !== false && !dataset.skipped) {
        setPlatform(profiles, profile, platform, {
          status: Number(dataset.rows) === 0 ? 'verify' : 'ready',
          reason: Number(dataset.rows) === 0 ? 'collected 0 rows, needs verify' : '',
          dataset: dataset.dataset,
          rows: dataset.rows,
          sourceSummary: item.full,
          lastCheckedAt: checkedAt
        });
      } else {
        const classified = classifyError(dataset.error || dataset.message || '');
        setPlatform(profiles, profile, platform, {
          status: classified.status,
          reason: classified.reason,
          rows: dataset.rows,
          sourceSummary: item.full,
          lastCheckedAt: checkedAt
        });
      }
    }
  }
  return {
    ok: true,
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceSession: sessionPrefix || '',
    sourceDir: outDir,
    sourceSummaryCount: files.length,
    runnableStatuses: ['ready', 'verify'],
    blockedStatuses: ['needs_login', 'profile_not_connected'],
    profiles
  };
}

const status = buildStatus();
const counts = countStatuses(status);
if (preserveOnGlobalFailure && looksLikeGlobalFailure(status, counts)) {
  const diagnosticFile = outputFile.replace(/\.json$/i, '') + `.failed-${Date.now()}.json`;
  safeWriteJson(diagnosticFile, status);
  console.log(JSON.stringify({
    ok: true,
    preserved: true,
    reason: 'global collection failure; kept existing platform status',
    diagnosticFile,
    sourceSummaryCount: status.sourceSummaryCount,
    counts
  }, null, 2));
  process.exit(0);
}
safeWriteJson(outputFile, status);
console.log(JSON.stringify({
  ok: true,
  outputFile,
  sourceSummaryCount: status.sourceSummaryCount,
  profileCount: Object.keys(status.profiles).length,
  counts
}, null, 2));

function countStatuses(status) {
  const counts = {};
  for (const row of Object.values(status.profiles || {})) {
    for (const platform of Object.values(row.platforms || {})) {
      const key = platform.status || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function looksLikeGlobalFailure(status, counts) {
  const total = Object.values(counts || {}).reduce((sum, value) => sum + value, 0);
  if (total < 10) return false;
  if ((counts.ready || 0) > 0) return false;
  const reasons = [];
  for (const row of Object.values(status.profiles || {})) {
    for (const platform of Object.values(row.platforms || {})) {
      reasons.push(String(platform.reason || ''));
    }
  }
  const systemic = reasons.filter(reason => /chrome-error:\/\/chromewebdata|ERR_|Failed to fetch|Fatal process out of memory/i.test(reason)).length;
  return systemic / Math.max(1, reasons.length) >= 0.5;
}
