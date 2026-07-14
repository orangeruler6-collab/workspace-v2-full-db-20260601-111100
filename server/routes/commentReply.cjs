const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sqlite3 = require('sqlite3');
const createLogger = require('../lib/logger.cjs');
const {
  chromeProfileDirectoryMap,
  openCliBrowserProfileAliases,
  publishAccountCatalog,
  readAccountPlatformStatus
} = require('../lib/accountCatalog.cjs');

const logger = createLogger('routes:commentReply');
const chromeProfileByOpenCli = chromeProfileDirectoryMap();
const openCliExtensionDir = process.env.OPENCLI_EXTENSION_DIR
  || path.join(process.env.USERPROFILE || '', '.opencli', 'chrome-extension', 'opencli-webstore-unpacked');

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function text(value) {
  return String(value || '').trim();
}

function num(value) {
  return Number(value) || 0;
}

function json(value) {
  return JSON.stringify(value === undefined ? null : value);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (e) {
    return fallback;
  }
}

function normalize(value) {
  return text(value).replace(/\s+/g, '').toLowerCase();
}

const testAccountNames = [
  '麦小雯',
  '麦晓雯',
  '天机妹',
  '最翁',
  '最翁damn',
  '最游话说',
  '木游话说',
  '花无缺',
  '报告砖家',
  '策划克星阿强'
];
const testAccountKeys = testAccountNames.map(normalize);

function testAccountMeta(account) {
  const haystack = [
    account.id,
    account.name,
    account.dashboardName,
    account.owner,
    ...(account.profileAliases || [])
  ].map(normalize).join('|');
  const index = testAccountKeys.findIndex(function(key) { return key && haystack.indexOf(key) >= 0; });
  return {
    isTest: index >= 0,
    rank: index >= 0 ? index : 999,
    label: index >= 0 ? testAccountNames[Math.min(index, testAccountNames.length - 1)] : ''
  };
}

