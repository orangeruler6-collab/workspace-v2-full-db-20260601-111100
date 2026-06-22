const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const rulesPath = path.join(__dirname, '..', 'src', 'modules', 'ops', 'profitTextRules.mjs');

function loadGroups() {
  const constantsPath = path.join(__dirname, '..', 'src', 'modules', 'ops', 'constants.js');
  const source = fs.readFileSync(constantsPath, 'utf8').replace(/export const /g, 'const ');
  return new Function(source + '; return GROUPS;')();
}

const defaultFixture = 'C:/Users/Administrator/.codex/attachments/a0a70044-886c-4423-8034-b915855fadc7/pasted-text.txt';
const fixturePath = process.argv[2] || defaultFixture;
async function main() {
const { parseProfitConfirmationText, splitConfirmationSamples } = await import(pathToFileURL(rulesPath).href);
const groups = loadGroups();
const text = fs.readFileSync(fixturePath, 'utf8');
const samples = splitConfirmationSamples(text);

const expected = [
  [{ account: '雷鸭Fist', fee: 12600, order_amount: 18000, rebate_amount: 5400, platform: 'B站', schedule: '2026年7月', lock_date: '2026-07-06' }],
  [{ account: '天机妹', fee: 12600, order_amount: 18000, rebate_amount: 5400, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-17' }],
  [
    { account: '有事找学姐', fee: 3920, order_amount: 5600, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-10' },
    { account: '麦小雯', fee: 3360, order_amount: 4800, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-10' },
    { account: '网瘾少女一条', fee: 4200, order_amount: 6000, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-10' },
  ],
  [
    { account: '天机妹', fee: 12600, order_amount: 18000, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-12' },
    { account: '报告砖家', fee: 11970, order_amount: 17100, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-17' },
  ],
  [{ account: '中二探长', fee: 13500, order_amount: 18000, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-24' }],
  [{ account: '薛定谔的机', fee: 9000, order_amount: 12000, rebate_amount: 3000, platform: 'B站', schedule: '2026年7月', lock_date: '2026-07-10' }],
  [{ account: '报告砖家', fee: 11970, order_amount: 17100, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-11' }],
  [{ account: '麦小雯', fee: 4800, order_amount: 4800, platform: '抖音', schedule: '2025年6月', lock_date: '2025-06-22' }],
  [
    { account: '天机妹', fee: 10500, order_amount: 15000, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-06' },
    { account: '花无缺', fee: 12250, order_amount: 17500, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-06' },
  ],
  [{ account: '雷鸭Fist', fee: 13500, order_amount: 18000, rebate_amount: 4500, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-16' }],
  [{ account: '硬件侠', fee: 16500, order_amount: 22000, rebate_amount: 5500, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-16' }],
  [{ account: '情风师兄', fee: 12750, order_amount: 17000, rebate_amount: 4250, platform: 'B站', schedule: '2025年11月', lock_date: '2025-11-30' }],
  [{ account: '超玩教授', fee: 2016, order_amount: 3200, platform: '抖音', schedule: '2026年6月', lock_date: '2026-06-01' }],
  [{ account: '雷鸭Fist', fee: 21000, order_amount: 18000, rebate_amount: 3000, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-15' }],
  [{ account: '超玩教授', fee: 2400, order_amount: 3150, platform: '快手', schedule: '2026年6月', lock_date: '2026-06-02', count: 3 }],
  [
    { account: '王路飞cp', fee: 13510, order_amount: 19300, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-14' },
    { account: '情风师兄', fee: 11900, order_amount: 17000, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-14' },
  ],
  [{ account: '痞仔伯爵', fee: 47850, order_amount: 40500, rebate_amount: 12650, platform: 'B站', schedule: '2026年6月', lock_date: '2026-06-23' }],
];

function comparable(record) {
  return {
    account: record.account,
    fee: Number(record.fee) || 0,
    order_amount: Number(record.order_amount) || 0,
    rebate_amount: Number(record.rebate_amount) || 0,
    platform: record.platform,
    schedule: record.schedule,
    lock_date: record.lock_date,
    count: Number(record.count) || 0,
  };
}

function assertEqual(actual, expectedValue, label, failures) {
  if (actual !== expectedValue) {
    failures.push(`${label}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actual)}`);
  }
}

const failures = [];
assertEqual(samples.length, expected.length, 'sample count', failures);

samples.forEach((sample, index) => {
  const actual = parseProfitConfirmationText(sample, { groups, selectedYear: 2026, selectedMonth: 6 }).map(comparable);
  const exp = expected[index] || [];
  assertEqual(actual.length, exp.length, `case ${index + 1} record count`, failures);
  exp.forEach((expectedRecord, recordIndex) => {
    const actualRecord = actual[recordIndex] || {};
    Object.entries(expectedRecord).forEach(([key, value]) => {
      assertEqual(actualRecord[key], value, `case ${index + 1} record ${recordIndex + 1} ${key}`, failures);
    });
  });
});

if (failures.length) {
  console.error(`profit rule parser failed: ${failures.length} mismatch(es)`);
  failures.slice(0, 40).forEach(item => console.error(' - ' + item));
  process.exit(1);
}

const totalRecords = expected.reduce((sum, item) => sum + item.length, 0);
console.log(`profit rule parser ok: ${samples.length} samples, ${totalRecords} records`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
