const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const includeRoots = [
  'src/modules/AccountDataDashboardModule.vue',
  'src/modules/AccountDataAccountsModule.vue',
  'src/modules/account-data',
  'src/api/accountData.js',
  'server/routes/accountData.cjs',
  'server/lib/accountCatalog.cjs',
  'scripts/collect-account-data-batch.cjs',
  'scripts/collect-platform-data.cjs',
  'scripts/test-platform-logins.cjs',
  'package.json',
  '.env.example'
];

const skipDirNames = new Set([
  '.git',
  '.next',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'legacy-assets',
  'data',
  'artifacts',
  'tmp'
]);

const skipFiles = new Set([
  path.normalize('server/routes/videoPublish.cjs')
]);

const scanExtensions = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.vue',
  '.ts',
  '.tsx',
  '.json',
  '.md',
  '.css',
  '.html',
  '.py',
  '.ps1',
  '.bat',
  '.cmd'
]);

const suspiciousCodePoints = [
  0x93b6, 0x9359, 0x93c1, 0x93c3, 0x93c8, 0x93ac, 0x9350, 0x9351,
  0x9366, 0x9362, 0x9410, 0x9429, 0x9470, 0x704f, 0x6f70, 0x6d93,
  0x5a13, 0x95ab, 0x7490, 0x7e1b, 0x7e1c, 0x92e6, 0x9225
];

const suspiciousChars = suspiciousCodePoints.map(code => String.fromCharCode(code));
const slashU = String.fromCharCode(92, 117);
const nonAsciiPattern = new RegExp('[^\\t\\r\\n -~]', 'g');
const newlinePattern = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10));

const suspiciousFragments = [
  slashU + '93b6',
  slashU + '9359',
  slashU + '93c1',
  slashU + '93c3',
  slashU + '93c8',
  slashU + '6d93',
  slashU + '704f' + slashU + '4f80' + slashU + '6f70'
];

function shouldScan(file) {
  return scanExtensions.has(path.extname(file).toLowerCase()) || path.basename(file) === '.env.example';
}

function walk(target, files) {
  if (!fs.existsSync(target)) return files;
  const relative = path.normalize(path.relative(root, target));
  if (skipFiles.has(relative)) return files;
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    if (shouldScan(target)) files.push(target);
    return files;
  }
  if (!stat.isDirectory()) return files;
  const name = path.basename(target);
  if (skipDirNames.has(name)) return files;
  for (const child of fs.readdirSync(target)) {
    walk(path.join(target, child), files);
  }
  return files;
}

function linePreview(line) {
  return line
    .replace(new RegExp(String.fromCharCode(9), 'g'), ' ')
    .replace(nonAsciiPattern, char => slashU + char.charCodeAt(0).toString(16).padStart(4, '0'))
    .slice(0, 220);
}

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(newlinePattern);
  const hits = [];
  lines.forEach((line, index) => {
    const hasSuspiciousChar = suspiciousChars.some(char => line.includes(char));
    const hasSuspiciousFragment = suspiciousFragments.some(fragment => line.includes(fragment));
    if (!hasSuspiciousChar && !hasSuspiciousFragment) return;
    hits.push({ line: index + 1, preview: linePreview(line.trim()) });
  });
  return hits;
}

const files = includeRoots.flatMap(item => walk(path.join(root, item), []));
const findings = [];

for (const file of files) {
  const hits = scanFile(file);
  if (!hits.length) continue;
  findings.push({ file: path.relative(root, file), hits });
}

if (findings.length) {
  console.error('Encoding check failed. Suspected mojibake was found:');
  for (const finding of findings) {
    console.error('');
    console.error(finding.file);
    for (const hit of finding.hits.slice(0, 12)) {
      console.error('  ' + hit.line + ': ' + hit.preview);
    }
    if (finding.hits.length > 12) console.error('  ... ' + (finding.hits.length - 12) + ' more');
  }
  process.exitCode = 1;
} else {
  console.log('Encoding check passed (' + files.length + ' files scanned).');
}
