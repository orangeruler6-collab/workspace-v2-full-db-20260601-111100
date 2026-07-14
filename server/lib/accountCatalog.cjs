const fs = require('fs');
const path = require('path');

const platformDefaults = {
  douyin: { name: '\u6296\u97f3', icon: 'D' },
  bilibili: { name: 'B\u7ad9', icon: 'B' },
  kuaishou: { name: '\u5feb\u624b', icon: 'K' },
  xiaohongshu: { name: '\u5c0f\u7ea2\u4e66', icon: 'R' },
  wechatVideo: { name: '\u89c6\u9891\u53f7', icon: 'V' }
};
const activeAccountDataPlatforms = ['bilibili', 'kuaishou', 'douyin'];

const dataMaintenanceProfile = {
  alias: 'collector-link-crawl',
  chromeProfileDirectory: 'Profile 1',
  name: '\u6570\u636e\u6536\u96c6\u4e13\u7528'
};

const accountPlatformStatusFile = path.join(__dirname, '..', '..', 'data', 'account-platform-status.json');
const accountDataCollectWhitelistFile = path.join(__dirname, '..', '..', 'data', 'account-data-collect-whitelist.json');
const runnablePlatformStatuses = new Set(['ready', 'verify']);
const disabledAccountDataPlatforms = new Map([
  ['profile-24:bilibili', '低价值平台：B站无粉丝/无作品，已从账号数据采集链路摘除'],
  ['profile-7:bilibili', '低价值平台：B站无粉丝/无作品，已从账号数据采集链路摘除']
]);

const userExcludedAccountDataPlatforms = new Map([
  ['profile-9:bilibili', 'aux platform not logged in during serial collection'],
  ['profile-10:bilibili', 'aux platform not logged in during serial collection'],
  ['profile-11:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-12:bilibili', 'aux platform not logged in during serial collection'],
  ['profile-13:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-21:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-26:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-26:bilibili', 'aux platform not logged in during serial collection'],
  ['profile-27:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-28:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-29:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-35:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-39:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-40:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-43:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-45:kuaishou', 'aux platform not logged in during serial collection'],
  ['profile-38:bilibili', 'aux platform has no historical collection data'],
  ['profile-41:kuaishou', 'aux platform has no historical collection data'],
  ['profile-41:bilibili', 'aux platform has no historical collection data'],
  ['profile-46:bilibili', 'aux platform has no historical collection data'],
  ['profile-27:bilibili', 'aux platform has no historical collection data'],
  ['profile-31:kuaishou', 'aux platform has no historical collection data']
]);

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { return null; }
}

function readAccountPlatformStatus() {
  const parsed = safeReadJson(accountPlatformStatusFile);
  return parsed && parsed.profiles && typeof parsed.profiles === 'object' ? parsed : { profiles: {} };
}

let accountDataCollectWhitelistCache = null;

function readAccountDataCollectWhitelist() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(accountDataCollectWhitelistFile).mtimeMs; } catch (e) {}
  if (accountDataCollectWhitelistCache && accountDataCollectWhitelistCache.mtimeMs === mtimeMs) {
    return accountDataCollectWhitelistCache.value;
  }
  const parsed = safeReadJson(accountDataCollectWhitelistFile);
  const keys = Array.isArray(parsed && parsed.keys)
    ? parsed.keys
    : (Array.isArray(parsed && parsed.targets)
      ? parsed.targets.map(item => [item && item.profile, item && item.platform].join(':'))
      : []);
  const value = keys.length
    ? new Set(keys.map(item => String(item || '').trim()).filter(Boolean))
    : null;
  accountDataCollectWhitelistCache = { mtimeMs, value };
  return value;
}

function platformStatusFor(profileAlias, platformId) {
  const status = readAccountPlatformStatus();
  const profile = status.profiles[String(profileAlias || '').trim()];
  const platform = profile && profile.platforms && profile.platforms[String(platformId || '').trim()];
  return platform && typeof platform === 'object' ? platform : null;
}

