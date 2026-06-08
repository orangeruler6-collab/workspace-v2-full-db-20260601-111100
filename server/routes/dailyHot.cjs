const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

module.exports = function createDailyHotRoutes(deps) {
  const root = deps.root || path.join(__dirname, '..', '..');
  const callMiniMaxChat = deps.callMiniMaxChat;
  const dataDir = path.join(root, 'data');
  const storePath = path.join(dataDir, 'daily_hot.json');

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const DAILY_CATEGORIES = ['AI', '数码', '游戏', '杂谈'];
  const ITEMS_PER_CATEGORY = 10;
  const OPENCLI_ITEMS_PER_REFRESH = 18;
  const MAX_ARTICLE_AGE_DAYS = 10;
  const SOURCE_CAP_PER_CATEGORY = 4;
  const BILI_SOURCE_CAP = 8;
  const OPENCLI_TIMEOUT_MS = Number(process.env.OPENCLI_TIMEOUT_MS) || 25000;
  const SCHEDULE_HOUR = 9;
  let scheduleTimer = null;
  let scheduledRefreshing = false;

  const RSS_SOURCES = [
    { id: 'qbitai', label: '量子位', url: 'https://www.qbitai.com/feed', category: 'AI', weight: 34 },
    { id: 'geekpark', label: '极客公园', url: 'https://www.geekpark.net/rss', category: 'AI', weight: 32 },
    { id: 'leiphone', label: '雷峰网', url: 'https://www.leiphone.com/feed', category: 'AI', weight: 30 },
    { id: 'infoq', label: 'InfoQ', url: 'https://www.infoq.cn/feed', category: 'AI', weight: 30 },
    { id: 'oschina', label: '开源中国', url: 'https://www.oschina.net/news/rss', category: 'AI', weight: 26 },
    { id: 'sspai', label: '少数派', url: 'https://sspai.com/feed', category: '数码', weight: 34 },
    { id: 'ifanr', label: '爱范儿', url: 'https://www.ifanr.com/feed', category: '数码', weight: 32 },
    { id: 'ithome', label: 'IT之家', url: 'https://www.ithome.com/rss/', category: '数码', weight: 32 },
    { id: 'appinn', label: '小众软件', url: 'https://www.appinn.com/feed/', category: '数码', weight: 28 },
    { id: 'technode', label: '动点科技', url: 'https://cn.technode.com/feed/', category: '数码', weight: 27 },
    { id: 'yystv', label: '游研社', url: 'https://www.yystv.cn/rss/feed', category: '游戏', weight: 33 },
    { id: '36kr', label: '36氪', url: 'https://www.36kr.com/feed', category: '杂谈', weight: 28 },
    { id: 'tmtpost', label: '钛媒体', url: 'https://www.tmtpost.com/rss', category: '杂谈', weight: 28 }
  ];

  const HTML_SOURCES = [
    { id: 'gamersky', label: '游民星空', url: 'https://www.gamersky.com/news/', category: '游戏', parser: 'gamersky', weight: 34 },
    { id: '17173', label: '17173', url: 'https://news.17173.com/', category: '游戏', parser: '17173', weight: 32 },
    { id: '3dm', label: '3DM游戏网', url: 'https://www.3dmgame.com/news/', category: '游戏', parser: 'generic', pathIncludes: ['/news/'], weight: 31 },
    { id: 'ali213', label: '游侠网', url: 'https://www.ali213.net/news/', category: '游戏', parser: 'generic', pathIncludes: ['/news/'], weight: 29 },
    { id: 'gcores', label: '机核', url: 'https://www.gcores.com/', category: '游戏', parser: 'generic', pathIncludes: ['/articles'], weight: 29 },
    { id: 'chuapp', label: '触乐', url: 'https://www.chuapp.com/', category: '游戏', parser: 'generic', pathIncludes: ['/article/'], weight: 29 }
  ];

  const BLOCKED_PLATFORM_RE = /(douyin|iesdouyin|bilibili|b23\.tv|抖音|哔哩|B站)/i;

  const CATEGORY_RULES = [
    { name: 'AI', words: ['AI', '人工智能', '大模型', '模型', '机器人', 'OpenAI', 'Claude', 'DeepSeek', 'Gemini', '芯片', '算力', '智能体', 'Agent'] },
    { name: '数码', words: ['手机', '电脑', '相机', '平板', '耳机', '显示器', '苹果', '华为', '小米', 'OPPO', 'vivo', '三星', 'iPhone', 'MacBook', '硬件', '数码'] },
    { name: '游戏', words: ['游戏', '手游', '主机', '电竞', 'Steam', '任天堂', '索尼', 'Xbox', '米哈游', '王者', '原神', '黑神话', 'LCK', 'LPL', '英雄联盟'] },
    { name: '杂谈', words: ['社会', '职场', '消费', '娱乐', '体育', '财经', '生活', '电影', '明星', '热议', '回应', '网友'] }
  ];

  const OPENCLI_SOURCES = [
    {
      id: 'bilibili-ranking',
      label: 'B站排行榜',
      args: ['bilibili', 'ranking'],
      limit: 18,
      weight: 18,
      category: '',
      mapper: mapOpenCliBilibili
    },
    {
      id: 'bilibili-hot',
      label: 'B站热门',
      args: ['bilibili', 'hot'],
      limit: 18,
      weight: 17,
      category: '',
      mapper: mapOpenCliBilibili
    },
    {
      id: 'tieba-hot',
      label: '贴吧热议',
      args: ['tieba', 'hot'],
      limit: 18,
      weight: 19,
      category: '',
      mapper: mapOpenCliTieba
    },
    {
      id: 'weibo-hot',
      label: '微博热搜',
      args: ['weibo', 'hot'],
      limit: 16,
      weight: 14,
      category: '',
      mapper: mapOpenCliWeibo
    },
    {
      id: 'hupu-hot',
      label: '虎扑热帖',
      args: ['hupu', 'hot'],
      limit: 12,
      weight: 12,
      category: '杂谈',
      mapper: mapOpenCliHupu
    }
  ];

  function emptyStore() {
    return { items: [], analyses: {}, refreshes: {} };
  }

  function readStore() {
    if (!fs.existsSync(storePath)) return emptyStore();
    try {
      const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (Array.isArray(parsed)) return { items: parsed, analyses: {} };
      return Object.assign(emptyStore(), parsed || {});
    } catch(e) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    const tmpPath = storePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmpPath, storePath);
  }

  function latestCapturedAt(items) {
    return (items || []).reduce(function(max, item) {
      return Math.max(max, Number(item && item.capturedAt) || 0);
    }, 0);
  }

  function dateKey(value) {
    const d = value ? new Date(value) : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function nextScheduleDelay(now) {
    const base = now || new Date();
    const next = new Date(base);
    next.setHours(SCHEDULE_HOUR, 0, 0, 0);
    if (next.getTime() <= base.getTime()) {
      next.setDate(next.getDate() + 1);
      next.setHours(SCHEDULE_HOUR, 0, 0, 0);
    }
    return next.getTime() - base.getTime();
  }

  function scheduleNextDailyRefresh() {
    if (scheduleTimer) clearTimeout(scheduleTimer);
    scheduleTimer = setTimeout(function() {
      if (scheduledRefreshing) {
        scheduleNextDailyRefresh();
        return;
      }
      scheduledRefreshing = true;
      refreshDailyHot({
        date: dateKey(),
        sources: ['article'],
        opencliLimit: 0,
        scheduled: true
      })
        .then(function(result) {
          console.log('[daily-hot] scheduled refresh done:', result.date, Array.isArray(result.items) ? result.items.length : 0);
        })
        .catch(function(e) {
          console.warn('[daily-hot] scheduled refresh failed:', e && e.message || e);
        })
        .finally(function() {
          scheduledRefreshing = false;
          scheduleNextDailyRefresh();
        });
    }, nextScheduleDelay());
    if (scheduleTimer.unref) scheduleTimer.unref();
  }

  function hash(input) {
    return crypto.createHash('sha1').update(String(input || '')).digest('hex').slice(0, 14);
  }

  function decodeHtml(text) {
    return String(text || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&#(\d+);/g, function(_, code) {
        return String.fromCharCode(Number(code) || 0);
      })
      .replace(/&#x([0-9a-f]+);/gi, function(_, code) {
        return String.fromCharCode(parseInt(code, 16) || 0);
      })
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
  }

  function cleanText(text, maxLen) {
    return decodeHtml(String(text || '')
      .replace(/<!\[CDATA\[/g, '')
      .replace(/\]\]>/g, '')
      .replace(/<[^>]+>/g, ' '))
      .replace(/#?欢迎关注[^。]{0,80}官方微信公众号[^。]*。?/g, ' ')
      .replace(/更多精彩内容第一时间为您奉上。?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen || 220);
  }

  function normalizeTitle(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[|｜].*$/g, '')
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/gi, '')
      .slice(0, 80);
  }

  function inferCategory(title, snippet) {
    const haystack = (title || '') + ' ' + (snippet || '');
    for (const rule of CATEGORY_RULES) {
      if (rule.words.some(function(word) {
        return haystack.toLowerCase().indexOf(String(word).toLowerCase()) >= 0;
      })) return rule.name;
    }
    return '杂谈';
  }

  function normalizeCategory(category, title, snippet) {
    const value = String(category || '').trim();
    if (DAILY_CATEGORIES.indexOf(value) >= 0) return value;
    if (/AI|人工智能|模型|机器人|芯片/.test(value)) return 'AI';
    if (/数码|科技消费|手机|硬件/.test(value)) return '数码';
    if (/游戏|电竞|手游/.test(value)) return '游戏';
    return inferCategory(title, snippet);
  }

  function inferTags(title, snippet, category) {
    const haystack = (title || '') + ' ' + (snippet || '');
    const tags = [category].filter(Boolean);
    CATEGORY_RULES.forEach(function(rule) {
      rule.words.forEach(function(word) {
        if (tags.length >= 4) return;
        if (haystack.toLowerCase().indexOf(String(word).toLowerCase()) >= 0 && tags.indexOf(word) < 0) {
          tags.push(word);
        }
      });
    });
    return tags.slice(0, 4);
  }

  function heatNumber(value) {
    const raw = String(value || '').replace(/,/g, '').trim();
    const match = raw.match(/([\d.]+)/);
    if (!match) return 0;
    let num = Number(match[1]) || 0;
    if (raw.indexOf('亿') >= 0 || raw.indexOf('E') >= 0) num *= 100000000;
    else if (raw.indexOf('万') >= 0 || /W/i.test(raw)) num *= 10000;
    return num;
  }

  function isOpenCliItem(item) {
    return item && /^opencli-/.test(String(item.source || ''));
  }

  function daysSince(value) {
    const time = Number(value) || Date.parse(value || '');
    if (!time) return 7;
    return Math.max(0, (Date.now() - time) / 86400000);
  }

  function scoreFor(item) {
    const rank = Number(item.rank) || 80;
    const interaction = Number(item.heatValue) || heatNumber(item.heat);
    const rankScore = Math.max(0, 70 - rank * 2);
    const heatScore = Math.min(80, Math.log10(interaction + 1) * 18);
    const recencyScore = Math.max(0, 30 - Math.round(daysSince(item.publishedAt) * 10));
    const sourceScore = Number(item.sourceWeight) || (item.source === 'article' ? 28 : item.source === 'manual' ? 24 : 12);
    return Math.round(rankScore + heatScore + recencyScore + sourceScore);
  }

  function sourceName(source) {
    if (source === 'article') return '文章源';
    if (source === 'manual') return '手动录入';
    return '网页热点';
  }

  function isBlockedPlatformItem(item) {
    if (isOpenCliItem(item)) return false;
    const sourceText = [
      item && item.source,
      item && item.sourceLabel,
      item && item.title,
      item && item.snippet
    ].filter(Boolean).join(' ');
    const urlText = String(item && (item.url || item.link) || '');
    return BLOCKED_PLATFORM_RE.test(sourceText) || BLOCKED_PLATFORM_RE.test(urlText);
  }

  function visibleItems(items) {
    return (items || []).filter(function(item) {
      return !isBlockedPlatformItem(item);
    }).map(function(item) {
      if (!Array.isArray(item.sources)) return item;
      const sources = item.sources.filter(function(source) {
        return !isBlockedPlatformItem(source);
      });
      if (sources.length === item.sources.length) return item;
      return Object.assign({}, item, {
        sources: sources,
        sourceCount: sources.length
      });
    });
  }

  function compactItem(raw, date, capturedAt) {
    const title = cleanText(raw.title, 180);
    if (!title) return null;
    const snippet = cleanText(raw.snippet || raw.author || '', 260);
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return null;
    const category = normalizeCategory(raw.category, title, snippet);
    return {
      id: hash(date + ':' + normalizedTitle),
      date: date,
      title: title,
      normalizedTitle: normalizedTitle,
      source: raw.source || 'web',
      sourceLabel: raw.sourceLabel || sourceName(raw.source),
      url: cleanText(raw.url || raw.link || '', 400),
      snippet: snippet,
      rank: Number(raw.rank) || 0,
      heat: cleanText(raw.heat || '', 40),
      heatValue: Number(raw.heatValue) || 0,
      publishedAt: raw.publishedAt || raw.date || '',
      sourceWeight: Number(raw.sourceWeight || raw.weight) || 0,
      category: category,
      tags: inferTags(title, snippet, category),
      score: 0,
      status: 'new',
      capturedAt: capturedAt,
      sources: []
    };
  }

  function mergeSnapshot(date, rawItems) {
    const store = readStore();
    const previous = store.items.filter(function(item) { return item.date === date; });
    const oldById = new Map(previous.map(function(item) { return [item.id, item]; }));
    const oldByNorm = new Map(previous.map(function(item) { return [item.normalizedTitle, item]; }));
    const capturedAt = Date.now();
    const grouped = new Map();

    rawItems.forEach(function(raw) {
      if (isBlockedPlatformItem(raw)) return;
      const item = compactItem(raw, date, capturedAt);
      if (!item) return;
      const key = item.normalizedTitle;
      const sourceEntry = {
        source: item.source,
        sourceLabel: item.sourceLabel,
        title: item.title,
        url: item.url,
        rank: item.rank,
        heat: item.heat,
        heatValue: item.heatValue,
        snippet: item.snippet,
        publishedAt: item.publishedAt
      };

      if (!grouped.has(key)) {
        const old = oldById.get(item.id) || oldByNorm.get(key);
        item.status = old ? (old.status || 'new') : 'new';
        item.note = old ? (old.note || '') : '';
        item.sources = [sourceEntry];
        item.score = scoreFor(item);
        grouped.set(key, item);
        return;
      }

      const current = grouped.get(key);
      current.sources.push(sourceEntry);
      current.score = Math.max(current.score, scoreFor(item)) + Math.min(24, current.sources.length * 6);
      if (!current.url && item.url) current.url = item.url;
      if (!current.snippet && item.snippet) current.snippet = item.snippet;
      if ((item.sourceWeight || 0) > (current.sourceWeight || 0)) {
        current.source = item.source;
        current.sourceLabel = item.sourceLabel;
        current.rank = item.rank;
        current.heat = item.heat;
        current.sourceWeight = item.sourceWeight;
        current.publishedAt = item.publishedAt || current.publishedAt;
      }
    });

    const merged = Array.from(grouped.values())
      .map(function(item) {
        item.sourceCount = item.sources.length;
        item.score = Math.min(200, Math.round(item.score));
        return item;
      })
      .sort(function(a, b) { return b.score - a.score; })
      .map(function(item, index) {
        item.dailyRank = index + 1;
        return item;
      });

    store.items = store.items.filter(function(item) { return item.date !== date; }).concat(merged);
    store.refreshes = store.refreshes || {};
    store.refreshes[date] = capturedAt;
    writeStore(store);
    return { items: merged, analysis: store.analyses[date] || null, refreshedAt: capturedAt };
  }

  function statsFor(items) {
    const visible = visibleItems(items);
    const active = visible.filter(function(item) { return item.status !== 'ignored'; });
    const categories = {};
    const sources = {};
    active.forEach(function(item) {
      categories[item.category || '其他'] = (categories[item.category || '其他'] || 0) + 1;
      sources[item.sourceLabel || sourceName(item.source)] = (sources[item.sourceLabel || sourceName(item.source)] || 0) + 1;
    });
    return {
      total: visible.length,
      active: active.length,
      saved: visible.filter(function(item) { return item.status === 'saved'; }).length,
      converted: visible.filter(function(item) { return item.status === 'converted'; }).length,
      hot: active.filter(function(item) { return item.score >= 120; }).length,
      categories: categories,
      sources: sources
    };
  }

  function fetchText(url, timeoutMs, redirects) {
    redirects = redirects || 0;
    return new Promise(function(resolve, reject) {
      let parsed;
      try { parsed = new URL(url); }
      catch(e) { reject(e); return; }

      const client = parsed.protocol === 'https:' ? https : http;
      const req = client.get(parsed, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 UsagiDailyHot/1.0',
          'Accept': 'application/rss+xml, application/xml, text/xml, text/html;q=0.8,*/*;q=0.6',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
        }
      }, function(res) {
        const location = res.headers.location;
        if (location && res.statusCode >= 300 && res.statusCode < 400 && redirects < 3) {
          res.resume();
          resolve(fetchText(new URL(location, parsed).toString(), timeoutMs, redirects + 1));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error('HTTP ' + res.statusCode));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on('data', function(chunk) {
          size += chunk.length;
          if (size <= 1024 * 1024) chunks.push(chunk);
        });
        res.on('end', function() {
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
      req.on('error', reject);
      req.setTimeout(timeoutMs || 8000, function() {
        req.destroy(new Error('timeout'));
      });
    });
  }

  function extractXml(block, tag) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(block || '').match(new RegExp('<' + escaped + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + escaped + '>', 'i'));
    return match ? cleanText(match[1], 500) : '';
  }

  function extractAtomLink(block) {
    const match = String(block || '').match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    return match ? cleanText(match[1], 500) : '';
  }

  function extractAttr(block, name) {
    const match = String(block || '').match(new RegExp(name + "=[\"']([^\"']+)[\"']", 'i'));
    return match ? decodeHtml(match[1]).trim() : '';
  }

  function normalizeUrl(url, baseUrl) {
    const value = String(url || '').trim();
    if (!value) return '';
    try {
      if (value.indexOf('//') === 0) return 'https:' + value;
      return new URL(value, baseUrl).toString();
    } catch(e) {
      return value;
    }
  }

  function parseDateTime(text) {
    const value = String(text || '').trim();
    if (!value) return 0;
    const normalized = value.replace(/年|\/|\./g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/\s+/, 'T');
    const parsed = Date.parse(normalized.length <= 16 ? normalized + ':00+08:00' : normalized + '+08:00');
    return parsed || Date.parse(value) || 0;
  }

  function parseDateFromUrl(url) {
    const value = String(url || '');
    let match = value.match(/(?:^|[^\d])(20\d{2})[\/\-_](\d{1,2})[\/\-_](\d{1,2})(?:[^\d]|$)/);
    if (!match) match = value.match(/(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?:[^\d]|$)/);
    if (!match) return 0;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
  }

  function isFreshArticleItem(item) {
    return daysSince(item && item.publishedAt) <= MAX_ARTICLE_AGE_DAYS;
  }

  function isLikelyArticleTitle(title) {
    const value = cleanText(title, 180);
    if (value.length < 8 || value.length > 120) return false;
    if (!/[\u4e00-\u9fa5A-Za-z0-9]/.test(value)) return false;
    if (/^(首页|新闻|资讯|下载|论坛|社区|游戏库|排行榜|更多|登录|注册|广告|专题|专栏|视频|图片|进入|查看|全部)$/i.test(value)) return false;
    if (/(点击进入|查看更多|上一页|下一页|返回首页|客户端下载|用户协议)/i.test(value)) return false;
    return true;
  }

  function isLikelyArticleUrl(url, source) {
    if (!/^https?:\/\//i.test(url)) return false;
    if (BLOCKED_PLATFORM_RE.test(url)) return false;
    if (/\.(jpg|jpeg|png|gif|webp|mp4|mp3|zip|rar|apk)(?:[?#].*)?$/i.test(url)) return false;
    try {
      const parsed = new URL(url);
      const base = new URL(source.url);
      const baseHost = base.hostname.replace(/^www\./, '');
      const parsedHost = parsed.hostname.replace(/^www\./, '');
      if (parsedHost !== baseHost && !parsedHost.endsWith('.' + baseHost)) return false;
      if (Array.isArray(source.pathIncludes) && source.pathIncludes.length) {
        return source.pathIncludes.some(function(part) {
          return parsed.pathname.indexOf(part) >= 0;
        });
      }
      return true;
    } catch(e) {
      return false;
    }
  }

  function parse17173Date(url) {
    const match = String(url || '').match(/content\/(\d{2})(\d{2})(\d{4})\/(\d{2})(\d{2})(\d{2})/);
    if (!match) return 0;
    return new Date(
      Number(match[3]),
      Number(match[1]) - 1,
      Number(match[2]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    ).getTime();
  }

  function parseFeed(raw, source) {
    const text = String(raw || '');
    const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    return blocks.map(function(block, index) {
      const title = extractXml(block, 'title');
      const link = extractXml(block, 'link') || extractAtomLink(block);
      const snippet = extractXml(block, 'description') || extractXml(block, 'summary') || extractXml(block, 'content:encoded') || extractXml(block, 'content');
      const publishedRaw = extractXml(block, 'pubDate') || extractXml(block, 'published') || extractXml(block, 'updated') || extractXml(block, 'dc:date');
      const publishedAt = Date.parse(publishedRaw) || 0;
      if (!title || !/^https?:\/\//i.test(link)) return null;
      return {
        title: title,
        url: link,
        snippet: snippet,
        publishedAt: publishedAt || publishedRaw,
        heat: '',
        heatValue: 0,
        category: source.category,
        source: 'article',
        sourceLabel: source.label,
        sourceWeight: source.weight,
        rank: index + 1
      };
    }).filter(Boolean);
  }

  function parseGamersky(raw, source) {
    const blocks = String(raw || '').match(/<li\b[\s\S]*?<\/li>/gi) || [];
    const items = [];
    const seen = new Set();
    blocks.forEach(function(block) {
      const anchor = (block.match(/<a[^>]+class=["'][^"']*\btt\b[^"']*["'][^>]*>[\s\S]*?<\/a>/i) || [])[0] || '';
      const url = normalizeUrl(extractAttr(anchor, 'href'), source.url);
      const title = cleanText(extractAttr(anchor, 'title') || anchor, 180);
      if (!url || !title || seen.has(url)) return;
      seen.add(url);
      const snippet = cleanText((block.match(/<div[^>]+class=["']txt["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '', 220);
      const timeText = cleanText((block.match(/<div[^>]+class=["']time["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '', 40);
      const rank = items.length + 1;
      items.push({
        title: title,
        url: url,
        snippet: snippet,
        publishedAt: parseDateTime(timeText),
        heat: '列表第 ' + rank + ' 位',
        heatValue: Math.max(0, 90 - rank * 2),
        category: source.category,
        source: 'article',
        sourceLabel: source.label,
        sourceWeight: source.weight,
        rank: rank
      });
    });
    return items;
  }

  function parse17173(raw, source) {
    const items = [];
    const seen = new Set();
    const re = /<a[^>]+href=["']([^"']*news\.17173\.com\/content\/[^"']+\.shtml)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = re.exec(String(raw || '')))) {
      const url = normalizeUrl(match[1], source.url);
      const title = cleanText(match[2], 180);
      if (!url || !title || title.length < 8 || seen.has(url)) continue;
      seen.add(url);
      const rank = items.length + 1;
      items.push({
        title: title,
        url: url,
        snippet: '',
        publishedAt: parse17173Date(url),
        heat: '列表第 ' + rank + ' 位',
        heatValue: Math.max(0, 82 - rank * 2),
        category: source.category,
        source: 'article',
        sourceLabel: source.label,
        sourceWeight: source.weight,
        rank: rank
      });
    }
    return items;
  }

  function parseHupu(raw, source) {
    const match = String(raw || '').match(/<script>window\.\$\$data=(\{[\s\S]*?\})<\/script>/);
    if (!match) return [];
    let data;
    try { data = JSON.parse(match[1]); }
    catch(e) { return []; }
    const threads = data && data.pageData && Array.isArray(data.pageData.threads) ? data.pageData.threads : [];
    const capturedAt = Date.now();
    return threads.map(function(item, index) {
      const replies = Number(item.replies) || 0;
      const lights = Number(item.lights || item.lightReply) || 0;
      const nps = Number(item.nps) || 0;
      const heatValue = replies * 3 + lights * 8 + nps * 4;
      return {
        title: item.title || '',
        url: normalizeUrl(item.url || (item.tid ? '/' + item.tid + '.html' : ''), source.url),
        snippet: cleanText(item.desc || item.forum_name || item.topic && item.topic.name || '', 240),
        publishedAt: capturedAt,
        heat: '回帖 ' + replies + ' / 亮 ' + lights,
        heatValue: heatValue,
        category: source.category,
        source: 'article',
        sourceLabel: source.label,
        sourceWeight: source.weight,
        rank: index + 1
      };
    }).filter(function(item) {
      return item.title && item.url;
    });
  }

  function parseGenericHtml(raw, source) {
    const items = [];
    const seen = new Set();
    const text = String(raw || '');
    const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/gi;
    let match;
    while ((match = re.exec(text))) {
      const anchor = match[0];
      const url = normalizeUrl(match[1], source.url);
      const title = cleanText(extractAttr(anchor, 'title') || anchor, 180);
      const norm = normalizeTitle(title);
      if (!isLikelyArticleUrl(url, source) || !isLikelyArticleTitle(title) || seen.has(url) || seen.has(norm)) continue;
      seen.add(url);
      seen.add(norm);

      const contextStart = Math.max(0, match.index - 260);
      const contextEnd = Math.min(text.length, match.index + anchor.length + 360);
      const context = text.slice(contextStart, contextEnd);
      const snippet = cleanText((context.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '', 220);
      const timeText = cleanText((context.match(/20\d{2}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}日?(?:\s+\d{1,2}:\d{2})?/) || [])[0] || '', 40);
      const rank = items.length + 1;
      items.push({
        title: title,
        url: url,
        snippet: snippet,
        publishedAt: parseDateTime(timeText) || parseDateFromUrl(url),
        heat: '列表第 ' + rank + ' 位',
        heatValue: Math.max(0, 80 - rank * 2),
        category: source.category,
        source: 'article',
        sourceLabel: source.label,
        sourceWeight: source.weight,
        rank: rank
      });
      if (items.length >= 36) break;
    }
    return items;
  }

  function parseHtmlSource(raw, source) {
    if (source.parser === 'gamersky') return parseGamersky(raw, source);
    if (source.parser === '17173') return parse17173(raw, source);
    if (source.parser === 'hupu') return parseHupu(raw, source);
    if (source.parser === 'generic') return parseGenericHtml(raw, source);
    return [];
  }

  function sourceCapFor(item) {
    const sourceKey = item.sourceLabel || item.source || '未知来源';
    if (sourceKey === 'B站排行榜' || sourceKey === 'B站热门') return BILI_SOURCE_CAP;
    if (sourceKey === '贴吧热议') return 8;
    if (sourceKey === '微博热搜') return 6;
    if (sourceKey === '虎扑热帖') return 4;
    return SOURCE_CAP_PER_CATEGORY;
  }

  function dedupeKeyForSelection(item) {
    const normTitle = normalizeTitle(item.title);
    if (isOpenCliItem(item) && item.url) return item.url;
    return normTitle || item.url;
  }

  function openCliRelevance(item) {
    const text = [item.title, item.snippet, item.owner, item.category, (item.tags || []).join(' ')].filter(Boolean).join(' ').toLowerCase();
    const gameWords = ['游戏', '手游', '主机', '电竞', 'steam', '任天堂', 'switch', '索尼', 'xbox', '米哈游', '鸣潮', '尘白', '王者', '原神', '黑神话', '赛博朋克', 'lpl', 'lck', '玩家', '开服', '联动'];
    const funWords = ['离谱', '奇葩', '神奇', '惊现', '争议', '投诉', '翻车', '吐槽', '网友', '热议', '回应', '道歉', '涨价', '删评', '销号', '整活'];
    const digitalWords = ['手机', '电脑', '相机', '平板', '耳机', '显示器', '苹果', '华为', '小米', 'oppo', 'vivo', '三星', 'iphone', 'macbook', '硬件', '数码'];
    let score = 0;
    gameWords.forEach(function(word) { if (text.indexOf(word) >= 0) score += 4; });
    funWords.forEach(function(word) { if (text.indexOf(word) >= 0) score += 3; });
    if (!/^opencli-bilibili/.test(String(item.source || ''))) {
      digitalWords.forEach(function(word) { if (text.indexOf(word) >= 0) score += 2; });
    }
    if (item.category === '游戏') score += 5;
    if (item.category === '杂谈') score += 2;
    if (/^opencli-bilibili/.test(String(item.source || '')) && score === 0) score -= 6;
    return score;
  }

  function normalizeOpenCliCategory(item) {
    const text = [item.title, item.snippet, item.owner, (item.tags || []).join(' ')].filter(Boolean).join(' ');
    const isBilibili = /^opencli-bilibili/.test(String(item.source || ''));
    if (/(游戏|手游|主机|电竞|Steam|任天堂|Switch|索尼|Xbox|米哈游|鸣潮|尘白|王者|原神|黑神话|赛博朋克|LPL|LCK|玩家|开服|联动|Horsey Game)/i.test(text)) return '游戏';
    if (!isBilibili && /(手机|电脑|相机|平板|耳机|显示器|苹果|华为|小米|OPPO|vivo|三星|iPhone|MacBook|硬件|数码)/i.test(text)) return '数码';
    if (/(AI|人工智能|大模型|模型|机器人|OpenAI|Claude|DeepSeek|Gemini|芯片|算力|智能体|Agent)/i.test(text)) return 'AI';
    if (isBilibili) return '杂谈';
    return normalizeCategory(item.category, item.title, item.snippet);
  }

  function selectOpenCliItems(rawItems, limit) {
    const groups = { 游戏: [], 杂谈: [], 数码: [], AI: [] };
    const sourceCounts = {};
    const selected = new Set();
    const categoryLimits = { 游戏: 8, 杂谈: 8, 数码: 2, AI: 0 };
    const sourceCaps = { B站排行榜: 5, B站热门: 5, 贴吧热议: 6, 微博热搜: 4, 虎扑热帖: 2 };
    const sorted = (rawItems || []).filter(function(item) {
      return isOpenCliItem(item) && isFreshArticleItem(item);
    }).map(function(item) {
      const category = normalizeOpenCliCategory(item);
      const relevance = openCliRelevance(Object.assign({}, item, { category: category }));
      return Object.assign({}, item, {
        category: category,
        _relevance: relevance,
        _selectionScore: scoreFor(Object.assign({}, item, { category: category })) + relevance * 8
      });
    }).filter(function(item) {
      return !/^opencli-bilibili/.test(String(item.source || '')) || item._relevance >= 4;
    }).sort(function(a, b) {
      return b._selectionScore - a._selectionScore;
    });

    function tryPick(item, ignoreCategoryLimit) {
      if (!groups[item.category]) return false;
      if (!ignoreCategoryLimit && groups[item.category].length >= (categoryLimits[item.category] || 0)) return false;
      const sourceKey = item.sourceLabel || item.source || '未知来源';
      if ((sourceCounts[sourceKey] || 0) >= (sourceCaps[sourceKey] || 3)) return false;
      const key = dedupeKeyForSelection(item);
      if (!key || selected.has(key)) return false;
      selected.add(key);
      sourceCounts[sourceKey] = (sourceCounts[sourceKey] || 0) + 1;
      groups[item.category].push(item);
      return true;
    }

    sorted.forEach(function(item) { tryPick(item, false); });
    sorted.forEach(function(item) {
      if (selected.size >= (Number(limit) || OPENCLI_ITEMS_PER_REFRESH)) return;
      tryPick(item, true);
    });

    return ['游戏', '杂谈', '数码', 'AI'].reduce(function(all, name) {
      return all.concat(groups[name]);
    }, []).slice(0, Number(limit) || OPENCLI_ITEMS_PER_REFRESH).map(function(item) {
      delete item._selectionScore;
      return item;
    });
  }

  function selectCategoryItems(rawItems, perCategory) {
    const groups = DAILY_CATEGORIES.reduce(function(acc, name) {
      acc[name] = [];
      return acc;
    }, {});
    const sourceCounts = DAILY_CATEGORIES.reduce(function(acc, name) {
      acc[name] = {};
      return acc;
    }, {});
    const selected = new Set();
    const limits = typeof perCategory === 'object' ? perCategory : DAILY_CATEGORIES.reduce(function(acc, name) {
      acc[name] = Math.max(1, Number(perCategory) || ITEMS_PER_CATEGORY);
      return acc;
    }, {});
    const sorted = (rawItems || []).filter(function(item) {
      return !isBlockedPlatformItem(item) && isFreshArticleItem(item);
    }).map(function(item) {
      const category = normalizeCategory(item.category, item.title, item.snippet);
      return Object.assign({}, item, {
        category: category,
        _selectionScore: scoreFor(Object.assign({}, item, { category: category }))
      });
    }).sort(function(a, b) {
      return b._selectionScore - a._selectionScore;
    });

    sorted.forEach(function(item) {
      if (!groups[item.category] || groups[item.category].length >= (limits[item.category] || ITEMS_PER_CATEGORY)) return;
      const sourceKey = item.sourceLabel || item.source || '未知来源';
      const sourceCap = sourceCapFor(item);
      if ((sourceCounts[item.category][sourceKey] || 0) >= sourceCap) return;
      // B站视频用URL去重（标题可能全英文），其他用规范化标题
      const key = dedupeKeyForSelection(item);
      if (!key) return;
      if (selected.has(key)) return;
      selected.add(key);
      sourceCounts[item.category][sourceKey] = (sourceCounts[item.category][sourceKey] || 0) + 1;
      groups[item.category].push(item);
    });

    sorted.forEach(function(item) {
      if (!groups[item.category] || groups[item.category].length >= (limits[item.category] || ITEMS_PER_CATEGORY)) return;
      const key = dedupeKeyForSelection(item);
      if (!key || selected.has(key)) return;
      selected.add(key);
      groups[item.category].push(item);
    });

    return DAILY_CATEGORIES.reduce(function(all, name) {
      return all.concat(groups[name].map(function(item) {
        delete item._selectionScore;
        return item;
      }));
    }, []);
  }

  async function collectArticles(limit, errors) {
    const perSource = Math.min(24, Math.max(10, Number(limit) || 40));
    const rssBatches = RSS_SOURCES.map(function(source) {
      return fetchText(source.url, 9000).then(function(raw) {
        return parseFeed(raw, source).slice(0, perSource);
      }).catch(function(e) {
        if (errors) errors.push(source.label + '：' + e.message);
        return [];
      });
    });
    const htmlBatches = HTML_SOURCES.map(function(source) {
      return fetchText(source.url, 9000).then(function(raw) {
        return parseHtmlSource(raw, source).slice(0, perSource);
      }).catch(function(e) {
        if (errors) errors.push(source.label + '：' + e.message);
        return [];
      });
    });
    const batches = await Promise.all(rssBatches.concat(htmlBatches));
    return batches.reduce(function(all, batch) { return all.concat(batch); }, []);
  }

  function parseOpenCliJson(stdout) {
    const text = String(stdout || '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.items)) return parsed.items;
      if (parsed.data && Array.isArray(parsed.data.items)) return parsed.data.items;
      if (Array.isArray(parsed.data)) return parsed.data;
      return [];
    } catch(e) {
      const firstArray = text.indexOf('[');
      const lastArray = text.lastIndexOf(']');
      if (firstArray >= 0 && lastArray > firstArray) {
        return JSON.parse(text.slice(firstArray, lastArray + 1));
      }
      throw e;
    }
  }

  function runOpenCli(source) {
    return new Promise(function(resolve, reject) {
      const env = Object.assign({}, process.env, {
        PYTHONIOENCODING: 'utf-8',
        NO_COLOR: '1'
      });
      const args = source.args
        .concat(source.limit === 0 ? [] : ['--limit', String(source.limit || 10)])
        .concat(['-f', 'json']);
      const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'opencli';
      const commandArgs = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'opencli.cmd'].concat(args)
        : args;
      const child = spawn(command, commandArgs, {
        cwd: root,
        env: env,
        shell: false,
        windowsHide: true
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(function() {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error('timeout'));
      }, OPENCLI_TIMEOUT_MS);

      child.stdout.on('data', function(chunk) { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', function(chunk) { stderr += chunk.toString('utf8'); });
      child.on('close', function(code) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error((stderr || stdout || ('exit ' + code)).slice(0, 240)));
          return;
        }
        try {
          resolve(parseOpenCliJson(stdout));
        } catch(e) {
          reject(new Error('parse failed: ' + e.message));
        }
      });
      child.on('error', function(e) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  function hotValueLabel(value, suffix) {
    const num = Number(value) || 0;
    if (!num) return '';
    if (num >= 100000000) return (num / 100000000).toFixed(1).replace(/\.0$/, '') + '亿' + (suffix || '');
    if (num >= 10000) return (num / 10000).toFixed(1).replace(/\.0$/, '') + '万' + (suffix || '');
    return String(num) + (suffix || '');
  }

  function openCliHeatScore(value, scale) {
    const raw = Number(value) || 0;
    if (!raw) return 0;
    return Math.round(Math.log10(raw + 1) * (scale || 10));
  }

  function fieldListToObject(list) {
    return (list || []).reduce(function(acc, row) {
      if (row && row.field) acc[row.field] = row.value;
      return acc;
    }, {});
  }

  function bvidFromUrl(url) {
    const match = String(url || '').match(/BV[a-zA-Z0-9]+/);
    return match ? match[0] : '';
  }

  function cleanOpenCliDescription(text) {
    const value = cleanText(text, 220);
    if (!value || value === '-' || value === '无') return '';
    return value;
  }

  function summarizeBilibiliItem(title, author, detail) {
    const desc = cleanOpenCliDescription(detail.description || '');
    const parts = [];
    if (desc) parts.push(desc.split(/[。！？!?]\s*/).filter(Boolean).slice(0, 2).join('。').slice(0, 140));
    if (detail.duration) parts.push('时长：' + cleanText(detail.duration, 28));
    if (author) parts.push('UP主：' + author);
    return parts.join(' ｜ ').slice(0, 240);
  }

  function mapOpenCliBilibili(item, index, source) {
    const detail = item.detail || {};
    const play = Number(item.play || item.view || detail.view || item.score || item.hot_value) || 0;
    const danmaku = Number(item.danmaku || detail.danmaku) || 0;
    const like = Number(detail.like) || 0;
    const coin = Number(detail.coin) || 0;
    const favorite = Number(detail.favorite) || 0;
    const share = Number(detail.share) || 0;
    const heatValue = openCliHeatScore(play + danmaku * 8 + like * 5 + coin * 10 + favorite * 8 + share * 15, 8);
    const title = item.title || item.word || '';
    const author = cleanText(String(detail.author || item.author || '').replace(/\s*\(mid:\s*\d+\)\s*$/i, ''), 60);
    const snippet = summarizeBilibiliItem(title, author, detail);
    const publishedAt = detail.publish_time ? parseDateTime(detail.publish_time) : Date.now();
    return {
      title: title,
      snippet: snippet,
      url: item.url || (item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : ''),
      source: 'opencli-' + source.id,
      sourceLabel: source.label,
      rank: Number(item.rank) || index + 1,
      heat: hotValueLabel(play || item.score, play ? '播放' : '热度'),
      heatValue: heatValue,
      category: normalizeOpenCliCategory({ source: 'opencli-' + source.id, title: title, snippet: snippet }),
      tags: ['平台热榜'],
      publishedAt: publishedAt || Date.now(),
      sourceWeight: source.weight
    };
  }

  function mapOpenCliTieba(item, index, source) {
    const title = item.title || item.word || '';
    const snippet = item.description || item.desc || '';
    const heatValue = openCliHeatScore(heatNumber(item.discussions || item.hot_value || item.heat || ''), 10);
    return {
      title: title,
      snippet: snippet,
      url: item.url || '',
      source: 'opencli-' + source.id,
      sourceLabel: source.label,
      rank: Number(item.rank) || index + 1,
      heat: item.discussions || hotValueLabel(item.hot_value, '热度'),
      heatValue: heatValue,
      category: normalizeOpenCliCategory({ title: title, snippet: snippet }),
      tags: ['平台热榜'],
      publishedAt: Date.now(),
      sourceWeight: source.weight
    };
  }

  function mapOpenCliWeibo(item, index, source) {
    const title = item.word || item.title || '';
    const snippet = [item.category, item.label].filter(Boolean).join(' / ');
    return {
      title: title,
      snippet: snippet,
      url: item.url || '',
      source: 'opencli-' + source.id,
      sourceLabel: source.label,
      rank: Number(item.rank) || index + 1,
      heat: hotValueLabel(item.hot_value, '热度'),
      heatValue: openCliHeatScore(Number(item.hot_value) || 0, 9),
      category: normalizeOpenCliCategory({ category: item.category, title: title, snippet: snippet }),
      tags: ['平台热榜'],
      publishedAt: Date.now(),
      sourceWeight: source.weight
    };
  }

  function mapOpenCliHupu(item, index, source) {
    const title = item.title || '';
    return {
      title: title,
      snippet: item.description || '',
      url: item.url || (item.tid ? 'https://bbs.hupu.com/' + item.tid + '.html' : ''),
      source: 'opencli-' + source.id,
      sourceLabel: source.label,
      rank: Number(item.rank) || index + 1,
      heat: '热帖第 ' + (Number(item.rank) || index + 1) + ' 位',
      heatValue: Math.max(0, 90 - (Number(item.rank) || index + 1) * 3),
      category: normalizeOpenCliCategory({ category: source.category, title: title, snippet: item.description || '' }),
      tags: ['平台热榜'],
      publishedAt: Date.now(),
      sourceWeight: source.weight
    };
  }

  async function enrichOpenCliBilibiliItems(list, source, errors) {
    const items = list || [];
    const detailLimit = Math.min(10, items.length);
    const enriched = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = Object.assign({}, items[i]);
      if (i < detailLimit) {
        const bvid = item.bvid || bvidFromUrl(item.url);
        if (bvid) {
          try {
            item.detail = fieldListToObject(await runOpenCli({
              id: source.id + '-video',
              args: ['bilibili', 'video', bvid],
              limit: 0
            }));
          } catch(e) {
            if (errors) errors.push(source.label + '详情：' + e.message);
          }
        }
      }
      enriched.push(item);
    }
    return enriched;
  }

  async function collectOpenCliSources(errors) {
    const batches = await Promise.all(OPENCLI_SOURCES.map(function(source) {
      return runOpenCli(source).then(async function(list) {
        const sourceItems = source.mapper === mapOpenCliBilibili
          ? await enrichOpenCliBilibiliItems(list, source, errors)
          : (list || []);
        return sourceItems.map(function(item, index) {
          return source.mapper(item, index, source);
        }).filter(function(item) {
          return item && item.title;
        });
      }).catch(function(e) {
        if (errors) errors.push(source.label + '：' + e.message);
        return [];
      });
    }));
    return batches.reduce(function(all, batch) { return all.concat(batch); }, []);
  }

  async function refreshDailyHot(body) {
    const date = body.date || dateKey();
    const articleItems = [];
    const openCliItems = [];
    const errors = [];
    const requestedLimit = Number(body.limit) || DAILY_CATEGORIES.length * ITEMS_PER_CATEGORY;
    const articlePerCategory = Math.max(1, Math.floor(requestedLimit / DAILY_CATEGORIES.length));
    const openCliLimit = body.opencliLimit === 0 ? 0 : (Number(body.opencliLimit) || OPENCLI_ITEMS_PER_REFRESH);

    try {
      const rawOpenCliItems = openCliLimit > 0 ? await collectOpenCliSources(errors) : [];
      openCliItems.push.apply(openCliItems, selectOpenCliItems(rawOpenCliItems, openCliLimit));
    }
    catch(e) { errors.push('OpenCLI：' + e.message); }

    try {
      const rawArticleItems = await collectArticles(requestedLimit, errors);
      articleItems.push.apply(articleItems, selectCategoryItems(rawArticleItems, articlePerCategory));
    }
    catch(e) { errors.push('文章源：' + e.message); }

    if (!articleItems.length) {
      const store = readStore();
      const previousArticleItems = visibleItems(store.items)
        .filter(function(item) {
          return item.date === date && !isOpenCliItem(item);
        })
        .sort(function(a, b) { return (a.dailyRank || 9999) - (b.dailyRank || 9999); });
      if (previousArticleItems.length) {
        articleItems.push.apply(articleItems, previousArticleItems);
        errors.push('文章源本次未抓到新数据，已保留当天既有网站源数据');
      }
    }

    const result = mergeSnapshot(date, articleItems.concat(openCliItems));
    return {
      date: date,
      items: result.items,
      stats: Object.assign(statsFor(result.items), { refreshedAt: result.refreshedAt }),
      analysis: result.analysis,
      refreshedAt: result.refreshedAt,
      errors: errors
    };
  }

  function fallbackAnalysis(date, items) {
    const active = items.filter(function(item) { return item.status !== 'ignored'; });
    const top = active.slice(0, 8);
    const categoryNames = Object.entries(statsFor(active).categories)
      .sort(function(a, b) { return b[1] - a[1]; })
      .map(function(entry) { return entry[0]; })
      .slice(0, 4);
    const keywords = [];
    top.forEach(function(item) {
      (item.tags || []).forEach(function(tag) {
        if (keywords.indexOf(tag) < 0 && keywords.length < 8) keywords.push(tag);
      });
    });
    return {
      summary: date + ' 共收集 ' + items.length + ' 条热点，主要集中在 ' + (categoryNames.join('、') || '综合话题') + '。',
      keywords: keywords,
      angles: top.slice(0, 5).map(function(item) {
        return {
          hotId: item.id,
          title: item.title,
          angle: '围绕「' + item.title.slice(0, 24) + '」做现象拆解',
          reason: '热度分 ' + item.score + '，适合作为今日选题入口。'
        };
      }),
      updatedAt: Date.now(),
      fallback: true
    };
  }

  async function analyzeDailyHot(body) {
    const date = body.date || dateKey();
    const store = readStore();
    const items = visibleItems(store.items)
      .filter(function(item) { return item.date === date; })
      .sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    if (!items.length) return { date: date, analysis: fallbackAnalysis(date, []) };

    let analysis = fallbackAnalysis(date, items);
    if (callMiniMaxChat) {
      try {
        const topText = items.slice(0, 18).map(function(item, index) {
          return (index + 1) + '. [' + item.category + '] ' + item.title + '｜分数' + item.score + '｜来源' + (item.sourceLabel || item.source);
        }).join('\n');
        const raw = await callMiniMaxChat(
          '你是内容选题运营。请只输出JSON，不要解释。格式：{"summary":"80字以内今日文章热点概览","keywords":["词1","词2"],"angles":[{"hotId":"可空","title":"热点标题","angle":"可执行选题切角","reason":"为什么值得做"}]}',
          '日期：' + date + '\n热点列表：\n' + topText,
          1600
        );
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          analysis = {
            summary: cleanText(parsed.summary, 180) || analysis.summary,
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(function(x) { return cleanText(x, 20); }).filter(Boolean).slice(0, 10) : analysis.keywords,
            angles: Array.isArray(parsed.angles) ? parsed.angles.map(function(x, index) {
              return {
                hotId: x.hotId || items[index] && items[index].id || '',
                title: cleanText(x.title || items[index] && items[index].title || '', 120),
                angle: cleanText(x.angle, 160),
                reason: cleanText(x.reason, 160)
              };
            }).filter(function(x) { return x.angle; }).slice(0, 6) : analysis.angles,
            updatedAt: Date.now()
          };
        }
      } catch(e) {
        analysis.error = e.message;
      }
    }

    store.analyses[date] = analysis;
    writeStore(store);
    return { date: date, analysis: analysis };
  }

  function listDailyHot(body) {
    const date = body.date || dateKey();
    const store = readStore();
    const items = visibleItems(store.items)
      .filter(function(item) { return item.date === date; })
      .sort(function(a, b) { return (a.dailyRank || 9999) - (b.dailyRank || 9999); });
    const refreshedAt = Number(store.refreshes && store.refreshes[date]) || latestCapturedAt(items);
    return {
      date: date,
      items: items,
      stats: Object.assign(statsFor(items), { refreshedAt: refreshedAt }),
      refreshedAt: refreshedAt,
      analysis: store.analyses[date] || null
    };
  }

  scheduleNextDailyRefresh();

  return {
    '/api/daily-hot/list': function(body, cb) {
      cb(listDailyHot(body));
    },

    '/api/daily-hot/refresh': function(body, cb) {
      refreshDailyHot(body || {}).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/daily-hot/analyze': function(body, cb) {
      analyzeDailyHot(body || {}).then(cb).catch(function(e) {
        cb({ error: e.message });
      });
    },

    '/api/daily-hot/update-status': function(body, cb) {
      const id = body.id || '';
      const status = body.status || 'new';
      const allowed = ['new', 'saved', 'converted', 'ignored'];
      if (!id || allowed.indexOf(status) < 0) { cb({ error: 'invalid status' }); return; }
      const store = readStore();
      let updated = null;
      store.items = store.items.map(function(item) {
        if (item.id !== id) return item;
        updated = Object.assign({}, item, { status: status, updatedAt: Date.now() });
        return updated;
      });
      writeStore(store);
      cb({ item: updated });
    },

    '/api/daily-hot/manual-add': function(body, cb) {
      const date = body.date || dateKey();
      if (!body.title) { cb({ error: 'title required' }); return; }
      const store = readStore();
      const existing = visibleItems(store.items).filter(function(item) { return item.date === date; });
      const rawItems = [];
      existing.forEach(function(item) {
        if (Array.isArray(item.sources) && item.sources.length) {
          item.sources.forEach(function(source) {
            rawItems.push(Object.assign({}, source, {
              category: item.category,
              source: source.source || item.source,
              sourceLabel: source.sourceLabel || item.sourceLabel
            }));
          });
        } else {
          rawItems.push(item);
        }
      });
      rawItems.push({
        title: body.title,
        url: body.url || '',
        snippet: body.snippet || '',
        category: body.category || '',
        source: 'manual',
        sourceLabel: '手动录入',
        rank: 1
      });
      const result = mergeSnapshot(date, rawItems);
      cb({ date: date, items: result.items, stats: statsFor(result.items) });
    }
  };
};
