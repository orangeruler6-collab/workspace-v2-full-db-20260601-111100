const { spawn } = require('child_process');

module.exports = function createVectorRoutes(deps) {
  const runPython = deps.runPython;
  const callMiniMaxChat = deps.callMiniMaxChat;

  function clampLimit(value, fallback, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(max, Math.round(n)));
  }

  function extractJson(raw) {
    const text = String(raw || '').trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch(e) {}
    const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (!match) return null;
    try { return JSON.parse(match[1]); } catch(e) {}
    return null;
  }

  function runOpenCli(args, timeoutMs) {
    return new Promise(function(resolve) {
      const child = spawn('cmd.exe', ['/c', 'opencli'].concat(args), {
        shell: false,
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
      });
      const out = [];
      const err = [];
      let done = false;
      const timer = setTimeout(function() {
        if (done) return;
        done = true;
        try { child.kill(); } catch(e) {}
        resolve({ ok: false, error: 'opencli timeout', stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') });
      }, timeoutMs || 120000);
      child.stdout.on('data', function(c) { out.push(c); });
      child.stderr.on('data', function(c) { err.push(c); });
      child.on('error', function(e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, error: e.message });
      });
      child.on('close', function(code) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(out).toString('utf8');
        const stderr = Buffer.concat(err).toString('utf8');
        resolve({ ok: code === 0, code: code, stdout: stdout, stderr: stderr, error: code === 0 ? '' : (stderr || stdout).substring(0, 500) });
      });
    });
  }

  function normalizePlatform(value) {
    const raw = String(value || '').toLowerCase();
    if (raw.indexOf('bili') >= 0 || raw.indexOf('b站') >= 0) return 'bilibili';
    return 'douyin';
  }

  function normalizeAccountInput(platform, account) {
    let value = String(account || '').trim();
    if (platform === 'douyin') {
      const match = value.match(/\/user\/([^/?#\s]+)/i);
      if (match) value = match[1];
    }
    if (platform === 'bilibili') {
      const match = value.match(/space\.bilibili\.com\/(\d+)/i);
      if (match) value = match[1];
    }
    return value;
  }

  function normalizeCollectedRows(platform, parsed, fallbackAccount) {
    const rows = Array.isArray(parsed) ? parsed : (parsed && (parsed.data || parsed.items || parsed.results || parsed.videos)) || [];
    return rows.map(function(item, index) {
      const title = item.title || item.desc || item.name || '';
      const url = item.url || item.link || item.video_url || item.share_url || '';
      const awemeId = item.aweme_id || item.awemeId || '';
      const bvidMatch = String(url || '').match(/BV[\w]+/i);
      const link = platform === 'douyin' && awemeId ? ('https://www.douyin.com/video/' + awemeId) : url;
      return {
        id: item.id || awemeId || item.bvid || (bvidMatch && bvidMatch[0]) || String(index + 1),
        platform: platform,
        account: fallbackAccount,
        title: title,
        url: link || url,
        play_url: item.play_url || item.playUrl || '',
        raw: item
      };
    }).filter(function(item) { return item.title || item.url || item.play_url; });
  }

  function transcribeCollectedItem(item) {
    const platform = normalizePlatform(item.platform);
    const url = platform === 'douyin' ? (item.play_url || item.url || '') : (item.url || item.play_url || '');
    if (!url) return Promise.resolve({ text: '', error: 'missing url' });
    const script = platform === 'bilibili' ? 'transcribe_bilibili.py' : 'transcribe_douyin.py';
    return runPython(script, 'transcribe', { url: url }, platform === 'bilibili' ? 900 : 300).then(function(result) {
      if ((!result || !result.text) && item.url && item.play_url && item.url !== item.play_url) {
        return runPython(script, 'transcribe', { url: item.url }, platform === 'bilibili' ? 900 : 300);
      }
      return result;
    }).then(function(result) {
      return {
        text: result.text || '',
        title: result.title || item.title || '',
        error: result.error || '',
        source: result.source || ''
      };
    });
  }

  function parseAnalysis(raw, fallbackTitle, fallbackText) {
    const parsed = extractJson(raw) || {};
    const tags = Array.isArray(parsed.tags) ? parsed.tags.join('，') : String(parsed.tags || '');
    return {
      title: String(parsed.title || fallbackTitle || '未命名文案').trim().slice(0, 80),
      summary: String(parsed.summary || parsed.abstract || fallbackText || '').trim().slice(0, 260),
      search_query: String(parsed.search_query || parsed.query || parsed.keywords || '').trim().slice(0, 160),
      tags: tags.slice(0, 160)
    };
  }

  function splitCopyDrafts(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];
    const parts = text
      .split(/\n\s*(?:---+|#{2,}|第[一二三四五六七八九十\d]+[篇条]|[0-9]{1,2}[\.、\)]\s+)\s*\n?/g)
      .map(function(x) { return x.trim(); })
      .filter(function(x) { return x.length >= 20; });
    if (parts.length > 1) return parts.slice(0, 20);
    return text
      .split(/\n{3,}/g)
      .map(function(x) { return x.trim(); })
      .filter(function(x) { return x.length >= 20; })
      .slice(0, 20);
  }

  function splitCopyDraftsWithAi(raw) {
    const text = String(raw || '').trim();
    if (!text) return Promise.resolve([]);
    const fallback = splitCopyDrafts(text);
    const prompt = [
      '请把下面用户一次性粘贴的文案拆成独立条目。',
      '如果只有一篇，就返回 1 条；如果有多篇，就按语义边界拆分，不要改写原文。',
      '只返回严格 JSON，不要 markdown。格式：{"items":[{"text":"完整原文"}]}',
      '最多返回 20 条。',
      '原文：',
      text.slice(0, 16000)
    ].join('\n');
    return callMiniMaxChat(
      '你是文案库录入助手，只负责拆分多篇原文，不总结、不改写。',
      prompt,
      5000,
      { model: 'gpt-5.4', temperature: 0.1 }
    ).then(function(reply) {
      const parsed = extractJson(reply) || {};
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      const chunks = items
        .map(function(item) { return String(item && item.text || '').trim(); })
        .filter(function(item) { return item.length >= 20; })
        .slice(0, 20);
      return chunks.length ? chunks : fallback;
    }).catch(function() {
      return fallback;
    });
  }

  function analyzeCopyDraft(text, item) {
    const sourceText = String(text || item.title || '').trim();
    const system = 'You are a short-video copywriting librarian. Return strict JSON only.';
    const prompt = [
      '请基于下面的视频原文/标题，生成文案库待确认字段。',
      '只返回 JSON，不要 markdown。字段：',
      '{"title":"标题，20字以内","summary":"内容概括，80字以内","search_query":"适合检索这条文案的关键词/检索条件","tags":["3-6个短标签"]}',
      '平台：' + (item.platform || ''),
      '账号：' + (item.account || ''),
      '视频标题：' + (item.title || ''),
      '原文：\n' + sourceText.slice(0, 5000)
    ].join('\n');
    return callMiniMaxChat(system, prompt, 1200, { model: 'gpt-5.4', temperature: 0.2 }).then(function(reply) {
      return parseAnalysis(reply, item.title, sourceText);
    }).catch(function() {
      return parseAnalysis('{}', item.title, sourceText);
    });
  }

  function listCollection(collection, body, cb) {
    runPython('chroma_db.py', 'list', {
      collection: collection,
      limit: body.limit || body.pageSize || 60,
      offset: body.offset || 0,
      keyword: body.keyword || body.search || '',
      account: body.account || '',
      scene: body.scene || ''
    }, 60).then(function(result) {
      const items = result.items || result.data || [];
      cb(Object.assign({}, result, { data: items, items: items, total: result.total || items.length, collection: collection }));
    });
  }

  function addCollectionItem(collection, defaults, body, cb) {
    const text = body.text || body.content || body.prompt || '';
    if (!text) {
      cb({ success: false, error: 'text required' });
      return;
    }
    const params = {
      id: body.id || '',
      text: text,
      account: body.account || '通用',
      scene: body.scene || defaults.scene,
      type: body.type || collection,
      source: body.source || '',
      hook: body.hook || '',
      golden_line: body.golden_line || '',
      progression: body.progression || '',
      marketing_target: body.marketing_target || '',
      content_direction: body.content_direction || '',
      case_tags: body.case_tags || '',
      link: body.link || ''
    };
    runPython('chroma_db.py', 'add', { collection: collection, params: params }, 60).then(cb);
  }

  return {
    '/api/vector/search': function(body, cb) {
      const collection = body.collection || 'anythingllm_md_v2';
      const query = body.query || '';
      const account = body.account || '';
      const scene = body.scene || '';
      const limit = body.top_k || body.limit || 6;
      if (!query) { cb({ results: [] }); return; }

      runPython('chroma_combined.py', 'search', {
        collection: collection,
        query: query,
        account: account,
        scene: scene,
        limit: limit,
        min_score: body.min_score || body.minScore || 1
      }, 60).then(function(result) {
        cb({ results: result.results || [], error: result.error });
      });
    },

    '/api/vector/list': function(body, cb) {
      const collection = body.collection || 'wenan';
      runPython('chroma_combined.py', 'list', {
        collection: collection,
        limit: body.limit || body.pageSize || 60,
        offset: body.offset || 0,
        keyword: body.keyword || body.search || '',
        account: body.account || '',
        scene: body.scene || ''
      }, 60).then(function(result) {
        const items = result.items || result.data || [];
        cb({
          data: items,
          items: items,
          total: result.total || items.length,
          count: result.count || items.length,
          limit: result.limit || body.limit || body.pageSize || 60,
          offset: result.offset || body.offset || 0,
          has_more: Boolean(result.has_more),
          collection: result.collection || collection,
          error: result.error
        });
      });
    },

    '/api/vector/stats': function(body, cb) {
      const collection = body.collection || 'wenan';
      runPython('chroma_combined.py', 'stats', { collection: collection }, 30).then(cb);
    },

    '/api/vector/facets': function(body, cb) {
      const collection = body.collection || 'wenan';
      runPython('chroma_combined.py', 'facets', { collection: collection }, 30).then(cb);
    },

    '/api/vector/get': function(body, cb) {
      const collection = body.collection || 'wenan';
      runPython('chroma_combined.py', 'get', {
        collection: collection,
        id: body.id || ''
      }, 30).then(cb);
    },

    '/api/vector/add': function(body, cb) {
      addCollectionItem(body.collection || 'wenan', { scene: '开场' }, body, cb);
    },

    '/api/vector/delete': function(body, cb) {
      runPython('chroma_db.py', 'delete', {
        collection: body.collection || 'anythingllm_md_v2',
        id: body.id || ''
      }, 30).then(cb);
    },

    '/api/vector/sync-style-transcripts': function(body, cb) {
      runPython('sync_style_transcripts.py', 'sync-all', {
        collection: body.collection || 'wenan',
        platforms: Array.isArray(body.platforms) ? body.platforms : ['bilibili', 'douyin'],
        limit: body.limit || 0
      }, 120).then(cb);
    },

    '/api/vector/sync-style-transcript': function(body, cb) {
      runPython('sync_style_transcripts.py', 'sync-one', {
        collection: body.collection || 'wenan',
        platform: body.platform || '',
        accountSlug: body.accountSlug || body.accountId || '',
        videoId: body.videoId || '',
        transcript: body.transcript || body.text || ''
      }, 30).then(cb);
    },

    '/api/vector/collect-account': function(body, cb) {
      const platform = normalizePlatform(body.platform);
      const account = normalizeAccountInput(platform, body.account || body.accountName || '');
      const limit = clampLimit(body.limit, 5, platform === 'douyin' ? 20 : 50);
      if (!account) { cb({ success: false, error: 'account required' }); return; }
      const args = platform === 'bilibili'
        ? ['bilibili', 'user-videos', account, '--limit', String(limit), '-f', 'json']
        : ['douyin', 'user-videos', account, '--limit', String(limit), '--with_comments', 'false', '-f', 'json'];
      runOpenCli(args, platform === 'bilibili' ? 180000 : 240000).then(function(result) {
        if (!result.ok) {
          cb({ success: false, error: result.error || 'opencli failed', stderr: result.stderr || '', stdout: result.stdout || '' });
          return;
        }
        const parsed = extractJson(result.stdout);
        const items = normalizeCollectedRows(platform, parsed, account).slice(0, limit);
        cb({ success: true, platform: platform, account: account, total: items.length, items: items });
      });
    },

    '/api/vector/prepare-account-items': function(body, cb) {
      const platform = normalizePlatform(body.platform);
      const account = body.account || body.accountName || '';
      const items = Array.isArray(body.items) ? body.items.slice(0, clampLimit(body.limit || body.items.length, body.items.length || 1, 10)) : [];
      if (!items.length) { cb({ success: false, error: 'items required' }); return; }
      const drafts = [];
      let chain = Promise.resolve();
      items.forEach(function(input, index) {
        chain = chain.then(function() {
          const item = Object.assign({}, input, { platform: input.platform || platform, account: input.account || account });
          return transcribeCollectedItem(item).then(function(transcript) {
            const text = transcript.text || item.title || '';
            return analyzeCopyDraft(text, item).then(function(meta) {
              drafts.push({
                id: item.id || String(index + 1),
                platform: item.platform,
                account: item.account,
                url: item.url || item.play_url || '',
                source_title: item.title || transcript.title || '',
                original_text: text,
                title: meta.title,
                summary: meta.summary,
                search_query: meta.search_query,
                tags: meta.tags,
                transcript_error: transcript.error || ''
              });
            });
          });
        });
      });
      chain.then(function() {
        cb({ success: true, total: drafts.length, drafts: drafts });
      }).catch(function(e) {
        cb({ success: false, error: e.message || String(e), drafts: drafts });
      });
    },

    '/api/vector/prepare-copy-items': function(body, cb) {
      const account = String(body.account || body.accountName || '').trim();
      if (!account) { cb({ success: false, error: 'account required' }); return; }
      const sourceText = String(body.text || body.source || '').trim();
      const link = body.link || '';
      const feishuLink = body.feishu_link || body.feishuLink || '';
      splitCopyDraftsWithAi(sourceText || body.title || '').then(function(chunks) {
        chunks = chunks.slice(0, clampLimit(body.limit || 20, 20, 20));
        if (!chunks.length) { cb({ success: false, error: 'text required' }); return; }
        const drafts = [];
        let chain = Promise.resolve();
        chunks.forEach(function(chunk, index) {
          chain = chain.then(function() {
            return analyzeCopyDraft(chunk, {
              platform: link ? 'link' : feishuLink ? 'feishu' : 'manual',
              account: account,
              title: ''
            }).then(function(meta) {
              drafts.push({
                id: 'manual-' + Date.now() + '-' + index,
                platform: link ? 'link' : feishuLink ? 'feishu' : 'manual',
                account: account,
                url: link || feishuLink || '',
                source_title: '',
                original_text: chunk,
                title: meta.title,
                summary: meta.summary,
                search_query: meta.search_query,
                tags: meta.tags,
                transcript_error: ''
              });
            });
          });
        });
        chain.then(function() {
          cb({ success: true, total: drafts.length, drafts: drafts });
        }).catch(function(e) {
          cb({ success: false, error: e.message || String(e), drafts: drafts });
        });
      }).catch(function(e) {
        cb({ success: false, error: e.message || String(e), drafts: [] });
      });
    },

    '/api/vector/analyze': function(body, cb) {
      const text = (body.text || '').trim();
      const collection = body.collection || 'wenan';
      if (!text) { cb({ error: 'text required' }); return; }

      if (collection === 'wenan') {
        analyzeCopyDraft(text, {
          platform: 'manual',
          account: body.account || '通用',
          title: ''
        }).then(function(meta) {
          cb({
            success: true,
            data: {
              title: meta.title,
              summary: meta.summary,
              tags: meta.tags,
              hook: meta.title,
              golden_line: meta.summary,
              case_tags: meta.tags,
              progression: meta.search_query,
              scene: '文案',
              account: body.account || '通用',
              _collection: collection
            },
            fields: { title: '标题', summary: '概括', tags: '标签' }
          });
        }).catch(function(e) {
          cb({ success: false, error: e.message || String(e) });
        });
        return;
      }

      const prompts = {
        wenan: {
          system: '你是一个短视频文案分析师。从文案中提取JSON：\n{account,scene,content,hook,golden_line}\n账号：天机妹、花蛮楼、麦晓花、夏天丶Cat、有事找学姐、小张同学、呼叫网管、王者代做、通用\n场景：开场|承接|结尾|梗|素材\n只返回JSON不要其他内容。',
          fields: { account: '账号', scene: '场景', content: '内容概览', hook: '钩子', golden_line: '金句' }
        },
        bf: {
          system: '你是一个营销分析师。从营销内容中提取JSON：\n{account,scene,marketing_target,content_direction}\n账号：天机妹、花蛮楼、麦晓花、夏天丶Cat、有事找学姐、小张同学、呼叫网管、王者代做、通用\n营销标的：指这条视频/内容的营销目标是什么（如：引流私域、推广产品、品牌曝光等）\n内容方向：指内容的创作方向或主题（如：游戏攻略、产品测评、热点话题等）\n场景：BF框架|BF素材|BF参考\n只返回JSON不要其他内容。',
          fields: { account: '账号', scene: '场景', marketing_target: '营销标的', content_direction: '内容方向' }
        },
        cases: {
          system: '你是一个案例分析师。从案例内容中提取JSON：\n{account,scene,content,case_tags,link}\n账号：天机妹、花蛮楼、麦晓花、夏天丶Cat、有事找学姐、小张同学、呼叫网管、王者代做、通用\n内容：对案例内容的简要总结（AI解析）\n案例标签：用于分类案例的标签（如：优秀案例、差评案例、数据复盘、爆款、低播放等）\n链接：如果内容中有链接则提取，没有则留空\n场景：优秀案例|差评案例|数据复盘\n只返回JSON不要其他内容。',
          fields: { account: '账号', scene: '场景', content: 'AI解析', case_tags: '案例标签', link: '链接' }
        }
      };

      const cfg = prompts[collection] || prompts.wenan;

      callMiniMaxChat(cfg.system, '内容：' + text, 20000).then(function(result) {
        try {
          const match = String(result).match(/\{[\s\S]*\}/);
          if (match) {
            const data = JSON.parse(match[0]);
            data._collection = collection;
            cb({ success: true, data: data, fields: cfg.fields });
          } else {
            cb({ success: false, error: '解析失败，AI未返回有效JSON', raw: String(result).substring(0, 300) });
          }
        } catch(e) {
          cb({ success: false, error: 'JSON解析失败: ' + e.message, raw: String(result).substring(0, 300) });
        }
      }).catch(function(e) {
        cb({ success: false, error: e.message });
      });
    },

    '/api/bf/list': function(body, cb) {
      listCollection('bf', body || {}, cb);
    },

    '/api/bf/add': function(body, cb) {
      addCollectionItem('bf', { scene: 'BF参考' }, body, cb);
    },

    '/api/bf/delete': function(body, cb) {
      runPython('chroma_db.py', 'delete', { collection: 'bf', id: body.id || '' }, 30).then(cb);
    },

    '/api/cases/list': function(body, cb) {
      listCollection('cases', body || {}, cb);
    },

    '/api/cases/add': function(body, cb) {
      addCollectionItem('cases', { scene: '案例', type: 'case' }, body, cb);
    },

    '/api/cases/delete': function(body, cb) {
      runPython('chroma_db.py', 'delete', { collection: 'cases', id: body.id || '' }, 30).then(cb);
    }
  };
};