function platformIsRunnable(platform) {
  if (platform && platform.runnable === false) return false;
  const status = String(platform && (platform.collect_status || platform.status || platform.login_status) || '').trim();
  return !status || runnablePlatformStatuses.has(status);
}

function disabledAccountDataReason(profileAlias, platformId) {
  const key = [String(profileAlias || '').trim(), String(platformId || '').trim()].join(':');
  return userExcludedAccountDataPlatforms.get(key) || disabledAccountDataPlatforms.get(key) || '';
}

function accountDataCollectWhitelistReason(profileAlias, platformId) {
  const whitelist = readAccountDataCollectWhitelist();
  if (!whitelist) return '';
  const key = [String(profileAlias || '').trim(), String(platformId || '').trim()].join(':');
  return whitelist.has(key) ? '' : 'not in today successful account-data collection whitelist';
}

function accountDataCollectDisabledReason(profileAlias, platformId) {
  return disabledAccountDataReason(profileAlias, platformId)
    || accountDataCollectWhitelistReason(profileAlias, platformId);
}

function accountDataPlatformCollectEnabled(profileAlias, platformId) {
  return !accountDataCollectDisabledReason(profileAlias, platformId);
}

const chromeProfileDirectories = {
  'collector-link-crawl': 'Profile 1',
  axwqsu75: 'Profile 1',
  'tianji-mei-publish': 'Profile 2',
  byjhch2z: 'Profile 2',
  'maixiaohua-publish': 'Profile 3',
  kfzq2nx6: 'Profile 3',
  dvabrcmr: 'Profile 4',
  h4g7ab4y: 'Profile 5',
  b3uk5kjf: 'Profile 6',
  'youxia-bengbeng': 'Default',
  '\u6e38\u4fa0\u8e66\u8e66': 'Default',
  vpu8aysj: 'Default'
};

