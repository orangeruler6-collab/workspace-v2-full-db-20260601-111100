const agentRoutes = require('../server/routes/agent.cjs');
const intent = agentRoutes._test;

const cases = [
  ['内容四组这周工作做得怎么样', 'weekly_report', '内容四组'],
  ['四组最近产出行不行，帮我看下', 'weekly_report', '内容四组'],
  ['帮我盘一下4组本周在忙啥', 'weekly_report', '内容四组'],
  ['内容二组这个月数据表现如何', 'weekly_report', '内容二组'],
  ['三组周会材料先帮我汇总', 'weekly_report', '内容三组'],
  ['看一下五组账号发布和涨粉', 'weekly_report', '内容五组'],
  ['六组本月流水毛利怎么样', 'weekly_report', '内容六组'],
  ['按内容二组格式生成本周周报', 'weekly_report', '内容二组'],
  ['读取这个飞书 BF 并分析 https://example.feishu.cn/docx/abc', 'bf_analysis', ''],
  ['帮我转写这个B站 https://www.bilibili.com/video/BV123', 'transcribe_link', ''],
  ['这个抖音链接提取文案 https://v.douyin.com/abc/', 'transcribe_link', ''],
  ['找一下类似案例和资料', 'research', '']
];

let failed = 0;
for (const [input, expectedTask, expectedGroup] of cases) {
  const got = intent.previewIntent(input);
  const okTask = got.task_type === expectedTask;
  const okGroup = !expectedGroup || got.group === expectedGroup;
  const ok = okTask && okGroup;
  if (!ok) failed += 1;
  console.log((ok ? 'OK ' : 'BAD') + JSON.stringify({
    input,
    task: got.task_type,
    group: got.group,
    work_summary: got.work_summary,
    platform_data: got.platform_data,
    expectedTask,
    expectedGroup
  }, null, 0));
}

if (failed) {
  console.error(`agent intent tests failed: ${failed}`);
  process.exit(1);
}
console.log(`agent intent tests passed: ${cases.length}`);
