const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'web-user-guide-illustrated.docx');
const TMP = path.join(ROOT, 'docs', 'web-user-guide-illustrated-src');
const IMG_DIR = path.join(ROOT, 'docs', 'guide-screenshots');

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipFolder(srcDir, outFile) {
  const files = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(srcDir);
  const chunks = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const full of files) {
    const rel = path.relative(srcDir, full).replace(/\\/g, '/');
    const name = Buffer.from(rel);
    const data = fs.readFileSync(full);
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    chunks.push(local, compressed);
    const cen = Buffer.alloc(46 + name.length);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(day, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(compressed.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    name.copy(cen, 46);
    central.push(cen);
    offset += local.length + compressed.length;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  fs.writeFileSync(outFile, Buffer.concat([...chunks, ...central, end]));
}

function run(text, opts = {}) {
  const props = [
    opts.bold ? '<w:b/>' : '',
    opts.color ? `<w:color w:val="${opts.color}"/>` : '',
    opts.size ? `<w:sz w:val="${opts.size}"/>` : ''
  ].filter(Boolean).join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function paragraph(text, style = '', opts = {}) {
  const pPr = [
    style ? `<w:pStyle w:val="${style}"/>` : '',
    opts.align ? `<w:jc w:val="${opts.align}"/>` : '',
    opts.shade ? `<w:shd w:fill="${opts.shade}"/>` : '',
    opts.border ? `<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${opts.border}"/></w:pBdr>` : ''
  ].filter(Boolean).join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${run(text, opts)}</w:p>`;
}

const p = paragraph;
const bullet = text => p(`• ${text}`, 'ListParagraph');
const step = (n, text) => p(`${n}. ${text}`, 'ListParagraph');
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function callout(text, kind = 'blue') {
  const map = {
    blue: ['EFF6FF', '60A5FA', '1E3A8A'],
    amber: ['FFFBEB', 'F59E0B', '92400E'],
    green: ['ECFDF5', '10B981', '065F46']
  };
  const [shade, border, color] = map[kind] || map.blue;
  return p(text, 'Callout', { shade, border, color });
}

function image(relId) {
  const cx = 9144000;
  const cy = 6350000;
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${relId.replace(/\D/g, '') || 1}" name="${relId}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${relId}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function table(rows) {
  const rowXml = rows.map((row, i) => `<w:tr>${row.map(cell => `<w:tc><w:tcPr><w:tcW w:w="2500" w:type="dxa"/><w:shd w:fill="${i === 0 ? 'DBEAFE' : 'FFFFFF'}"/></w:tcPr>${p(cell, '', i === 0 ? { bold: true, color: '1E3A8A' } : {})}</w:tc>`).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="10000" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D1D5DB"/><w:left w:val="single" w:sz="4" w:color="D1D5DB"/><w:bottom w:val="single" w:sz="4" w:color="D1D5DB"/><w:right w:val="single" w:sz="4" w:color="D1D5DB"/><w:insideH w:val="single" w:sz="4" w:color="E5E7EB"/><w:insideV w:val="single" w:sz="4" w:color="E5E7EB"/></w:tblBorders></w:tblPr>${rowXml}</w:tbl>`;
}

function moduleSection({ title, relId, caption, goal, steps, tips, calloutText, calloutKind = 'blue' }) {
  const out = [p(title, 'Heading1'), image(relId), p(caption, 'Caption'), p('这个模块用来做什么', 'Heading2'), p(goal)];
  out.push(p('推荐操作步骤', 'Heading2'));
  steps.forEach((text, idx) => out.push(step(idx + 1, text)));
  out.push(p('使用要点', 'Heading2'));
  tips.forEach(text => out.push(bullet(text)));
  if (calloutText) out.push(callout(calloutText, calloutKind));
  return out;
}

const body = [];
body.push(p('乌萨奇工作平台', 'CoverTitle', { align: 'center' }));
body.push(p('Web 使用教程 · 图文培训版', 'CoverSub', { align: 'center' }));
body.push(p('适用：内容选题 / 文案生成 / 排期协作 / 后期发布 / 运营复盘', '', { align: 'center', color: '6B7280' }));
body.push(callout('主线流程：账号热榜发现机会 → 文案工作流拆解生成 → 排期看板交接 → 后期处理 → 视频发布 → 数据复盘', 'blue'));
body.push(pageBreak());

body.push(p('01 快速上手', 'Heading1'));
body.push(table([
  ['场景', '应该去哪里', '一句话说明'],
  ['找爆款/找选题', '账号热榜 / 每日热点', '看近期新内容和异常增长，把可做内容送进工作流。'],
  ['视频或 BF 出脚本', '文案工作流', '支持视频链接、飞书链接、PDF/Word、商单 BF。'],
  ['单条转写/评论', '文案工具', '适合抖音/B 站转写、评论素材、向量搜索。'],
  ['团队任务流转', '排期看板', '按人/按周排任务，拖拽交接会全局提醒。'],
  ['素材沉淀', '素材库', '上传、分类、AI 打标、加入剪辑篮。'],
  ['发布准备', '视频发布', '上传视频、填标题简介、选择账号平台、生成发布任务。']
]));
body.push(callout('右下角乌萨奇 AI 是全局入口：可以问模块怎么用、让它切到工作流、辅助分析数据，但正式输出仍建议在对应模块内复核。', 'green'));
body.push(pageBreak());

body.push(...moduleSection({
  title: '02 账号热榜：从账号池发现可做内容',
  relId: 'rIdImg1',
  caption: '图 1：账号热榜真实页面。左侧为模块导航，中间是榜单，右侧是筛选和账号池。',
  goal: '账号热榜用于监控抖音、B 站等账号的新内容，把近期表现好、增长异常、值得参考的内容排到前面。',
  steps: ['点击「扫描账号池」拉取账号池最新内容。', '查看榜单前几名，重点看发布时间、平台、点赞/播放/评论等指标。', '用右侧筛选按平台、分区、关键词缩小范围。', '看到合适内容后点击「进工作流」，把链接带入文案工作流。'],
  tips: ['同一作品不会重复入库，重复扫描只更新可抓到的数据。', 'B 站优先看播放量和点赞，抖音优先看点赞/评论等可返回字段。', '近期发布内容权重更高，老内容会进入历史归档。'],
  calloutText: '不要只看热度数字，要同时判断“是否适合账号定位”和“能否改成我们的表达”。',
  calloutKind: 'amber'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '03 文案工作流：从素材/BF 到脚本',
  relId: 'rIdImg2',
  caption: '图 2：文案工作流真实页面。节点按输入、采集、分析、搜索、汇总、创意等步骤连接。',
  goal: '文案工作流适合复杂脚本生产，支持素材链接、飞书链接、商单 BF、PDF/Word 文件和手动补充要求。',
  steps: ['在输入源选择「素材输入」或「商单 BF」。', '素材输入可填抖音/B 站/飞书链接；商单 BF 可拖拽 PDF/Word 或选择文件。', '按节点顺序运行：输入源、转写/解析、汇总、背景搜索、分析报告、确认创意、生成文案。', '生成文案后人工检查事实、品牌要求、平台风险，再进入排期或发布。'],
  tips: ['背景搜索只做补充，不要把未证实传闻当事实。', '客户 BF、转写原文、飞书文档优先级高于外部搜索。', '扫描版 PDF 可能需要 OCR；能用 Word 或文字版 PDF 更稳定。'],
  calloutText: '商单 BF 一定要补充品牌禁忌、卖点、平台、目标账号和交付形式，否则脚本容易泛。',
  calloutKind: 'blue'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '04 排期看板：任务分配、交接和完成确认',
  relId: 'rIdImg3',
  caption: '图 3：排期看板真实页面。可以按人或按周查看任务。',
  goal: '排期看板用于团队协作。文案、后期、运营可以在这里看到任务归属、日期、账号和完成状态。',
  steps: ['选择组别后，默认按人查看每个人任务。', '点击「+ 添加」给成员新增任务。', '文案写完后，把任务卡拖到后期同事名下完成交接。', '被交接人会收到全局弹窗「您收到新的订单」。', '后期完成后点击任务卡上的勾号。'],
  tips: ['支持 Ctrl+Z 或「撤销」回退上一步。', '按周视图适合检查账号和日期分布。', 'AI 导入适合一次性拆分多条素材代做任务。'],
  calloutText: '交接尽量用拖拽完成，不要只口头说；这样系统会自动通知对方，也方便后续追踪。',
  calloutKind: 'green'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '05 文案工具：轻量转写、评论和检索',
  relId: 'rIdImg4',
  caption: '图 4：文案工具真实页面。适合单条素材的快速处理。',
  goal: '文案工具适合轻量任务：抖音转写、B 站转写、评论素材生成、向量搜索。',
  steps: ['粘贴抖音/B 站链接并运行。', '转写完成后可点击「生成文案」或「清洗分段」。', '评论素材区可粘贴脚本，选择数量和账号风格后生成评论。', '向量搜索可输入关键词，检索历史文案和案例。'],
  tips: ['复杂多节点脚本建议走文案工作流。', '评论素材生成后建议人工筛掉重复、夸张或不合适表达。', '向量搜索词越具体，命中越好。'],
  calloutText: '文案工具适合快处理，文案工作流适合完整生产，不要混用导致流程断掉。',
  calloutKind: 'blue'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '06 素材库：统一管理素材和标签',
  relId: 'rIdImg5',
  caption: '图 5：素材库真实页面。用于上传、筛选、预览和管理文件。',
  goal: '素材库用于统一管理视频、图片、音频、文档等素材，避免素材散落在聊天记录和本地文件夹里。',
  steps: ['上传素材或新建文件夹。', '给素材补充名称、分类、标签。', '需要时点击 AI 标签辅助识别。', '把要交给后期的素材加入剪辑篮。'],
  tips: ['素材入库时就补标签，后续搜索会省很多时间。', '重要素材不要只靠文件名识别。', '删除前确认是否还有排期或发布任务引用。'],
  calloutText: '素材库的价值在于“可搜索、可复用、可交接”，不是简单网盘。',
  calloutKind: 'green'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '07 AI 生图：生成封面和视觉参考',
  relId: 'rIdImg6',
  caption: '图 6：AI 生图真实页面。支持文生图、图生图和历史记录。',
  goal: 'AI 生图用于生成封面图、视觉参考、角色草图和创意素材。',
  steps: ['选择文生图或图生图。', '输入清晰的画面描述，图生图需要先上传参考图。', '选择模型、比例和数量。', '点击开始生成，完成后下载或复制链接。'],
  tips: ['提示词要包含主体、风格、构图、颜色和用途。', '用于对外发布前必须人工复核版权、品牌和视觉风险。', '历史记录可以复用参数，方便继续迭代。'],
  calloutText: '生成图更适合做提案、封面参考和内部素材，正式发布前要过人工审核。',
  calloutKind: 'amber'
}));
body.push(pageBreak());

body.push(...moduleSection({
  title: '08 视频发布：整理发布信息并生成任务',
  relId: 'rIdImg7',
  caption: '图 7：视频发布真实页面。左侧上传视频，中间填写发布信息，右侧选择账号与平台。',
  goal: '视频发布模块用于把视频、标题、简介、标签、账号和平台整理成发布任务。',
  steps: ['上传本地视频，或从素材库导入。', '填写标题、简介、标签和封面信息。', '选择发布账号和平台。', '点击「生成发布任务」。'],
  tips: ['标题建议 10-30 字，优先表达看点。', '简介里可以补充互动引导。', 'AI 推荐可先生成一版，但发布前仍要人工检查。'],
  calloutText: '当前模块主要负责生成发布任务；后端接入 OpenCLI 后，可继续打开对应平台发布流程。',
  calloutKind: 'blue'
}));
body.push(pageBreak());

body.push(p('09 常见问题与处理方式', 'Heading1'));
body.push(p('飞书链接读不了', 'Heading2'));
body.push(bullet('确认当前账号有文档权限。'));
body.push(bullet('确认飞书授权未过期。'));
body.push(bullet('确认链接是正文文档，不是无权限分享页。'));
body.push(p('PDF 解析失败', 'Heading2'));
body.push(bullet('优先使用 Word 或可复制文字版 PDF。'));
body.push(bullet('扫描版 PDF 需要 OCR；如果失败，先把正文粘贴到补充文本。'));
body.push(p('热榜字段缺失', 'Heading2'));
body.push(bullet('不同平台可抓取数据不同，系统只展示稳定返回的字段。'));
body.push(p('文案生成卡住', 'Heading2'));
body.push(bullet('先重新运行当前节点，不要直接重置全流程。'));
body.push(bullet('检查输入源、链接、BF 文件是否可读。'));
body.push(callout('如果页面看起来异常，先刷新当前页；如果是接口错误，再联系管理员查看后端日志。', 'amber'));

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, '_rels'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'word', '_rels'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'word', 'media'), { recursive: true });

const imgFiles = [
  '01-account-hot-board.png',
  '02-workflow.png',
  '03-schedule.png',
  '04-tools.png',
  '05-materials.png',
  '06-imagegen.png',
  '07-video-publish.png'
];
imgFiles.forEach((name, idx) => fs.copyFileSync(path.join(IMG_DIR, name), path.join(TMP, 'word', 'media', `image${idx + 1}.png`)));

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="95" w:line="292" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:color w:val="111827"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CoverTitle"><w:name w:val="Cover Title"/><w:pPr><w:spacing w:before="1200" w:after="220"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="48"/><w:color w:val="111827"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CoverSub"><w:name w:val="Cover Subtitle"/><w:pPr><w:spacing w:after="320"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:sz w:val="28"/><w:color w:val="2563EB"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="28"/><w:color w:val="1D4ED8"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="90"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="22"/><w:color w:val="374151"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="60"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="150"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:i/><w:sz w:val="18"/><w:color w:val="6B7280"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Callout"><w:name w:val="Callout"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="120" w:after="150"/></w:pPr><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei"/><w:b/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;

const rels = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>', ...imgFiles.map((_, idx) => `<Relationship Id="rIdImg${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${idx + 1}.png"/>`)].join('');

fs.writeFileSync(path.join(TMP, '[Content_Types].xml'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
fs.writeFileSync(path.join(TMP, '_rels', '.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
fs.writeFileSync(path.join(TMP, 'word', '_rels', 'document.xml.rels'), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
fs.writeFileSync(path.join(TMP, 'word', 'document.xml'), documentXml);
fs.writeFileSync(path.join(TMP, 'word', 'styles.xml'), stylesXml);
zipFolder(TMP, OUT);
console.log(OUT);