const desktopLoginProfiles = [
  { id: 'login-profile-18', alias: 'profile-18', name: '木游话说', chromeProfileDirectory: 'Profile 18' },
  { id: 'login-profile-35', alias: 'profile-35', name: '暴走星号键', chromeProfileDirectory: 'Profile 35' },
  { id: 'login-profile-30', alias: 'profile-30', name: '不玩就分手', chromeProfileDirectory: 'Profile 30' },
  { id: 'login-profile-8', alias: 'profile-8', name: '策划克星阿强', chromeProfileDirectory: 'Profile 8' },
  { id: 'login-profile-24', alias: 'profile-24', name: '畅玩百晓生', chromeProfileDirectory: 'Profile 24' },
  { id: 'login-profile-9', alias: 'profile-9', name: '饭十七', chromeProfileDirectory: 'Profile 9' },
  { id: 'login-profile-10', alias: 'profile-10', name: '嘿小虎', chromeProfileDirectory: 'Profile 10' },
  { id: 'login-profile-main', alias: 'profile-main', name: '花无缺', chromeProfileDirectory: 'Profile' },
  { id: 'login-profile-7', alias: 'profile-7', name: '葵仔不想肝', chromeProfileDirectory: 'Profile 7' },
  { id: 'login-profile-36', alias: 'profile-36', name: '李野王SG', chromeProfileDirectory: 'Profile 36' },
  { id: 'login-profile-14', alias: 'profile-14', name: '灵梦小师妹', chromeProfileDirectory: 'Profile 14' },
  { id: 'login-profile-21', alias: 'profile-21', name: '鲁达大王', chromeProfileDirectory: 'Profile 21' },
  { id: 'login-profile-16', alias: 'profile-16', name: '麦冬冬', chromeProfileDirectory: 'Profile 16' },
  { id: 'login-profile-3', alias: 'profile-3', name: '麦晓雯', chromeProfileDirectory: 'Profile 3' },
  { id: 'login-profile-15', alias: 'profile-15', name: '超玩教授', chromeProfileDirectory: 'Profile 15' },
  { id: 'login-profile-4', alias: 'profile-4', name: '逆水寒-饭十七', chromeProfileDirectory: 'Profile 4' },
  { id: 'login-profile-5', alias: 'profile-5', name: '逆水寒-雷鸭', chromeProfileDirectory: 'Profile 5' },
  { id: 'login-profile-6', alias: 'profile-6', name: '逆水寒-游点慌', chromeProfileDirectory: 'Profile 6' },
  { id: 'login-profile-32', alias: 'profile-32', name: '跑腿的包子', chromeProfileDirectory: 'Profile 32' },
  { id: 'login-profile-12', alias: 'profile-12', name: '皮皮说游戏', chromeProfileDirectory: 'Profile 12' },
  { id: 'login-profile-28', alias: 'profile-28', name: '情风师兄', chromeProfileDirectory: 'Profile 28' },
  { id: 'login-profile-29', alias: 'profile-29', name: '上官北', chromeProfileDirectory: 'Profile 29' },
  { id: 'login-profile-11', alias: 'profile-11', name: '团子好贵', chromeProfileDirectory: 'Profile 11' },
  { id: 'login-profile-26', alias: 'profile-26', name: '夏洛', chromeProfileDirectory: 'Profile 26' },
  { id: 'login-profile-34', alias: 'profile-34', name: '薛定谔的机', chromeProfileDirectory: 'Profile 34' },
  { id: 'login-profile-22', alias: 'profile-22', name: '硬件侠', chromeProfileDirectory: 'Profile 22' },
  { id: 'login-profile-default', alias: 'profile-default', name: '游侠蹦蹦', chromeProfileDirectory: 'Default' },
  { id: 'login-profile-19', alias: 'profile-19', name: '游小妹', chromeProfileDirectory: 'Profile 19' },
  { id: 'login-profile-13', alias: 'profile-13', name: '中二探长', chromeProfileDirectory: 'Profile 13' },
  { id: 'login-profile-33', alias: 'profile-33', name: '最游话说', chromeProfileDirectory: 'Profile 33' },
  { id: 'login-profile-38', alias: 'profile-38', name: '花蛮楼', chromeProfileDirectory: 'Profile 38' },
  { id: 'login-profile-39', alias: 'profile-39', name: '王路飞CP', chromeProfileDirectory: 'Profile 39' },
  { id: 'login-profile-40', alias: 'profile-40', name: '夏天丶Cat', chromeProfileDirectory: 'Profile 40' },
  { id: 'login-profile-41', alias: 'profile-41', name: '小张同学', chromeProfileDirectory: 'Profile 41' },
  { id: 'login-profile-42', alias: 'profile-42', name: '报告砖家', chromeProfileDirectory: 'Profile 42' },
  { id: 'login-profile-43', alias: 'profile-43', name: '痞仔伯爵', chromeProfileDirectory: 'Profile 43' },
  { id: 'login-profile-45', alias: 'profile-45', name: '网瘾少女一条', chromeProfileDirectory: 'Profile 45' },
  { id: 'login-profile-46', alias: 'profile-46', name: '有事找学姐', chromeProfileDirectory: 'Profile 46' },
  { id: 'login-profile-48', alias: 'profile-48', name: 'Lee小强', chromeProfileDirectory: 'Profile 48' },
  { id: 'login-profile-20', alias: 'profile-20', name: '游热娃子', chromeProfileDirectory: 'Profile 20' },
  { id: 'login-profile-27', alias: 'profile-27', name: '游戏永动机', chromeProfileDirectory: 'Profile 27' },
  { id: 'login-profile-31', alias: 'profile-31', name: '游电工厂', chromeProfileDirectory: 'Profile 31' }
];