function shortId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.run(sql, params || [], function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.get(sql, params || [], function(err, row) {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

function all(db, sql, params) {
  return new Promise(function(resolve, reject) {
    db.all(sql, params || [], function(err, rows) {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function execFile(command, args, options) {
  return new Promise(function(resolve) {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(function() {
      child.kill();
    }, options.timeoutMs || 30000);
    child.stdout.on('data', function(chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function(chunk) { stderr += chunk.toString(); });
    child.on('error', function(error) {
      clearTimeout(timer);
      resolve({ code: 1, stdout: stdout, stderr: stderr + '\n' + error.message });
    });
    child.on('close', function(code) {
      clearTimeout(timer);
      resolve({ code: code || 0, stdout: stdout, stderr: stderr });
    });
  });
}

function waitMs(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function openCliMain() {
  return process.env.OPENCLI_MAIN
    || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', 'node_modules', '@jackwener', 'opencli', 'dist', 'src', 'main.js');
}

function openCliCommand() {
  const main = openCliMain();
  if (fs.existsSync(main)) return { command: process.execPath, prefix: [main] };
  const cmd = process.env.OPENCLI_BIN || path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming'), 'npm', process.platform === 'win32' ? 'opencli.cmd' : 'opencli');
  if (fs.existsSync(cmd)) return { command: cmd, prefix: [] };
  return null;
}

function chromeBin() {
  const candidates = [
    process.env.CHROME_BIN,
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(function(item) { return fs.existsSync(item); }) || candidates[0] || 'chrome.exe';
}

function chromeUserDataDir() {
  return process.env.CHROME_USER_DATA_DIR
    || path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'Google', 'Chrome', 'User Data');
}

function resolveChromeProfileDirectory(account) {
  const accountId = text(account && account.accountId);
  const profileAlias = text(account && account.profileAlias);
  if (chromeProfileByOpenCli[accountId]) return chromeProfileByOpenCli[accountId];
  if (chromeProfileByOpenCli[profileAlias]) return chromeProfileByOpenCli[profileAlias];
  if (account && account.chromeProfileDirectory) return account.chromeProfileDirectory;
  return '';
}

function launchChromeProfile(profileDirectory, url) {
  return new Promise(function(resolve) {
    if (!profileDirectory) {
      resolve({ ok: false, error: '缺少 Chrome Profile 目录' });
      return;
    }
    const hasOpenCliExtension = fs.existsSync(path.join(openCliExtensionDir, 'manifest.json'));
    const args = [
      '--new-window',
      '--user-data-dir=' + chromeUserDataDir(),
      '--no-first-run',
      '--no-default-browser-check',
      '--profile-directory=' + profileDirectory
    ];
    if (hasOpenCliExtension) args.push('--load-extension=' + openCliExtensionDir);
    args.push(url || 'about:blank');
    try {
      const child = spawn(chromeBin(), args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      resolve({ ok: true, profile_directory: profileDirectory, extension_dir: hasOpenCliExtension ? openCliExtensionDir : '' });
    } catch (error) {
      resolve({ ok: false, error: error.message || String(error), profile_directory: profileDirectory });
    }
  });
}

function closeChromeProfile(profileDirectory) {
  return new Promise(function(resolve) {
    if (!profileDirectory) return resolve({ ok: false, error: 'missing profile directory' });
    const escaped = String(profileDirectory).replace(/'/g, "''");
    const script = [
      "$needle='--profile-directory=" + escaped + "';",
      "$needleQuoted='--profile-directory=\"" + escaped + "\"';",
      "Get-CimInstance Win32_Process -Filter \"name = 'chrome.exe'\" |",
      "Where-Object { $_.CommandLine -like \"*$needle*\" -or $_.CommandLine -like \"*$needleQuoted*\" } |",
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }"
    ].join(' ');
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', function(chunk) { stdout += chunk.toString(); });
    child.stderr.on('data', function(chunk) { stderr += chunk.toString(); });
    child.on('error', function(error) { resolve({ ok: false, error: error.message || String(error), profile_directory: profileDirectory }); });
    child.on('close', function(code) {
      resolve({ ok: code === 0, code: code || 0, stdout: stdout.trim(), stderr: stderr.trim(), profile_directory: profileDirectory });
    });
  });
}

function extractJsonOutput(output) {
  const value = text(output);
  if (!value) return null;
  try { return JSON.parse(value); } catch (e) {}
  const start = value.search(/[\[{]/);
  if (start >= 0) {
    const opener = value[start];
    const closer = opener === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const char = value[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === opener) depth += 1;
      if (char === closer) {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(value.slice(start, index + 1)); } catch (e) {}
          break;
        }
      }
    }
  }
  const line = value.split(/\r?\n/).reverse().find(function(item) {
    return /^[\[{]/.test(item.trim());
  });
  if (!line) return null;
  try { return JSON.parse(line); } catch (e) { return null; }
}

function parseOpenCliProfiles(output) {
  let disconnected = false;
  return String(output || '').split(/\r?\n/).map(function(line) {
    const raw = text(line);
    if (!raw || /^Update available:|^Run:|^Download:|^Extension update available:/i.test(raw)) return null;
    if (/No Browser Bridge profiles connected|Open a Chrome profile/i.test(raw)) return null;
    if (/Disconnected saved profiles/i.test(raw)) {
      disconnected = true;
      return null;
    }
    if (/Connected Browser Bridge profiles/i.test(raw)) {
      disconnected = false;
      return null;
    }
    const parts = raw.split(/\s+(?:—|–|-)\s+/);
    const left = parts.length >= 2 ? parts[0].trim() : (raw.match(/^(\S+(?:\s+\S+)?)\s+/) || [])[1] || '';
    const rest = parts.length >= 2 ? parts.slice(1).join(' - ').trim() : raw.slice(left.length).trim();
    if (!left) return null;
    const leftMatch = left.match(/^(\S+)(?:\s+(.*))?$/);
    if (!leftMatch) return null;
    const alias = leftMatch[2] || (rest.match(/alias[:：]\s*([^\s]+)/i) || [])[1] || leftMatch[1];
    return {
      context_id: leftMatch[1],
      alias: alias,
      connected: !disconnected && /connected/i.test(rest) && !/not connected|disconnected/i.test(rest),
      raw: raw
    };
  }).filter(Boolean);
}

async function listOpenCliProfiles() {
  const cli = openCliCommand();
  if (!cli) return [];
  const result = await execFile(cli.command, cli.prefix.concat(['profile', 'list']), {
    cwd: path.join(__dirname, '..', '..'),
    timeoutMs: 20000
  });
  return parseOpenCliProfiles([result.stdout, result.stderr].filter(Boolean).join('\n'));
}

async function ensureOpenCliProfile(account, url) {
  const aliases = openCliBrowserProfileAliases();
  const requested = text(account && account.profileAlias);
  const resolved = aliases[requested] || requested;
  if (!resolved) throw new Error('该账号未绑定 opencli profile');
  const profiles = await listOpenCliProfiles();
  const already = profiles.find(function(item) {
    return item.connected && (item.alias === requested || item.alias === resolved || item.context_id === requested || item.context_id === resolved);
  });
  if (already) return { profile: already.context_id || already.alias || resolved, launched: false };
  const profileDirectory = resolveChromeProfileDirectory(account);
  if (!profileDirectory) throw new Error('未配置 Chrome Profile 目录，无法拉起账号浏览器');
  const launched = await launchChromeProfile(profileDirectory, url || 'about:blank');
  if (!launched.ok) throw new Error(launched.error || 'Chrome Profile 拉起失败');
  const deadline = Date.now() + Number(process.env.COMMENT_REPLY_PROFILE_CONNECT_TIMEOUT_MS || 90000);
  while (Date.now() < deadline) {
    await waitMs(3000);
    const next = await listOpenCliProfiles();
    const matched = next.find(function(item) {
      return item.connected && (item.alias === requested || item.alias === resolved || item.context_id === requested || item.context_id === resolved);
    }) || next.find(function(item) {
      return item.connected && item.context_id && !profiles.some(function(prev) { return prev.context_id === item.context_id; });
    });
    if (matched) return { profile: matched.context_id || matched.alias || resolved, launched: true, profileDirectory: profileDirectory };
  }
  throw new Error('OpenCLI Browser Bridge 未连接：' + resolved);
}

async function ensureBrowserSession(account, session, url) {
  const requested = text(account && account.profileAlias);
  if (!requested) throw new Error('该账号未绑定 opencli profile');
  let state = { profile: requested, launched: false };
  let opened = null;
  try {
    opened = await browserOpen(requested, session, url);
    return { profile: requested, session: session, opened: opened, launched: false, profileDirectory: '' };
  } catch (firstError) {
    if (!/not connected|Browser profile|Browser Bridge|opencli profile use|No Browser Bridge/i.test(firstError.message || String(firstError))) {
      throw firstError;
    }
    state = await ensureOpenCliProfile(account, url);
    opened = await browserOpen(state.profile, session, url);
    return {
      profile: state.profile,
      session: session,
      opened: opened,
      launched: Boolean(state.launched),
      profileDirectory: state.profileDirectory || ''
    };
  }
}

async function runOpenCli(profileAlias, args, timeoutMs) {
  const cli = openCliCommand();
  if (!cli) throw new Error('未找到 opencli，无法连接抖音创作者后台');
  const profile = text(profileAlias);
  if (!profile) throw new Error('该账号未绑定 opencli profile');
  const result = await execFile(cli.command, cli.prefix.concat(['--profile', profile]).concat(args), {
    cwd: path.join(__dirname, '..', '..'),
    timeoutMs: timeoutMs || 45000
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (result.code !== 0) {
    throw new Error((output || 'opencli 执行失败').slice(0, 1200));
  }
  return output;
}

async function withCommentBrowser(account, url, task) {
  const session = 'comment-reply-' + text(account.accountId || account.profileAlias).replace(/[^a-z0-9_-]/gi, '-').slice(0, 32);
  const state = await ensureBrowserSession(account, session, url);
  try {
    return await task(state.profile, session, state.opened || {});
  } finally {
    await runOpenCli(state.profile, ['browser', session, 'close'], 20000).catch(function() { return null; });
    if (state.launched && state.profileDirectory) await closeChromeProfile(state.profileDirectory).catch(function() { return null; });
  }
}

function accountRows() {
  const status = readAccountPlatformStatus();
  return publishAccountCatalog().flatMap(function(account) {
    const platformRows = (account.platforms || []).map(function(platform) {
      const profileAlias = platform.profile_alias || platform.profile || '';
      const platformStatus = status.profiles && status.profiles[profileAlias] && status.profiles[profileAlias].platforms
        ? status.profiles[profileAlias].platforms[platform.id]
        : null;
      const loginStatus = platformStatus && (platformStatus.status || platformStatus.collect_status) || platform.login_status || platform.status || 'unknown';
      return {
        id: platform.id,
        label: platform.name || platform.id,
        handle: platform.handle || '',
        profileAlias: profileAlias,
        chromeProfileDirectory: platform.chrome_profile_directory || '',
        loginStatus: loginStatus,
        loginReason: platformStatus && platformStatus.reason || platform.collect_status_reason || '',
        checkedAt: platformStatus && platformStatus.lastCheckedAt || platform.collect_status_checked_at || '',
        runnable: platform.runnable !== false
      };
    });
    return (account.platforms || [])
      .filter(function(platform) { return platform.id === 'douyin'; })
      .map(function(platform) {
        const testMeta = testAccountMeta(account);
        const profileAlias = platform.profile_alias || platform.profile || '';
        const platformStatus = status.profiles && status.profiles[profileAlias] && status.profiles[profileAlias].platforms
          ? status.profiles[profileAlias].platforms.douyin
          : null;
        return {
          accountId: account.id,
          accountName: account.dashboardName || account.name,
          avatar: account.avatar || text(account.dashboardName || account.name).slice(0, 1),
          groupName: account.groupName || '',
          groupId: Number(account.groupId) || 0,
          owner: account.owner || '',
          description: account.description || '',
          styleHint: account.styleHint || '',
          dataProfileAlias: account.dataProfileAlias || '',
          dataProfileDirectory: account.dataProfileDirectory || '',
          profileAliases: account.profileAliases || [],
          platforms: platformRows,
          platform: 'douyin',
          platformHandle: platform.handle || '',
          profileAlias: profileAlias,
          chromeProfileDirectory: platform.chrome_profile_directory || '',
          loginStatus: platformStatus && (platformStatus.status || platformStatus.collect_status) || platform.login_status || 'unknown',
          loginReason: platformStatus && platformStatus.reason || platform.collect_status_reason || '',
          loginCheckedAt: platformStatus && platformStatus.lastCheckedAt || platform.collect_status_checked_at || '',
          runnable: platform.runnable !== false,
          testRecommended: account.id === 'maixiaohua' || /麦小雯|麦晓雯/.test(String(account.name || '') + String(account.dashboardName || '')),
          testCohort: testMeta.isTest,
          testRank: testMeta.rank,
          testLabel: testMeta.label
        };
      });
  });
}

function riskReason(commentText) {
  const raw = text(commentText);
  const compact = normalize(raw);
  const risks = [
    [/https?:\/\/|www\.|\.com|\.cn|加v|加微|微信|vx|qq|私信|主页|链接|联系方式|电话|手机号|群|二维码/i, '包含链接或联系方式'],
    [/傻|滚|垃圾|骗子|诈骗|脑残|死|妈|爹|sb|操|艹|投诉|举报|维权|侵权|赔|退款|售后|客服|差评|拉黑/i, '包含辱骂、投诉或售后风险'],
    [/多少钱|价格|报价|商务|合作|广告|推广|接单|商单|买|卖|下单|佣金|返点|合同/i, '包含商务或价格问题'],
    [/政治|疫情|医疗|医院|医生|法律|律师|法院|警察|赌博|贷款|投资|股票|基金|成人|色情|未成年/i, '包含敏感领域'],
    [/身份证|银行卡|地址|密码|验证码|隐私/i, '包含隐私或账号安全词']
  ];
  if (!raw) return '评论为空';
  if (raw.length > 40) return '评论过长，需人工判断';
  if (compact.length < 2) return '评论过短，需人工判断';
  for (const item of risks) {
    if (item[0].test(raw)) return item[1];
  }
  return '';
}

function suggestReply(commentText, accountName, style) {
  const value = text(commentText);
  const tone = text(style) || 'natural';
  const replies = {
    urge: {
      natural: '收到收到，后面继续安排，感谢催更！',
      warm: '催更收到！后面继续安排，感谢一直蹲更新。',
      restrained: '收到，后续会继续更新，感谢关注。'
    },
    laugh: {
      natural: '哈哈哈懂你，这段确实有点意思。',
      warm: '哈哈哈你也太会抓重点了，这段确实好玩。',
      restrained: '哈哈，这段确实有点意思，感谢评论。'
    },
    like: {
      natural: '谢谢喜欢，也欢迎多来评论区玩。',
      warm: '谢谢喜欢！看到这样的评论真的很开心。',
      restrained: '感谢喜欢，后续会继续更新。'
    },
    agree: {
      natural: '太真实了，评论区很多人也有同感。',
      warm: '是吧，这点真的很多人都有同感。',
      restrained: '确实，很多朋友也有类似感受。'
    },
    checkin: {
      natural: '前排抓到，感谢来打卡。',
      warm: '前排抓到！感谢来打卡，欢迎常来。',
      restrained: '收到打卡，感谢关注。'
    },
    fallback: {
      natural: '谢谢评论，后面继续更新。',
      warm: '谢谢你来评论，后面继续更新，常来玩。',
      restrained: '感谢评论，后续会继续更新。'
    }
  };
  const pick = function(type) {
    return (replies[type] && (replies[type][tone] || replies[type].natural)) || replies.fallback.natural;
  };
  if (/催更|更新|下一集|快更|还想看/.test(value)) return pick('urge');
  if (/哈哈|笑|绷不住|乐|有意思|好玩/.test(value)) return pick('laugh');
  if (/支持|喜欢|爱看|不错|可以|厉害|牛|赞/.test(value)) return pick('like');
  if (/真实|太真|确实|同感|一样/.test(value)) return pick('agree');
  if (/第一|来了|打卡|前排/.test(value)) return pick('checkin');
  return pick('fallback');
}

function classifyComment(comment, options) {
  options = options || {};
  const content = text(comment.content || comment.commentText || comment.text);
  const reason = riskReason(content);
  return {
    riskLevel: reason ? 'manual' : 'safe',
    riskReason: reason,
    suggestedReply: suggestReply(content, comment.accountName || '', options.replyStyle)
  };
}

function normalizeComment(raw, account, options) {
  options = options || {};
  const content = text(raw.content || raw.commentText || raw.text || raw.comment || raw.comment_content);
  const commentId = text(raw.commentId || raw.comment_id || raw.id || raw.cid) || shortId('comment');
  const videoId = text(raw.videoId || raw.video_id || raw.awemeId || raw.aweme_id || raw.itemId || raw.item_id);
  const videoTitle = text(raw.videoTitle || raw.video_title || raw.title || raw.desc) || text(options.videoKeyword);
  const authorName = text(raw.authorName || raw.author || raw.userName || raw.nickname || raw.user);
  const createdAt = text(raw.createdAt || raw.createTime || raw.create_time || raw.time);
  const classified = classifyComment({ content: content, accountName: account && account.accountName }, options);
  return {
    id: `${account.accountId || 'douyin'}-${commentId}`,
    accountId: account.accountId,
    accountName: account.accountName,
    groupName: account.groupName,
    platform: 'douyin',
    profileAlias: account.profileAlias,
    videoId: videoId,
    videoTitle: videoTitle,
    commentId: commentId,
    commentText: content,
    authorName: authorName,
    createdAtText: createdAt,
    suggestedReply: classified.suggestedReply,
    riskLevel: classified.riskLevel,
    riskReason: classified.riskReason,
    status: classified.riskLevel === 'safe' ? 'planned' : 'manual'
  };
}

async function browserOpen(profileAlias, session, url) {
  const output = await runOpenCli(profileAlias, ['browser', session, 'open', url], 90000);
  return extractJsonOutput(output) || {};
}

async function browserEval(profileAlias, session, page, source, timeoutMs) {
  const args = ['browser', session, 'eval'];
  if (page && page !== 'active') args.push('--tab', page);
  args.push(source);
  const output = await runOpenCli(profileAlias, args, timeoutMs || 45000);
  return extractJsonOutput(output);
}

async function collectFromDouyin(account, limit, options) {
  options = options || {};
  const pageUrl = 'https://creator.douyin.com/creator-micro/interactive/comment';
  return withCommentBrowser(account, pageUrl, async function(profile, session, opened) {
    const page = opened.page || opened.tab || opened.tabId || opened.id || 'active';
    await waitMs(5000);
    const source = `(() => {
    const bodyText = document.body ? document.body.innerText : '';
    const targetKeyword = ${JSON.stringify(text(options.videoKeyword))};
    const loginBlocked = /登录|验证码|安全验证|扫码|账号密码/.test(bodyText) && !/评论管理|互动管理|回复/.test(bodyText);
    if (loginBlocked) return { ok: false, error: '抖音创作者后台需要登录或验证', items: [] };
    const lines = bodyText.split(/\\n+/).map(item => item.replace(/\\s+/g, ' ').trim()).filter(Boolean);
    const items = [];
    const timePattern = /^(刚刚|\\d+分钟前|\\d+小时前|昨天|前天|\\d{4}年\\d{1,2}月\\d{1,2}日|\\d{1,2}-\\d{1,2}|\\d{2}:\\d{2})/;
    const startIndex = Math.max(0, lines.findIndex(item => /批量管理/.test(item)));
    const stopWords = /没有更多评论|加载中|全部评论|全部人群|最新发布|评论管理|选择作品|发送$/;
    for (let i = startIndex >= 0 ? startIndex + 1 : 0; i < lines.length - 3; i += 1) {
      const author = lines[i];
      const createdAt = lines[i + 1];
      const content = lines[i + 2];
      const replyTokenIndex = lines.slice(i + 3, i + 8).findIndex(item => item === '回复');
      if (!author || !timePattern.test(createdAt) || !content || replyTokenIndex < 0) continue;
      if (stopWords.test(author) || stopWords.test(content)) continue;
      if (/^\\d+$/.test(content) || /^(回复|删除|举报)$/.test(content)) continue;
      if (targetKeyword && !content.toLowerCase().includes(targetKeyword.toLowerCase()) && !bodyText.toLowerCase().includes(targetKeyword.toLowerCase())) continue;
      const key = [author, createdAt, content].join('|');
      if (items.some(item => item.commentId === key)) continue;
      items.push({
        commentId: key,
        content: content.slice(0, 180),
        authorName: author.slice(0, 80),
        createdAt: createdAt,
        videoTitle: targetKeyword || ''
      });
      if (items.length >= ${Math.max(1, Math.min(100, Number(limit) || 50))}) break;
    }
    if (items.length) return { ok: true, source: location.href, items };
    const visible = el => {
      const rect = el && el.getBoundingClientRect && el.getBoundingClientRect();
      const style = el && getComputedStyle(el);
      return !!rect && rect.width > 20 && rect.height > 12 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const nodes = Array.from(document.querySelectorAll('[class*="comment"], [class*="Comment"], tr, li, [role="row"], [data-e2e*="comment"]')).filter(visible).slice(0, 260);
    const seen = new Set();
    for (const node of nodes) {
      const text = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      if (!text || text.length < 4 || text.length > 280) continue;
      if (targetKeyword && !text.toLowerCase().includes(targetKeyword.toLowerCase())) continue;
      if (!/回复|评论|点赞|分钟前|小时前|昨天|202\\d|刚刚/.test(text)) continue;
      if (/已回复|作者回复|回复了/.test(text)) continue;
      const key = text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        commentId: node.getAttribute('data-id') || node.getAttribute('data-comment-id') || key,
        content: text.replace(/^(评论|回复)\\s*/, '').slice(0, 120),
        authorName: '',
        videoTitle: targetKeyword || ''
      });
      if (items.length >= ${Math.max(1, Math.min(100, Number(limit) || 50))}) break;
    }
    return { ok: true, source: location.href, items };
  })()`;
    const result = await browserEval(profile, session, page, source, 60000);
    if (!result || result.ok === false) throw new Error(result && result.error || '未能从抖音评论管理页读取评论');
    return Array.isArray(result.items) ? result.items : [];
  });
}

async function sendReplyToDouyin(account, row, options) {
  options = options || {};
  const pageUrl = 'https://creator.douyin.com/creator-micro/interactive/comment';
  return withCommentBrowser(account, pageUrl, async function(profile, session, opened) {
    const page = opened.page || opened.tab || opened.tabId || opened.id || 'active';
    await waitMs(5000);
    const source = `(() => {
    const targetText = ${JSON.stringify(row.commentText)};
    const replyText = ${JSON.stringify(row.suggestedReply)};
    const dryRun = ${options.dryRun ? 'true' : 'false'};
    if (!replyText || replyText.length > 80) return { ok: false, error: '回复为空或超过80字' };
    const visible = el => {
      const rect = el && el.getBoundingClientRect && el.getBoundingClientRect();
      const style = el && getComputedStyle(el);
      return !!rect && rect.width > 10 && rect.height > 10 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const textOf = el => (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
    const shortTarget = targetText.slice(0, Math.min(32, Math.max(8, targetText.length)));
    const nodes = Array.from(document.querySelectorAll('div, section, article, li, tr, [role="row"], [data-e2e*="comment"]'))
      .filter(visible)
      .map(item => ({ node: item, text: textOf(item) }))
      .filter(item => item.text.includes(shortTarget) && /回复/.test(item.text))
      .sort((a, b) => a.text.length - b.text.length);
    const match = nodes.find(item => item.text.length < 600) || nodes[0];
    const node = match && match.node;
    if (!node) return { ok: false, error: '页面中未找到目标评论，可能已回复或列表刷新', diagnostics: { url: location.href, title: document.title, nodeCount: nodes.length, target: shortTarget } };
    node.scrollIntoView({ block: 'center', inline: 'nearest' });
    const buttons = Array.from(node.querySelectorAll('button, [role="button"], a, div, span')).filter(visible);
    const replyButton = buttons.find(btn => textOf(btn) === '回复') || buttons.find(btn => /(^|\\s)回复($|\\s)/.test(textOf(btn)));
    if (!replyButton) return { ok: false, error: '未找到回复按钮，页面结构可能已变化', diagnostics: { matched: (match && match.text || '').slice(0, 260) } };
    if (dryRun) return { ok: true, dryRun: true, found: textOf(node).slice(0, 160), replyButton: textOf(replyButton) };
    replyButton.click();
    const setValue = (input, value) => {
      if (input.isContentEditable) {
        input.focus();
        const selection = window.getSelection && window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(input);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (document.execCommand) document.execCommand('insertText', false, value);
        else input.textContent = value;
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        input.focus();
        if (setter) setter.call(input, value);
        else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    return new Promise(resolve => setTimeout(() => {
      const inputs = Array.from(node.querySelectorAll('textarea, [contenteditable="true"], input')).filter(visible)
        .concat(Array.from(document.querySelectorAll('textarea, [contenteditable="true"], input')).filter(visible));
      const input = inputs.find(el => /^回复/.test(el.getAttribute('placeholder') || '')) || inputs.find(el => {
        const rect = el.getBoundingClientRect();
        const placeholder = el.getAttribute('placeholder') || '';
        return rect.width > 80 && rect.height > 18 && !/搜索|筛选|请输入作品/.test(placeholder);
      });
      if (!input) return resolve({ ok: false, error: '未找到回复输入框' });
      setValue(input, replyText);
      setTimeout(() => {
        const submitScope = node.querySelector('.reply-content-obcMk0') || node;
        const submit = Array.from(submitScope.querySelectorAll('button, [role="button"]')).filter(visible).reverse()
          .find(btn => /发送|回复|确定|提交/.test(textOf(btn)) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true')
          || Array.from(document.querySelectorAll('button, [role="button"]')).filter(visible).reverse()
            .find(btn => /发送|回复|确定|提交/.test(textOf(btn)) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true');
        if (!submit) return resolve({ ok: false, error: '未找到发送按钮', diagnostics: { inputPlaceholder: input.getAttribute('placeholder') || '', inputText: textOf(input), inputValue: input.value || '' } });
        submit.click();
        setTimeout(() => resolve({ ok: true, submitted: true, button: textOf(submit), inputPlaceholder: input.getAttribute('placeholder') || '' }), 1800);
      }, 900);
    }, 1200));
  })()`;
    const result = await browserEval(profile, session, page, source, 60000);
    if (!result || result.ok === false) throw new Error(result && result.error || '回复提交失败');
    return result;
  });
}

function rowFromDb(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    groupName: row.group_name,
    platform: row.platform,
    profileAlias: row.profile_alias,
    videoId: row.video_id,
    videoTitle: row.video_title,
    commentId: row.comment_id,
    commentText: row.comment_text,
    authorName: row.author_name,
    createdAtText: row.created_at_text,
    suggestedReply: row.suggested_reply,
    riskLevel: row.risk_level,
    riskReason: row.risk_reason,
    status: row.status,
    error: row.error,
    sentAt: row.sent_at,
    updatedAt: row.updated_at,
    raw: parseJson(row.raw_json, {})
  };
}

module.exports = function createCommentReplyRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const dataDir = path.join(root, 'data');
  ensureDir(dataDir);
  const dbPath = path.join(dataDir, 'comment_reply.db');
  let db = null;

  function getDb() {
    if (db) return db;
    db = new sqlite3.Database(dbPath);
    db.serialize(function() {
      db.run(`CREATE TABLE IF NOT EXISTS comment_reply_account_settings (
        account_id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 0,
        updated_at INTEGER DEFAULT 0
      )`);
      db.run(`CREATE TABLE IF NOT EXISTS comment_reply_items (
        id TEXT PRIMARY KEY,
        account_id TEXT,
        account_name TEXT,
        group_name TEXT,
        platform TEXT,
        profile_alias TEXT,
        video_id TEXT,
        video_title TEXT,
        comment_id TEXT,
        comment_text TEXT,
        author_name TEXT,
        created_at_text TEXT,
        suggested_reply TEXT,
        risk_level TEXT,
        risk_reason TEXT,
        status TEXT,
        error TEXT,
        raw_json TEXT,
        sent_at INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      )`);
      db.run('CREATE INDEX IF NOT EXISTS idx_comment_reply_account_status ON comment_reply_items(account_id,status,updated_at)');
      db.run('CREATE INDEX IF NOT EXISTS idx_comment_reply_updated ON comment_reply_items(updated_at)');
    });
    return db;
  }

  async function accountsWithSettings() {
    const database = getDb();
    const settings = await all(database, 'SELECT * FROM comment_reply_account_settings', []);
    const enabledById = new Map(settings.map(function(row) { return [row.account_id, Number(row.enabled) === 1]; }));
    return accountRows().filter(function(account) {
      return account.testCohort || account.testRecommended;
    }).sort(function(a, b) {
      return Number(Boolean(b.testRecommended)) - Number(Boolean(a.testRecommended))
        || Number(a.testRank || 999) - Number(b.testRank || 999)
        || text(a.accountName).localeCompare(text(b.accountName), 'zh-CN');
    }).map(function(account) {
      return Object.assign({}, account, {
        enabled: enabledById.get(account.accountId) === true,
        canRun: Boolean(account.profileAlias && account.runnable && /ready|verify|unknown|ok/i.test(account.loginStatus || ''))
      });
    });
  }

  async function upsertItem(database, item, raw) {
    const at = nowSec();
    await run(database, `INSERT INTO comment_reply_items (
      id,account_id,account_name,group_name,platform,profile_alias,video_id,video_title,comment_id,comment_text,
      author_name,created_at_text,suggested_reply,risk_level,risk_reason,status,error,raw_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      suggested_reply=excluded.suggested_reply,
      risk_level=excluded.risk_level,
      risk_reason=excluded.risk_reason,
      status=CASE WHEN comment_reply_items.status IN ('sent','failed') THEN comment_reply_items.status ELSE excluded.status END,
      error='',
      raw_json=excluded.raw_json,
      updated_at=excluded.updated_at`, [
      item.id, item.accountId, item.accountName, item.groupName, item.platform, item.profileAlias,
      item.videoId, item.videoTitle, item.commentId, item.commentText, item.authorName, item.createdAtText,
      item.suggestedReply, item.riskLevel, item.riskReason, item.status, '', json(raw || {}), at, at
    ]);
  }

  async function historyRows(body) {
    const database = getDb();
    const where = [];
    const params = [];
    if (text(body.accountId)) {
      where.push('account_id=?');
      params.push(text(body.accountId));
    }
    if (text(body.status)) {
      where.push('status=?');
      params.push(text(body.status));
    }
    if (text(body.videoKeyword)) {
      const keyword = '%' + text(body.videoKeyword) + '%';
      where.push('(video_title LIKE ? OR video_id LIKE ? OR raw_json LIKE ?)');
      params.push(keyword, keyword, keyword);
    }
    const limit = Math.max(1, Math.min(300, Number(body.limit) || 120));
    params.push(limit);
    const rows = await all(database, 'SELECT * FROM comment_reply_items' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY updated_at DESC LIMIT ?', params);
    return rows.map(rowFromDb);
  }

  function findAccount(accounts, accountId) {
    return accounts.find(function(account) { return account.accountId === accountId || account.profileAlias === accountId || account.accountName === accountId; });
  }

  return {
    '/api/comment-reply/accounts': function(body, cb) {
      (async function() {
        body = body || {};
        const database = getDb();
        if (body && body.action === 'update') {
          const accountId = text(body.accountId);
          if (!accountId) return cb({ ok: false, error: '缺少账号 ID' });
          await run(database, 'INSERT OR REPLACE INTO comment_reply_account_settings (account_id,enabled,updated_at) VALUES (?,?,?)', [
            accountId,
            body.enabled ? 1 : 0,
            nowSec()
          ]);
        }
        cb({ ok: true, accounts: await accountsWithSettings() });
      })().catch(function(error) {
        logger.warn('accounts failed', error);
        cb({ ok: false, error: error.message || String(error), accounts: [] });
      });
    },

    '/api/comment-reply/collect': function(body, cb) {
      (async function() {
        body = body || {};
        const database = getDb();
        const accounts = await accountsWithSettings();
        const target = findAccount(accounts, text(body.accountId));
        if (!target) return cb({ ok: false, error: '未找到抖音账号' });
        if (!target.enabled) return cb({ ok: false, error: '该账号尚未开启评论回复测试' });
        if (!target.canRun) return cb({ ok: false, error: '该账号登录态不可用：' + (target.loginReason || target.loginStatus || 'unknown') });
        const provided = Array.isArray(body.comments) ? body.comments : null;
        const videoKeyword = text(body.videoKeyword || body.videoTitle || body.videoUrl);
        const replyStyle = text(body.replyStyle || body.style) || 'natural';
        const rawItems = provided || await collectFromDouyin(target, Number(body.limit) || 50, { videoKeyword: videoKeyword });
        const items = rawItems.map(function(item) { return normalizeComment(item, target, { videoKeyword: videoKeyword, replyStyle: replyStyle }); })
          .filter(function(item) { return item.commentText && item.platform === 'douyin'; });
        for (const item of items) await upsertItem(database, item, item);
        cb({ ok: true, account: target, count: items.length, items: items, history: await historyRows({ accountId: target.accountId, videoKeyword: videoKeyword, limit: 120 }) });
      })().catch(function(error) {
        logger.warn('collect failed', error);
        cb({ ok: false, error: error.message || String(error), items: [] });
      });
    },

    '/api/comment-reply/plan': function(body, cb) {
      (async function() {
        body = body || {};
        const database = getDb();
        const ids = Array.isArray(body.ids) ? body.ids.map(text).filter(Boolean) : [];
        const accountId = text(body.accountId);
        const videoKeyword = text(body.videoKeyword || body.videoTitle || body.videoUrl);
        const replyStyle = text(body.replyStyle || body.style) || 'natural';
        const where = ['status IN ("planned","manual")'];
        const params = [];
        if (accountId) {
          where.push('account_id=?');
          params.push(accountId);
        }
        if (videoKeyword) {
          const like = '%' + videoKeyword + '%';
          where.push('(video_title LIKE ? OR video_id LIKE ? OR raw_json LIKE ?)');
          params.push(like, like, like);
        }
        params.push(Math.max(1, Math.min(200, Number(body.limit) || 120)));
        const rows = ids.length
          ? await all(database, 'SELECT * FROM comment_reply_items WHERE id IN (' + ids.map(function() { return '?'; }).join(',') + ')', ids)
          : await all(database, 'SELECT * FROM comment_reply_items WHERE ' + where.join(' AND ') + ' ORDER BY updated_at DESC LIMIT ?', params);
        const planned = [];
        for (const dbRow of rows) {
          const row = rowFromDb(dbRow);
          const classified = classifyComment({ content: row.commentText, accountName: row.accountName }, { replyStyle: replyStyle });
          const nextStatus = classified.riskLevel === 'safe' ? 'planned' : 'manual';
          await run(database, 'UPDATE comment_reply_items SET suggested_reply=?, risk_level=?, risk_reason=?, status=?, updated_at=? WHERE id=? AND status!="sent"', [
            classified.suggestedReply,
            classified.riskLevel,
            classified.riskReason,
            nextStatus,
            nowSec(),
            row.id
          ]);
          planned.push(Object.assign({}, row, classified, { status: row.status === 'sent' ? 'sent' : nextStatus }));
        }
        cb({ ok: true, items: planned, safeCount: planned.filter(function(item) { return item.riskLevel === 'safe'; }).length });
      })().catch(function(error) {
        cb({ ok: false, error: error.message || String(error), items: [] });
      });
    },

    '/api/comment-reply/send': function(body, cb) {
      (async function() {
        body = body || {};
        const database = getDb();
        const limit = Math.max(1, Math.min(20, Number(body.limit) || 20));
        const accounts = await accountsWithSettings();
        const accountId = text(body.accountId);
        const ids = Array.isArray(body.ids) ? body.ids.map(text).filter(Boolean) : [];
        const videoKeyword = text(body.videoKeyword || body.videoTitle || body.videoUrl);
        const dryRun = Boolean(body.dryRun);
        const params = [];
        let where = 'status="planned" AND risk_level="safe"';
        if (accountId) {
          where += ' AND account_id=?';
          params.push(accountId);
        }
        if (ids.length) {
          where += ' AND id IN (' + ids.map(function() { return '?'; }).join(',') + ')';
          params.push.apply(params, ids);
        }
        if (videoKeyword) {
          const like = '%' + videoKeyword + '%';
          where += ' AND (video_title LIKE ? OR video_id LIKE ? OR raw_json LIKE ?)';
          params.push(like, like, like);
        }
        params.push(limit);
        const rows = await all(database, 'SELECT * FROM comment_reply_items WHERE ' + where + ' ORDER BY updated_at DESC LIMIT ?', params);
        const sent = [];
        const failed = [];
        for (const dbRow of rows) {
          const row = rowFromDb(dbRow);
          const account = findAccount(accounts, row.accountId);
          if (!account || !account.enabled) {
            failed.push(Object.assign({}, row, { error: '账号未开启或不存在' }));
            await run(database, 'UPDATE comment_reply_items SET status="failed", error=?, updated_at=? WHERE id=?', ['账号未开启或不存在', nowSec(), row.id]);
            continue;
          }
          try {
            const result = await sendReplyToDouyin(account, row, { dryRun: dryRun });
            if (dryRun) {
              sent.push(Object.assign({}, row, { dryRun: true, result: result }));
            } else {
              await run(database, 'UPDATE comment_reply_items SET status="sent", error="", sent_at=?, updated_at=? WHERE id=?', [nowSec(), nowSec(), row.id]);
              sent.push(row);
            }
          } catch (error) {
            const message = (error.message || String(error)).slice(0, 1200);
            if (!dryRun) await run(database, 'UPDATE comment_reply_items SET status="failed", error=?, updated_at=? WHERE id=?', [message, nowSec(), row.id]);
            failed.push(Object.assign({}, row, { error: message }));
          }
          if (dryRun) continue;
          await new Promise(function(resolve) {
            setTimeout(resolve, 6000 + Math.floor(Math.random() * 9000));
          });
        }
        cb({ ok: true, sent: sent, failed: failed, history: await historyRows({ accountId: accountId, videoKeyword: videoKeyword, limit: 120 }) });
      })().catch(function(error) {
        cb({ ok: false, error: error.message || String(error), sent: [], failed: [] });
      });
    },

    '/api/comment-reply/history': function(body, cb) {
      historyRows(body || {}).then(function(items) {
        cb({ ok: true, items: items });
      }).catch(function(error) {
        cb({ ok: false, error: error.message || String(error), items: [] });
      });
    }
  };
};
