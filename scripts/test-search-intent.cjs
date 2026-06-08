const { extractSearchIntent } = require('../server/lib/searchIntent.cjs');

const cases = [
  {
    name: 'Faker Karina metaphor',
    text: '飞科和柳智敏广告这波很离谱，有人说像哥布林，但哥布林只是比喻，真正要找的是Faker和柳智敏同框、广告物料、粉丝剪辑相关画面。',
    mustInclude: ['Faker', '柳智敏'],
    mustExcludeFromQuery: ['哥布林']
  },
  {
    name: 'Korea China debate',
    text: '韩国人批评中国，引发外网热议，讨论卫星发射和国际体系位置。',
    mustIncludeAny: ['韩国', '中国'],
    mustIncludeQueryAny: ['韩国', '中国', '外网热议']
  },
  {
    name: 'MSN football trio',
    text: '一条视频带你了解世界最强三人组 MSN，梅西、内马尔、苏亚雷斯如何带巴萨拿到三冠王。',
    mustIncludeAny: ['MSN', '梅西', '巴萨'],
    mustExcludeFromQuery: ['视频']
  },
  {
    name: 'metaphor only weak',
    text: '这段文案只是说某个队伍像怪物一样强，但真正画面要找冠军比赛现场和观众欢呼。',
    mustExcludeFromQuery: ['怪物']
  },
  {
    name: 'generic workflow text',
    text: '背景搜索词 来源 一条视频带你了解 世界最强三人组，结构分析和素材总结。',
    mustExcludeFromQuery: ['背景搜索', '结构分析', '素材']
  },
  {
    name: 'English Chinese pair',
    text: 'Faker 与 Karina 同框广告花絮，粉丝做了很多二创剪辑。',
    mustIncludeAny: ['Faker', 'Karina', '柳智敏'],
    mustIncludeQueryAny: ['广告', '同框', '粉丝剪辑']
  }
];

let failed = 0;

function hasAny(list, terms) {
  const haystack = list.join(' ').toLowerCase();
  return terms.some(term => haystack.includes(String(term).toLowerCase()));
}

for (const item of cases) {
  const intent = extractSearchIntent(item.text, { queryLimit: 4, entityLimit: 6 });
  const queryText = [intent.query].concat(intent.queries || []).join(' ');
  const errors = [];

  (item.mustInclude || []).forEach(term => {
    if (!hasAny(intent.entities, [term]) && !queryText.toLowerCase().includes(String(term).toLowerCase())) {
      errors.push(`missing required term: ${term}`);
    }
  });

  if (item.mustIncludeAny && !hasAny(intent.entities.concat(intent.queries || []), item.mustIncludeAny)) {
    errors.push(`missing any of: ${item.mustIncludeAny.join(', ')}`);
  }

  if (item.mustIncludeQueryAny && !hasAny(intent.queries || [], item.mustIncludeQueryAny)) {
    errors.push(`query missing any of: ${item.mustIncludeQueryAny.join(', ')}`);
  }

  (item.mustExcludeFromQuery || []).forEach(term => {
    if (queryText.toLowerCase().includes(String(term).toLowerCase())) {
      errors.push(`query should not contain: ${term}`);
    }
  });

  const line = {
    name: item.name,
    query: intent.query,
    entities: intent.entities,
    intent_terms: intent.intent_terms,
    exclude_terms: intent.exclude_terms,
    confidence: intent.confidence
  };
  if (errors.length) {
    failed += 1;
    console.error('[FAIL]', JSON.stringify(line, null, 2));
    errors.forEach(error => console.error('  - ' + error));
  } else {
    console.log('[PASS]', JSON.stringify(line));
  }
}

if (failed) {
  console.error(`\n${failed} search intent case(s) failed.`);
  process.exit(1);
}

console.log('\nAll search intent cases passed.');