const accountGroupFallbacks = [
  { groupName: '内容一部', groupId: 1, accounts: ['最游话说', '最翁damn', '最翁Damnnn', '薛定谔的机', '李野王SG', '游电工厂', '硬件侠', '情风师兄', '上官北', '上官北丶', '王路飞cp', '王路飞CP'] },
  { groupName: '内容二组', groupId: 2, accounts: ['痞仔伯爵', '暴走星号键', '雷鸭', '雷鸭Fist', '报告砖家', '网瘾少女一条'] },
  { groupName: '内容三组', groupId: 3, accounts: ['策划克星阿强', '中二探长', '团子好贵', '嘿小虎', '灵梦小师妹', '跑腿的包子', '饭十七', '皮皮说游戏', '娱乐小狮酱', '甄有话说'] },
  { groupName: '内容四组', groupId: 4, accounts: ['天机妹', '花蛮楼', '麦小雯', '麦晓雯', '夏天丶Cat', '有事找学姐', '小张同学'] },
  { groupName: '内容五组', groupId: 5, accounts: ['游小妹', '游热娃子', '超玩教授', 'Lee小强', '木游话说', '麦冬冬'] },
  { groupName: '内容六组', groupId: 6, accounts: ['花无缺', '魁仔不想肝', '葵仔不想肝', '游戏永动机', '畅玩白晓生', '畅玩百晓生'] }
];

function normalizeAccountName(value) {
  return String(value || '')
    .replace(/逆水寒[-·\s]*/g, '')
    .replace(/[丶·\s-]/g, '')
    .toLowerCase();
}

const accountGroupByName = (() => {
  const map = new Map();
  for (const group of accountGroupFallbacks) {
    for (const name of group.accounts) {
      map.set(normalizeAccountName(name), { groupName: group.groupName, groupId: group.groupId });
    }
  }
  return map;
})();

const accountAliasesByName = new Map([
  ['葵仔不想肝', ['魁仔不想肝']],
  ['畅玩百晓生', ['畅玩白晓生']],
  ['最游话说', ['最翁damn', '最翁Damnnn', '最翁说游']],
  ['上官北', ['上官北丶']],
  ['Lee小强', ['LEE小强']],
  ['夏天丶Cat', ['夏天丶cat']]
]);

function aliasesForAccountName(name) {
  return accountAliasesByName.get(String(name || '')) || [];
}

function publishVolumeExcluded(profile, platform) {
  return String(platform || '').trim() === 'douyin'
    && new Set(['dvabrcmr', 'b3uk5kjf', 'h4g7ab4y', 'vpu8aysj', 'profile-9', 'wte4aew6', 'profile-10', 'sz5hkh6p']).has(String(profile || '').trim());
}

function inferredAccountGroup(name) {
  return accountGroupByName.get(normalizeAccountName(name)) || { groupName: '待确认分组', groupId: 0 };
}

for (const item of desktopLoginProfiles) {
  chromeProfileDirectories[item.alias] = item.chromeProfileDirectory;
  chromeProfileDirectories[item.id] = item.chromeProfileDirectory;
  chromeProfileDirectories[item.name] = item.chromeProfileDirectory;
}

