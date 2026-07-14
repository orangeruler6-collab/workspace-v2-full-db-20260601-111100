const fs = require('fs');
const path = require('path');
const { Readable, Transform } = require('stream');

const DOWNLOAD_SIZE_LIMITS = {
  cover: 20 * 1024 * 1024,
  audio: 500 * 1024 * 1024,
  video: 2 * 1024 * 1024 * 1024
};
const BLOCKED_REMOTE_CONTENT_TYPE = /^(?:text\/(?:html|plain|xml)|application\/(?:json|problem\+json|xml))/i;

let tsxRegistered = false;
const moduleCache = new Map();

function createStyleWorkbenchRoutes(options) {
  const root = options.root || path.join(__dirname, '..', '..');
  const repoRoot = options.repoRoot || path.join(__dirname, '..', '..');
  const libraryRoot = process.env.STYLE_LIBRARY_DIR || path.join(root, 'data', 'style-library');
  process.env.STYLE_LIBRARY_DIR = libraryRoot;

  function tsModule(relativePath) {
    if (!tsxRegistered) {
      require('tsx/cjs');
      tsxRegistered = true;
    }
    const absPath = path.join(repoRoot, 'server', 'style-workbench', relativePath);
    if (!moduleCache.has(absPath)) moduleCache.set(absPath, require(absPath));
    return moduleCache.get(absPath);
  }

  function lib(name) {
    return tsModule(path.join('lib', name + '.ts'));
  }

  function ok(run) {
    return function styleRoute(body, reply) {
      Promise.resolve()
        .then(function() { return run(body || {}); })
        .then(reply)
        .catch(function(error) {
          reply({ error: formatError(error) });
        });
    };
  }

  function method(expected, run) {
    return ok(function(body) {
      const actual = String(body._method || 'GET').toUpperCase();
      if (actual !== expected) throw new Error('请求方法不正确。');
      return run(body);
    });
  }

  function signal(body) {
    return body && body._req ? body._req.signal : undefined;
  }

  function bool(value) {
    return value === true || value === '1' || value === 'true';
  }

  function stringList(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
  }

  function platform(value) {
    const text = String(value || '').trim();
    if (text !== 'bilibili' && text !== 'douyin') throw new Error('平台参数不正确。');
    return text;
  }

  function routeForJob(body) {
    const jobId = body.jobId || body.id;
    if (!jobId) throw new Error('缺少任务 ID。');
    return String(jobId);
  }

  async function accountDetail(body) {
    const storage = lib('storage');
    return storage.getAccountDetail(platform(body.platform), String(body.accountId || ''), {
      includeStyle: bool(body.includeStyle)
    });
  }

  async function createAccount(body) {
    const storage = lib('storage');
    const opencli = lib('opencli');
    const accountProfile = lib('account-profile');
    const platformLinks = lib('platform-links');
    const targetPlatform = platform(body.platform);
    const name = String(body.name || '').trim();
    if (!name) throw new Error('请输入账号名称。');
    const uidOrUrl = body.uidOrUrl ? platformLinks.normalizeLinkInput(String(body.uidOrUrl), { kind: 'account' }) : '';
    const sourceUrl = body.sourceUrl ? platformLinks.normalizeLinkInput(String(body.sourceUrl), { kind: 'account' }) : '';
    const existing = !uidOrUrl ? await storage.findAccountByName(targetPlatform, name) : null;
    const uid = existing && existing.uid
      ? existing.uid
      : await opencli.resolveAccountUid(targetPlatform, name, uidOrUrl, { signal: signal(body) });
    const profile = await accountProfile.resolveAccountProfile({
      platform: targetPlatform,
      uid: uid,
      fallbackName: existing && existing.name || name,
      sourceUrl: sourceUrl || uidOrUrl || existing && existing.sourceUrl || name,
      signal: signal(body)
    });
    const account = await storage.upsertAccount({
      platform: targetPlatform,
      name: profile.name,
      uid: uid,
      sourceUrl: profile.sourceUrl,
      avatarUrl: profile.avatarUrl
    });
    return storage.getAccountSummary(account);
  }

  async function saveProjectAndGenerateStyle(body) {
    const ai = lib('ai');
    return ai.saveAndGenerateProjectStyleProfile({
      projectId: body.projectId,
      name: body.name,
      description: body.description,
      sourceAccountIds: stringList(body.sourceAccountIds),
      sourceMaterialIds: stringList(body.sourceMaterialIds)
    }, { signal: signal(body) });
  }

  async function handleGrossMarginMutation(body) {
    const storage = lib('storage');
    const grossTemplate = lib('gross-margin-monitor-template');
    const platformLinks = lib('platform-links');
    const utils = lib('utils');
    const opencli = lib('opencli');

    if (body.action === 'savePriceTable') {
      const table = await storage.saveGrossMarginPriceTable({
        platform: body.platform,
        items: Array.isArray(body.items) ? body.items : []
      });
      return { table: table, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'saveReviewTemplate') {
      const template = await storage.saveGrossMarginReviewTemplate({
        platform: body.platform,
        content: String(body.content || '')
      });
      return { template: template, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'resetReviewTemplate') {
      const template = await storage.resetGrossMarginReviewTemplate(body.platform);
      return { template: template, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'deleteMonitorRecord') {
      const result = await storage.deleteGrossMarginMonitorRecord(String(body.recordId || ''));
      return Object.assign({}, result, { library: await storage.getGrossMarginLibrary() });
    }
    if (body.action === 'updateMonitorPlayTarget') {
      const record = await storage.resolveGrossMarginMonitorRecord(String(body.recordId || ''));
      record.targetStats = Object.assign({}, record.targetStats, { play: Number(body.target) || 0 });
      await storage.saveGrossMarginMonitorRecord(record);
      return { record: record, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'updateMonitorPlayCurrent') {
      const record = await storage.resolveGrossMarginMonitorRecord(String(body.recordId || ''));
      const next = storage.appendGrossMarginPlaySample(record, Number(body.current) || 0);
      await storage.saveGrossMarginMonitorRecord(next);
      return { record: next, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'saveMonitorRecord') {
      const videoUrl = platformLinks.normalizeVideoUrlInput(String(body.videoUrl || ''));
      const record = await storage.upsertGrossMarginMonitorRecord({
        platform: body.platform || platformLinks.detectVideoPlatform(videoUrl) || 'douyin',
        accountName: String(body.accountName || ''),
        videoUrl: videoUrl,
        videoKey: platformLinks.getVideoComparableKey(videoUrl),
        sourceText: String(body.sourceText || ''),
        targetStats: body.targetStats || {},
        warnings: []
      });
      return { record: record, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'bulkSaveMonitorRecords') {
      const parsed = grossTemplate.parseGrossMarginBulkMonitorTemplate(String(body.template || ''));
      const records = [];
      for (const item of parsed.records || []) {
        const videoUrl = platformLinks.normalizeVideoUrlInput(item.videoUrl || '');
        const record = await storage.upsertGrossMarginMonitorRecord({
          platform: item.platform || platformLinks.detectVideoPlatform(videoUrl) || 'douyin',
          accountName: item.accountName || '',
          videoUrl: videoUrl,
          videoKey: platformLinks.getVideoComparableKey(videoUrl),
          sourceText: item.sourceText || String(body.template || ''),
          targetStats: item.targetStats || item.stats || {},
          warnings: item.warnings || []
        });
        records.push(record);
      }
      return { records: records, parsed: parsed, project: null, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'refreshMonitorRecord') {
      const record = await refreshGrossMarginRecord(storage, opencli, String(body.recordId || ''));
      return { record: record, library: await storage.getGrossMarginLibrary() };
    }
    if (body.action === 'refreshMonitorRecords') {
      const allRecords = await storage.getGrossMarginMonitorRecords();
      const selected = stringList(body.recordIds);
      const targetRecords = selected.length ? allRecords.filter(function(record) {
        return selected.includes(record.id);
      }) : allRecords;
      const refreshed = [];
      for (const record of targetRecords) {
        refreshed.push(await refreshGrossMarginRecord(storage, opencli, record.id));
      }
      return { records: refreshed, library: await storage.getGrossMarginLibrary() };
    }
    throw new Error('未知毛利操作。');
  }

  async function refreshGrossMarginRecord(storage, opencli, recordId) {
    const record = await storage.resolveGrossMarginMonitorRecord(recordId);
    try {
      const stats = record.platform === 'bilibili'
        ? await opencli.getBilibiliVideoStatsByUrl(record.videoUrl)
        : await opencli.getDouyinVideoStatsByUrl(record.videoUrl);
      const play = Number(stats.play ?? stats.views ?? stats.view ?? 0) || 0;
      const next = storage.appendGrossMarginPlaySample(Object.assign({}, record, {
        currentStats: Object.assign({}, record.currentStats || {}, {
          play: play,
          like: Number(stats.like ?? stats.likes ?? 0) || 0,
          comment: Number(stats.comment ?? stats.comments ?? 0) || 0,
          share: Number(stats.share ?? stats.shares ?? 0) || 0,
          favorite: Number(stats.favorite ?? stats.favorites ?? 0) || 0,
          danmaku: Number(stats.danmaku ?? 0) || 0,
          coin: Number(stats.coin ?? 0) || 0
        }),
        lastRefreshStatus: 'success',
        lastRefreshedAt: new Date().toISOString(),
        lastRefreshError: ''
      }), play);
      await storage.saveGrossMarginMonitorRecord(next);
      return next;
    } catch (error) {
      const failed = Object.assign({}, record, {
        lastRefreshStatus: 'failed',
        lastRefreshedAt: new Date().toISOString(),
        lastRefreshError: formatError(error)
      });
      await storage.saveGrossMarginMonitorRecord(failed);
      return failed;
    }
  }

  const routes = {
    '/api/library': method('GET', function() {
      return lib('storage').getLibrary();
    }),
    '/api/library/overview': method('GET', function(body) {
      return lib('storage').getLibraryOverview({ includeAuxiliary: bool(body.includeAuxiliary) });
    }),
    '/api/accounts': ok(function(body) {
      const storage = lib('storage');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') return accountDetail(body);
      if (methodName === 'POST') return createAccount(body);
      if (methodName === 'DELETE') return storage.deleteAccounts(stringList(body.accountIds));
      throw new Error('请求方法不正确。');
    }),
    '/api/collect': method('POST', async function(body) {
      const storage = lib('storage');
      const opencli = lib('opencli');
      const accountProfile = lib('account-profile');
      const collectTarget = lib('collect-target');
      const targetPlatform = platform(body.platform);
      const target = collectTarget.resolveCollectTarget(targetPlatform, String(body.name || body.uidOrUrl || ''));
      if (!target.lookupName) throw new Error('请输入账号名、主页链接或 UID。');
      const requestedLimit = Number(body.limit || 20);
      if (!Number.isFinite(requestedLimit)) throw new Error('采集数量参数不正确。');
      const limit = Math.min(50, Math.max(1, Math.floor(requestedLimit)));
      const order = String(body.order || (targetPlatform === 'bilibili' ? 'views' : 'likes'));
      const allowedOrders = targetPlatform === 'bilibili'
        ? ['views', 'likes', 'favorites', 'comments', 'pubdate']
        : ['likes', 'comments', 'pubdate'];
      if (!allowedOrders.includes(order)) throw new Error('采集排序参数不正确。');

      const existingByName = target.uidOrUrl
        ? null
        : await storage.findAccountByName(targetPlatform, target.lookupName).catch(function() { return null; });
      const legacyAccount = (existingByName || target.uidOrUrl)
        ? null
        : await storage.findLegacyAccountByInput(targetPlatform, target.lookupName).catch(function() { return null; });
      const reusableAccount = existingByName && collectTarget.isValidAccountUid(targetPlatform, existingByName.uid)
        ? existingByName
        : null;
      const uid = reusableAccount
        ? reusableAccount.uid
        : await opencli.resolveAccountUid(targetPlatform, target.lookupName, target.uidOrUrl, { signal: signal(body) });
      const existingByUid = await storage.findAccountByUid(targetPlatform, uid).catch(function() { return null; });
      const repairAccount = existingByUid || reusableAccount || legacyAccount;
      const now = new Date().toISOString();
      const transientAccount = {
        id: repairAccount && repairAccount.id || `${targetPlatform}:collecting`,
        slug: repairAccount && repairAccount.slug || 'collecting',
        platform: targetPlatform,
        name: target.displayNameFallback || target.lookupName,
        uid: uid,
        sourceUrl: collectTarget.accountSourceUrl(targetPlatform, uid),
        createdAt: repairAccount && repairAccount.createdAt || now,
        updatedAt: now
      };
      const collected = await opencli.collectVideos({
        platform: targetPlatform,
        account: transientAccount,
        limit: limit,
        order: order,
        fromDate: body.fromDate,
        toDate: body.toDate,
        signal: signal(body)
      });
      const accountName = accountProfile.inferAccountNameFromCollectedData(
        targetPlatform,
        collected.raw,
        target.displayNameFallback || repairAccount && repairAccount.name || uid
      );
      const inferredAvatarUrl = accountProfile.inferAccountAvatarFromCollectedData(collected.videos || [], collected.raw);
      const profile = inferredAvatarUrl ? null : await accountProfile.resolveAccountProfile({
        platform: targetPlatform,
        uid: uid,
        fallbackName: accountName,
        sourceUrl: collectTarget.accountSourceUrl(targetPlatform, uid),
        signal: signal(body)
      });
      const account = await storage.upsertAccount({
        platform: targetPlatform,
        accountId: repairAccount && repairAccount.id,
        name: profile && profile.name || accountName,
        uid: uid,
        sourceUrl: profile && profile.sourceUrl || collectTarget.accountSourceUrl(targetPlatform, uid),
        avatarUrl: inferredAvatarUrl || profile && profile.avatarUrl,
        lastCollectedAt: now
      });
      const selectedVideos = collectTarget.selectCollectedVideos(collected.videos || [], limit, order, body.fromDate, body.toDate);
      const videos = await storage.saveVideos(account, selectedVideos);
      return {
        account: await storage.getAccountSummary(account),
        videos: videos,
        command: collected.command,
        rawCount: collected.rawCount,
        filteredCount: selectedVideos.length
      };
    }),
    '/api/accounts/transcripts-export': function(body, reply) {
      if (String(body._method || 'GET').toUpperCase() !== 'GET') {
        reply({ error: '请求方法不正确。' });
        return;
      }
      lib('account-transcript-export').createAccountTranscriptDocx(
        platform(body.platform),
        String(body.accountId || '')
      ).then(function(result) {
        const res = body._res;
        if (!res || res.headersSent) {
          reply({ error: '下载响应不可用。' });
          return;
        }
        const fallbackName = 'account-transcripts.docx';
        const encodedName = encodeURIComponent(result.fileName || fallbackName);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
          'Content-Length': result.buffer.length,
          'Access-Control-Allow-Origin': '*'
        });
        res.end(result.buffer);
      }).catch(function(error) {
        reply({ error: formatError(error) });
      });
    },
    '/api/projects': ok(function(body) {
      const storage = lib('storage');
      const ai = lib('ai');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') {
        return storage.getProjectDetail(String(body.projectId || ''), { includeStyle: bool(body.includeStyle) });
      }
      if (methodName === 'POST') {
        return storage.upsertProject({
          projectId: body.projectId,
          name: body.name,
          description: body.description,
          sourceAccountIds: stringList(body.sourceAccountIds),
          sourceMaterialIds: stringList(body.sourceMaterialIds)
        }).then(function(project) { return storage.getProjectSummary(project); });
      }
      if (methodName === 'PUT') {
        return storage.saveProjectStyle(String(body.projectId || ''), String(body.content || '')).then(function(style) {
          return { style: style };
        });
      }
      if (methodName === 'PATCH') {
        if (body.name) return saveProjectAndGenerateStyle(body);
        return ai.generateProjectStyleProfile(String(body.projectId || ''), { signal: signal(body) });
      }
      if (methodName === 'DELETE') return storage.deleteProjects(stringList(body.projectIds));
      throw new Error('请求方法不正确。');
    }),
    '/api/copy-sources': ok(async function(body) {
      const storage = lib('storage');
      const transcription = lib('transcription');
      const material = lib('material-analysis');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') return { sources: await storage.getCopySources() };
      if (methodName === 'DELETE') return storage.deleteCopySources(stringList(body.sourceIds));
      if (body.action === 'create_project') {
        const project = await storage.createCopySourceProject({
          name: body.name,
          description: body.description,
          sourceMaterialIds: stringList(body.sourceMaterialIds)
        });
        return { project: await storage.getProjectSummary(project) };
      }
      const result = await transcription.transcribeLinkSource({
        url: String(body.url || ''),
        titleHint: body.titleHint,
        signal: signal(body)
      });
      const source = await storage.saveCopySource({
        platform: result.platform,
        title: result.title || body.titleHint || '未命名素材',
        url: result.url,
        resolvedUrl: result.resolvedUrl,
        transcript: result.text,
        source: result.source,
        fallback: result.fallback,
        fallbackReason: result.fallbackReason
      });
      if (body.analyzeVideo) {
        await material.analyzeCopySourceMaterial(source).catch(function() { return null; });
      }
      return { source: source, result: result };
    }),
    '/api/drafts': ok(function(body) {
      const storage = lib('storage');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') return storage.getDrafts();
      if (methodName === 'POST') return storage.saveDraft(body);
      if (methodName === 'PATCH') return storage.updateDraftTitle(String(body.draftId || ''), String(body.title || ''));
      if (methodName === 'DELETE') return storage.deleteDrafts(stringList(body.draftIds));
      throw new Error('请求方法不正确。');
    }),
    '/api/jobs': ok(function(body) {
      const jobs = lib('jobs');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') return jobs.listJobSummaries();
      if (methodName === 'POST') return jobs.createJob(body);
      throw new Error('请求方法不正确。');
    }),
    '/api/jobs/:jobId': ok(function(body) {
      const jobs = lib('jobs');
      const methodName = String(body._method || 'GET').toUpperCase();
      const jobId = routeForJob(body);
      if (methodName === 'GET') return jobs.getJob(jobId).then(function(job) { return { job: job }; });
      if (methodName === 'PATCH' && body.action === 'cancel') {
        return jobs.cancelJob(jobId).then(function(job) { return { job: job }; });
      }
      throw new Error('请求方法不正确。');
    }),
    '/api/transcribe': method('POST', function(body) {
      return lib('transcription').transcribeVideo({
        platform: platform(body.platform),
        accountId: String(body.accountId || ''),
        videoId: String(body.videoId || ''),
        mediaUrl: body.mediaUrl,
        allowRemoteDownload: bool(body.allowRemoteDownload),
        signal: signal(body)
      });
    }),
    '/api/batch-transcribe': method('POST', function(body) {
      return lib('batch-transcribe').runBatchTranscribe({
        platform: platform(body.platform),
        accountId: String(body.accountId || ''),
        limit: body.limit === 'all' ? 'all' : Number(body.limit || 0),
        updateStyle: bool(body.updateStyle),
        signal: signal(body)
      });
    }),
    '/api/videos': method('DELETE', function(body) {
      return lib('storage').deleteVideos(platform(body.platform), String(body.accountId || ''), stringList(body.videoIds));
    }),
    '/api/videos/hydrate': method('POST', async function(body) {
      const storage = lib('storage');
      const opencli = lib('opencli');
      const targetPlatform = platform(body.platform);
      const accountId = String(body.accountId || '');
      const videoId = String(body.videoId || '');
      const video = await storage.getVideo(targetPlatform, accountId, videoId);
      if (!video) throw new Error('视频不存在。');
      const hydrated = targetPlatform === 'bilibili'
        ? await opencli.hydrateBilibiliVideoStats(video)
        : video;
      const account = await storage.resolveAccount(targetPlatform, accountId);
      const saved = await storage.saveVideo(account, hydrated);
      return { video: saved };
    }),
    '/api/transcripts': ok(function(body) {
      const storage = lib('storage');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') {
        return storage.readTranscript(platform(body.platform), String(body.accountId || ''), String(body.videoId || '')).then(function(transcript) {
          return { transcript: transcript };
        });
      }
      if (methodName === 'PUT') {
        return storage.saveTranscript({
          platform: platform(body.platform),
          accountId: String(body.accountId || ''),
          videoId: String(body.videoId || ''),
          transcript: String(body.transcript || '')
        }).then(function(transcript) { return { transcript: transcript }; });
      }
      if (methodName === 'DELETE') {
        return storage.deleteTranscript(platform(body.platform), String(body.accountId || ''), String(body.videoId || ''));
      }
      throw new Error('请求方法不正确。');
    }),
    '/api/style': ok(function(body) {
      const storage = lib('storage');
      const ai = lib('ai');
      const methodName = String(body._method || 'POST').toUpperCase();
      if (methodName === 'POST') {
        return ai.generateStyleProfile(platform(body.platform), String(body.accountId || ''), { signal: signal(body) });
      }
      if (methodName === 'PUT') {
        return storage.saveStyle(platform(body.platform), String(body.accountId || ''), String(body.content || '')).then(function(style) {
          return { style: style };
        });
      }
      throw new Error('请求方法不正确。');
    }),
    '/api/write': method('POST', function(body) {
      return lib('ai').writeCopy(body, { signal: signal(body) });
    }),
    '/api/write/brief': method('POST', function(body) {
      return lib('ai').prepareWriteBrief(body, { signal: signal(body) });
    }),
    '/api/engagement': ok(function(body) {
      const storage = lib('storage');
      const engagement = lib('engagement');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') return storage.getEngagementRecords().then(function(records) { return { records: records }; });
      if (methodName === 'POST') return engagement.generateEngagement(body, { signal: signal(body) });
      if (methodName === 'DELETE') return storage.deleteEngagementRecords(stringList(body.recordIds));
      throw new Error('请求方法不正确。');
    }),
    '/api/draft-assets/engagement': method('POST', function(body) {
      return lib('engagement').generateDraftEngagement(body, { signal: signal(body) });
    }),
    '/api/draft-assets/cover/references': method('POST', function(body) {
      return lib('cover').collectDraftCoverReferences(String(body.draftId || ''), { signal: signal(body) });
    }),
    '/api/feishu/document': method('POST', function(body) {
      return lib('feishu').publishFeishuDocument({
        title: String(body.title || ''),
        content: String(body.content || '')
      });
    }),
    '/api/tools/publish-copy': method('POST', function(body) {
      return lib('publish-copy').generatePublishCopy(body, { signal: signal(body) });
    }),
    '/api/tools/single-video/transcribe': method('POST', function(body) {
      return lib('transcription').transcribeLinkSource({
        url: String(body.url || ''),
        titleHint: body.titleHint,
        signal: signal(body)
      }).then(function(result) { return { result: result }; });
    }),
    '/api/tools/single-video/download': function(body, reply) {
      if (String(body._method || 'GET').toUpperCase() !== 'POST') {
        reply({ error: '请求方法不正确。' });
        return;
      }
      const res = body._res;
      if (!res || typeof res.writeHead !== 'function') {
        reply({ error: '当前服务网关不支持文件下载。' });
        return;
      }
      Promise.resolve()
        .then(async function() {
          const kind = String(body.kind || '');
          if (!DOWNLOAD_SIZE_LIMITS[kind]) throw new Error('下载类型不正确。');
          const asset = await lib('transcription').prepareLinkSourceDownload({
            url: String(body.url || ''),
            kind: kind
          }, { signal: signal(body) });
          if (asset.remoteUrl) {
            await proxyRemoteDownloadAsset(asset, res, signal(body));
            return;
          }
          await streamLocalDownloadAsset(asset, res);
        })
        .catch(function(error) {
          writeDownloadError(res, error);
        });
    },
    '/api/gross-margin': ok(function(body) {
      if (String(body._method || 'GET').toUpperCase() === 'GET') return lib('storage').getGrossMarginLibrary();
      return handleGrossMarginMutation(body);
    }),
    '/api/douyin-hotlist': ok(function(body) {
      const hotlist = lib('douyin-hotlist');
      const methodName = String(body._method || 'GET').toUpperCase();
      if (methodName === 'GET') {
        return hotlist.getDouyinHotlist({ windowDays: body.windowDays ? Number(body.windowDays) : undefined, windowKey: body.window });
      }
      if (body.action === 'addAccount') {
        return hotlist.addDouyinHotlistAccount({ query: String(body.query || ''), signal: signal(body) });
      }
      if (body.action === 'removeAccount') {
        return hotlist.removeDouyinHotlistAccount(String(body.accountId || ''));
      }
      return hotlist.refreshDouyinHotlist({
        accountIds: Array.isArray(body.accountIds) ? body.accountIds : undefined,
        limit: body.limit ? Number(body.limit) : undefined,
        windowDays: body.windowDays ? Number(body.windowDays) : undefined,
        windowKey: body.window,
        signal: signal(body)
      });
    })
  };

  routes['/api/health/style-workbench'] = method('GET', async function() {
    const storage = lib('storage');
    await storage.ensureLibrary();
    return {
      ok: true,
      name: 'style-workbench-native',
      libraryRoot: libraryRoot,
      time: new Date().toISOString()
    };
  });

  return routes;
}

function formatError(error) {
  if (!error) return '请求失败。';
  if (error.issues && Array.isArray(error.issues) && error.issues[0]) {
    return error.issues[0].message || '请求参数不完整或格式不正确。';
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function proxyRemoteDownloadAsset(asset, res, requestSignal) {
  const response = await fetch(asset.remoteUrl, {
    headers: asset.requestHeaders || {},
    redirect: 'follow',
    signal: requestSignal
  });
  if (!response.ok) throw new Error('远程文件下载失败：HTTP ' + response.status);
  assertRemoteContentType(response.headers);
  assertDownloadSize(asset, parseContentLength(response.headers.get('content-length')));
  const headers = buildDownloadHeaders(asset, response.headers);
  res.writeHead(200, headers);
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    assertDownloadSize(asset, bytes.byteLength);
    res.end(bytes);
    return;
  }
  await pipeDownloadStream(Readable.fromWeb(response.body), res, asset);
}

async function streamLocalDownloadAsset(asset, res) {
  if (!asset.filePath) throw new Error('缺少本地文件路径。');
  const stats = await fs.promises.stat(asset.filePath);
  try {
    assertDownloadSize(asset, stats.size);
  } catch (error) {
    await cleanupDownloadAsset(asset.cleanupTargets || [asset.filePath]);
    throw error;
  }
  res.writeHead(200, buildDownloadHeaders(asset, null, stats.size));
  const stream = fs.createReadStream(asset.filePath);
  try {
    await pipeDownloadStream(stream, res, asset);
  } finally {
    await cleanupDownloadAsset(asset.cleanupTargets || [asset.filePath]);
  }
}

function buildDownloadHeaders(asset, upstreamHeaders, knownContentLength) {
  const contentLength = upstreamHeaders && upstreamHeaders.get && upstreamHeaders.get('content-length') || (knownContentLength ? String(knownContentLength) : '');
  const headers = {
    'Content-Type': upstreamHeaders && upstreamHeaders.get && upstreamHeaders.get('content-type') || asset.contentType || 'application/octet-stream',
    'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(asset.fileName || 'download'),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Disposition,Content-Length,Content-Type'
  };
  if (contentLength) headers['Content-Length'] = contentLength;
  return headers;
}

function pipeDownloadStream(stream, res, asset) {
  return new Promise(function(resolve, reject) {
    let receivedBytes = 0;
    const maxBytes = DOWNLOAD_SIZE_LIMITS[asset.kind] || DOWNLOAD_SIZE_LIMITS.video;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        receivedBytes += chunk.length;
        if (receivedBytes > maxBytes) {
          callback(new Error('文件过大，' + asset.kind + ' 下载上限为 ' + formatBytes(maxBytes) + '。'));
          return;
        }
        callback(null, chunk);
      }
    });
    function done(error) {
      stream.removeListener('error', done);
      limiter.removeListener('error', done);
      res.removeListener('finish', done);
      res.removeListener('close', done);
      if (error instanceof Error) {
        if (!res.headersSent) writeDownloadError(res, error);
        else res.destroy(error);
        reject(error);
        return;
      }
      resolve();
    }
    stream.once('error', done);
    limiter.once('error', done);
    res.once('finish', done);
    res.once('close', done);
    stream.pipe(limiter).pipe(res);
  });
}

function assertRemoteContentType(headers) {
  const contentType = headers.get('content-type');
  if (contentType && BLOCKED_REMOTE_CONTENT_TYPE.test(contentType.trim())) {
    throw new Error('远程文件返回了不可下载的内容类型：' + contentType);
  }
}

function assertDownloadSize(asset, size) {
  if (!size) return;
  const maxBytes = DOWNLOAD_SIZE_LIMITS[asset.kind] || DOWNLOAD_SIZE_LIMITS.video;
  if (size > maxBytes) {
    throw new Error('文件过大，' + asset.kind + ' 下载上限为 ' + formatBytes(maxBytes) + '，当前文件为 ' + formatBytes(size) + '。');
  }
}

function parseContentLength(value) {
  if (!value) return null;
  const size = Number.parseInt(value, 10);
  return Number.isFinite(size) && size > 0 ? size : null;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return Math.round(bytes / 1024 / 1024 / 1024) + 'GB';
  if (bytes >= 1024 * 1024) return Math.round(bytes / 1024 / 1024) + 'MB';
  return Math.round(bytes / 1024) + 'KB';
}

function writeDownloadError(res, error) {
  if (!res || res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    res.destroy(error instanceof Error ? error : new Error(formatError(error)));
    return;
  }
  res.writeHead(500, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({ error: formatError(error) }));
}

async function cleanupDownloadAsset(targets) {
  await Promise.all([...new Set((targets || []).filter(Boolean))].map(function(target) {
    return fs.promises.rm(target, { recursive: true, force: true }).catch(function() {});
  }));
}

module.exports = createStyleWorkbenchRoutes;
