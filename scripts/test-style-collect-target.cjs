const assert = require('node:assert/strict');

require('tsx/cjs');

const { resolveCollectTarget } = require('../server/style-workbench/lib/collect-target.ts');

const douyinName = resolveCollectTarget('douyin', '最游话说');
assert.equal(douyinName.uidOrUrl, '');
assert.equal(douyinName.displayNameFallback, '最游话说');

const douyinUid = 'MS4wLjABAAAAZUKJwRmbGGOcLiS_HofhedIs978f5ak3k-uQi43dt00';
assert.equal(resolveCollectTarget('douyin', douyinUid).uidOrUrl, douyinUid);
assert.equal(
  resolveCollectTarget('douyin', `最游话说 https://www.douyin.com/user/${douyinUid}`).uidOrUrl,
  `https://www.douyin.com/user/${douyinUid}`
);

assert.equal(resolveCollectTarget('bilibili', '某某UP主').uidOrUrl, '');
assert.equal(resolveCollectTarget('bilibili', '12345678').uidOrUrl, '12345678');
assert.equal(
  resolveCollectTarget('bilibili', 'https://space.bilibili.com/12345678').uidOrUrl,
  'https://space.bilibili.com/12345678'
);

console.log('账号采集目标解析测试通过。');