const accounts = [
  {
    id: 'tianji-mei',
    name: '\u5929\u673a\u59b9',
    dashboardName: '\u5929\u673a\u59b9',
    avatar: '\u673a',
    groupName: '\u5185\u5bb9\u56db\u7ec4',
    groupId: 4,
    owner: '\u9648\u5065\u4f0a',
    primaryPlatform: 'douyin',
    description: '\u751f\u6d3b\u611f\u3001\u5730\u57df\u8da3\u95fb\u3001\u8f7b\u5267\u60c5\u5185\u5bb9\u4f18\u5148',
    styleHint: '\u53e3\u8bed\u5316\u3001\u63a5\u5730\u6c14\uff0c\u6709\u4e00\u70b9\u5410\u69fd\u611f\uff0c\u4f46\u4e0d\u8981\u592a\u786c\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['tianji-mei-publish', 'byjhch2z'],
    platforms: activeAccountDataPlatforms.map(platformId => ({
      id: platformId,
      handle: platformDefaults[platformId].name + ' \u00b7 \u5929\u673a\u59b9',
      profile_alias: 'tianji-mei-publish',
      login_status: 'ready'
    }))
  },
  {
    id: 'maixiaohua',
    name: '\u9ea6\u5c0f\u96ef',
    dashboardName: '\u9ea6\u5c0f\u96ef',
    avatar: '\u9ea6',
    groupName: '\u5185\u5bb9\u56db\u7ec4',
    groupId: 4,
    owner: '\u9648\u5065\u4f0a',
    description: '\u751f\u6d3b\u5206\u4eab\u3001\u60c5\u7eea\u89c2\u70b9\u3001\u5973\u6027\u5411\u5185\u5bb9\u4f18\u5148',
    styleHint: '\u8bed\u6c14\u81ea\u7136\u4eb2\u8fd1\uff0c\u5148\u7ed9\u89c2\u70b9\u548c\u60c5\u7eea\uff0c\u518d\u8865\u5145\u6545\u4e8b\u7ec6\u8282\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['maixiaohua-publish', 'kfzq2nx6'],
    platforms: activeAccountDataPlatforms.map(platformId => ({
      id: platformId,
      handle: platformDefaults[platformId].name + ' \u00b7 \u9ea6\u5c0f\u96ef',
      profile_alias: 'maixiaohua-publish',
      login_status: 'ready'
    }))
  },
  {
    id: 'nishuihan-fanshiqii',
    name: '\u9006\u6c34\u5bd2-\u996d\u5341\u4e03',
    dashboardName: '\u996d\u5341\u4e03',
    avatar: '\u996d',
    groupName: '\u5185\u5bb9\u4e09\u7ec4',
    groupId: 3,
    owner: '\u8096\u5b50\u745e',
    description: '\u9006\u6c34\u5bd2\u624b\u6e38\u5e26\u8d27\u53d1\u5e03\u8d26\u53f7',
    styleHint: '\u77ed\u53e5\u3001\u5f3a\u60c5\u7eea\u3001\u56f4\u7ed5\u6b27\u6c14\u51ff\u5b50\u548c\u7965\u745e\u51fa\u8d27\u8868\u8fbe\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['dvabrcmr'],
    platforms: [
      { id: 'douyin', handle: '\u6296\u97f3 \u00b7 \u996d\u5341\u4e03', profile_alias: 'dvabrcmr', login_status: 'ready' }
    ]
  },
  {
    id: 'nishuihan-youdianhuang',
    name: '\u6e38\u70b9\u614c',
    dashboardName: '\u6e38\u70b9\u614c',
    avatar: '\u6e38',
    groupName: '\u5185\u5bb9\u516d\u7ec4',
    groupId: 6,
    owner: '\u6797\u8bed\u5ae3',
    description: '\u9006\u6c34\u5bd2\u624b\u6e38\u5e26\u8d27\u53d1\u5e03\u8d26\u53f7',
    styleHint: '\u77ed\u53e5\u3001\u5f3a\u60c5\u7eea\u3001\u56f4\u7ed5\u6b27\u6c14\u51ff\u5b50\u548c\u7965\u745e\u51fa\u8d27\u8868\u8fbe\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['b3uk5kjf'],
    platforms: [
      { id: 'douyin', handle: '\u6296\u97f3 \u00b7 \u6e38\u70b9\u614c', profile_alias: 'b3uk5kjf', login_status: 'ready' }
    ]
  },
  {
    id: 'nishuihan-leiya',
    name: '\u96f7\u9e2d',
    dashboardName: '\u96f7\u9e2dFist',
    avatar: '\u96f7',
    groupName: '\u5185\u5bb9\u4e8c\u7ec4',
    groupId: 2,
    owner: '',
    description: '\u9006\u6c34\u5bd2\u624b\u6e38\u5e26\u8d27\u53d1\u5e03\u8d26\u53f7',
    styleHint: '\u77ed\u53e5\u3001\u5f3a\u60c5\u7eea\u3001\u56f4\u7ed5\u6b27\u6c14\u51ff\u5b50\u548c\u7965\u745e\u51fa\u8d27\u8868\u8fbe\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['h4g7ab4y', '\u96f7\u9e2dFist', '\u96f7\u9e2dfist'],
    platforms: [
      { id: 'douyin', handle: '\u6296\u97f3 \u00b7 \u96f7\u9e2dFist', profile_alias: 'h4g7ab4y', login_status: 'ready' },
      { id: 'bilibili', handle: 'B\u7ad9 \u00b7 \u96f7\u9e2dFist', profile_alias: 'h4g7ab4y', login_status: 'ready' }
    ]
  },
  {
    id: 'youxia-bengbeng',
    name: '\u6e38\u4fa0\u8e66\u8e66',
    dashboardName: '\u6e38\u4fa0\u8e66\u8e66',
    avatar: '\u6e38',
    groupName: '\u5185\u5bb9\u516d\u7ec4',
    groupId: 6,
    owner: '',
    description: '\u89c6\u9891\u53d1\u5e03\u8d26\u53f7',
    styleHint: '\u6309\u8d26\u53f7\u65e2\u6709\u5185\u5bb9\u98ce\u683c\u53d1\u5e03\uff0c\u6807\u9898\u548c\u63cf\u8ff0\u4fdd\u6301\u81ea\u7136\u3001\u6e05\u6670\u3001\u9002\u5408\u5e73\u53f0\u5206\u53d1\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['vpu8aysj', 'youxia-bengbeng', '\u6e38\u4fa0\u8e66\u8e66'],
    platforms: [
      { id: 'douyin', handle: '\u6296\u97f3 \u00b7 \u6e38\u4fa0\u8e66\u8e66', profile_alias: 'vpu8aysj', login_status: 'ready' }
    ]
  },
  {
    id: 'lee-xiaoqiang',
    name: 'Lee\u5c0f\u5f3a',
    dashboardName: 'Lee\u5c0f\u5f3a',
    avatar: 'L',
    groupName: '\u5185\u5bb9\u4e94\u7ec4',
    groupId: 5,
    owner: '\u5546\u5149\u6db5',
    description: '\u6708\u5ea6\u66f4\u65b0\u8ba1\u5212\u8d26\u53f7\uff0c\u5df2\u7ed1\u5b9a\u684c\u9762\u767b\u5f55\u6001 Profile 48\u3002',
    styleHint: '\u6309\u8d26\u53f7\u65e2\u6709\u5185\u5bb9\u98ce\u683c\u91c7\u96c6\u548c\u5c55\u793a\u3002',
    dataProfileAlias: dataMaintenanceProfile.alias,
    profileAliases: ['profile-48', 'login-profile-48', 'Lee\u5c0f\u5f3a', 'LEE\u5c0f\u5f3a', 'lee\u5c0f\u5f3a'],
    platforms: [
      {
        id: 'douyin',
        handle: '\u6296\u97f3 \u00b7 Lee\u5c0f\u5f3a',
        profile_alias: 'profile-48',
        login_status: 'ready'
      },
      {
        id: 'kuaishou',
        handle: '\u5feb\u624b \u00b7 Lee\u5c0f\u5f3a',
        profile_alias: 'profile-48',
        login_status: 'ready'
      },
      {
        id: 'bilibili',
        handle: 'B\u7ad9 \u00b7 Lee\u5c0f\u5f3a',
        profile_alias: 'profile-48',
        login_status: 'ready'
      }
    ]
  }
];

function desktopLoginAccountRows() {
  const existingDirectories = new Set();
  for (const account of accounts) {
    for (const alias of account.profileAliases || []) {
      if (chromeProfileDirectories[alias]) existingDirectories.add(chromeProfileDirectories[alias]);
    }
    for (const platform of account.platforms || []) {
      if (chromeProfileDirectories[platform.profile_alias]) existingDirectories.add(chromeProfileDirectories[platform.profile_alias]);
    }
  }
  return desktopLoginProfiles
    .filter(item => item.alias !== dataMaintenanceProfile.alias && item.name !== dataMaintenanceProfile.name)
    .filter(item => !existingDirectories.has(item.chromeProfileDirectory))
    .map(item => {
      const inferred = inferredAccountGroup(item.name);
      return {
      id: item.id,
      name: item.name,
      dashboardName: item.name,
      avatar: item.name.slice(0, 1),
      groupName: inferred.groupName,
      groupId: inferred.groupId,
      owner: '',
      description: '桌面登录态导入账号，等待补充分组、负责人和跨平台绑定。',
      styleHint: '按账号既有内容风格采集和展示。',
      dataProfileAlias: dataMaintenanceProfile.alias,
      profileAliases: [item.alias, item.id, item.name].concat(aliasesForAccountName(item.name)),
      platforms: [
        { id: 'douyin', handle: platformDefaults.douyin.name + ' · ' + item.name, profile_alias: item.alias, login_status: 'ready' },
        { id: 'kuaishou', handle: platformDefaults.kuaishou.name + ' · ' + item.name, profile_alias: item.alias, login_status: 'ready' },
        { id: 'bilibili', handle: platformDefaults.bilibili.name + ' · ' + item.name, profile_alias: item.alias, login_status: 'ready' }
      ]
    };
    });
}

const catalogAccounts = accounts.concat(desktopLoginAccountRows());

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function enrichPlatform(platform) {
  const defaults = platformDefaults[platform.id] || {};
  const disabledReason = disabledAccountDataReason(platform.profile_alias || platform.profile, platform.id);
  const collectDisabledReason = accountDataCollectDisabledReason(platform.profile_alias || platform.profile, platform.id);
  const status = platformStatusFor(platform.profile_alias || platform.profile, platform.id);
  const collectStatus = disabledReason ? 'not_applicable' : (status && status.status ? status.status : (platform.login_status || 'unknown'));
  const collectReason = disabledReason || (status && status.reason) || platform.collect_status_reason || '';
  return Object.assign({
    name: defaults.name || platform.id,
    icon: defaults.icon || platform.id.slice(0, 1).toUpperCase(),
    profile: platform.profile_alias,
    chrome_profile_directory: chromeProfileDirectories[platform.profile_alias] || '',
    status: collectStatus,
    collect_status: collectStatus,
    collect_status_reason: collectReason,
    collect_status_checked_at: status && status.lastCheckedAt || '',
    account_data_collect_enabled: !collectDisabledReason,
    account_data_collect_disabled_reason: collectDisabledReason,
    runnable: disabledReason ? false : platformIsRunnable({ status: collectStatus })
  }, platform, {
    status: collectStatus,
    collect_status: collectStatus,
    collect_status_reason: collectReason,
    account_data_collect_enabled: !collectDisabledReason,
    account_data_collect_disabled_reason: collectDisabledReason,
    runnable: disabledReason ? false : platformIsRunnable(Object.assign({}, platform, { status: collectStatus })),
    login_status: collectStatus
  });
}

function publishAccountCatalog() {
  return catalogAccounts.map(account => {
    const item = clone(account);
    item.dataProfileDirectory = chromeProfileDirectories[item.dataProfileAlias] || '';
    item.platforms = (item.platforms || []).map(enrichPlatform);
    return item;
  });
}

function defaultVideoPublishBindings() {
  const rows = [];
  for (const account of catalogAccounts) {
    for (const rawPlatform of account.platforms || []) {
      const platform = enrichPlatform(rawPlatform);
      rows.push({
        account_id: account.id,
        account_name: account.name,
        platform_id: platform.id,
        platform_name: platform.name,
        platform_handle: platform.handle,
        profile_alias: platform.profile_alias,
        login_status: platform.login_status || 'unknown'
      });
    }
  }
  return rows;
}

function runnablePlatformsForAccount(account) {
  return (account.platforms || []).map(enrichPlatform).filter(platformIsRunnable);
}

function collectablePlatformsForAccount(account) {
  return runnablePlatformsForAccount(account)
    .filter(platform => accountDataPlatformCollectEnabled(platform.profile_alias || platform.profile, platform.id));
}

function openCliBrowserProfileAliases() {
  const file = process.env.OPENCLI_BROWSER_PROFILES_FILE
    || path.join(process.env.USERPROFILE || '', '.opencli', 'browser-profiles.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    return parsed && parsed.aliases && typeof parsed.aliases === 'object' ? parsed.aliases : {};
  } catch (e) {
    return {};
  }
}

function chromeProfileDirectoryMap() {
  const map = Object.assign({}, chromeProfileDirectories);
  const openCliAliases = openCliBrowserProfileAliases();
  Object.entries(openCliAliases).forEach(([alias, contextId]) => {
    if (alias && contextId && map[alias] && !map[contextId]) map[contextId] = map[alias];
  });
  for (const account of catalogAccounts) {
    for (const alias of account.profileAliases || []) {
      if (chromeProfileDirectories[alias]) map[alias] = chromeProfileDirectories[alias];
    }
    for (const platform of account.platforms || []) {
      const directory = chromeProfileDirectories[platform.profile_alias];
      if (!directory) continue;
      map[platform.profile_alias] = directory;
      map[account.id] = directory;
      map[account.name] = directory;
      if (account.dashboardName) map[account.dashboardName] = directory;
    }
  }
  return map;
}

function dashboardProfileMeta() {
  const meta = {};
  const openCliAliases = openCliBrowserProfileAliases();
  for (const account of catalogAccounts) {
    const value = {
      account: account.dashboardName || account.name,
      groupName: account.groupName || '\u5f85\u63a5\u5165',
      groupId: Number(account.groupId) || 0,
      owner: account.owner || '',
      accountId: account.id,
      primaryPlatform: account.primaryPlatform || '',
      platformIds: collectablePlatformsForAccount(account).map(platform => platform.id).filter(Boolean)
    };
    const aliases = new Set([
      account.id,
      account.name,
      account.dashboardName,
      ...(account.profileAliases || []),
      ...(account.platforms || []).map(platform => platform.profile_alias)
    ].filter(Boolean));
    for (const alias of aliases) {
      meta[alias] = value;
      if (openCliAliases[alias]) meta[openCliAliases[alias]] = value;
    }
  }
  return meta;
}

function dataProfileAliasForAccountKey(value) {
  const wanted = String(value || '').trim();
  if (!wanted) return dataMaintenanceProfile.alias;
  if (wanted === dataMaintenanceProfile.alias || wanted === dataMaintenanceProfile.name) return dataMaintenanceProfile.alias;
  for (const account of catalogAccounts) {
    const aliases = new Set([
      account.id,
      account.name,
      account.dashboardName,
      ...(account.profileAliases || []),
      ...(account.platforms || []).map(platform => platform.profile_alias)
    ].filter(Boolean));
    if (aliases.has(wanted)) return account.dataProfileAlias || dataMaintenanceProfile.alias;
  }
  return wanted;
}

module.exports = {
  platformDefaults,
  dataMaintenanceProfile,
  publishAccountCatalog,
  defaultVideoPublishBindings,
  openCliBrowserProfileAliases,
  chromeProfileDirectoryMap,
  dashboardProfileMeta,
  dataProfileAliasForAccountKey,
  publishVolumeExcluded,
  readAccountPlatformStatus,
  platformIsRunnable,
  readAccountDataCollectWhitelist,
  accountDataCollectDisabledReason,
  accountDataPlatformCollectEnabled
};
