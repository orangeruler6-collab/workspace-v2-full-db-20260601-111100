const fs = require('fs');
const path = require('path');

module.exports = function createMaterialRoutes(deps) {
  const root = deps.root;
  const uploadDir = deps.uploadDir;
  const thumbDir = deps.thumbDir;
  const db = deps.db;
  const media = deps.media;
  const classifier = deps.classifier;
  const internalFileStore = deps.internalFileStore;
  const requireInternalFileStore = String(process.env.INTERNAL_FILE_REQUIRED || 'true').toLowerCase() !== 'false';

  function getFileType(ext) {
    const videoExts = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.flv', '.wmv', '.m4v'];
    const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'];
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
    ext = String(ext || '').toLowerCase();
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'bgm';
    if (imageExts.includes(ext)) return 'image';
    return 'other';
  }

  function folderPathFor(row) {
    return row.parent === '/' ? '/' + row.name : row.parent + '/' + row.name;
  }

  function normalizeFolderParent(parent) {
    const value = String(parent || '/').trim();
    if (!value || value === '__all__') return '/';
    const normalized = value.startsWith('/') ? value : '/' + value;
    return normalized.length > 1 ? normalized.replace(/\/+$/, '') : '/';
  }

  function publicUrlFor(row) {
    const storagePath = String(row.storage_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (storagePath.startsWith('remote-file:')) {
      return '/api/materials/remote-preview/' + encodeURIComponent(row.id || '');
    }
    if (storagePath) {
      return '/uploads/' + storagePath.split('/').map(part => encodeURIComponent(part)).join('/');
    }
    return '/uploads/' + (row.type || 'video') + '/' + encodeURIComponent(row.filename || '');
  }

  function filePathFor(row) {
    const storagePath = String(row.storage_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (storagePath.startsWith('remote-file:')) return '';
    if (storagePath) return path.join(uploadDir, storagePath);
    return path.join(uploadDir, row.type || 'video', row.filename || '');
  }

  function remoteTargetPath(row) {
    const storagePath = String(row && row.storage_path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    return storagePath.startsWith('remote-file:') ? storagePath.slice('remote-file:'.length) : '';
  }

  function fileSizeFor(row) {
    const indexedSize = Number(row.size) || 0;
    if (indexedSize > 0) return indexedSize;
    if (remoteTargetPath(row)) return 0;
    const filePath = filePathFor(row);
    try {
      return fs.existsSync(filePath) ? fs.statSync(filePath).size || 0 : 0;
    } catch(e) {
      return 0;
    }
  }

  function deleteMaterialFiles(row, failedFiles) {
    const failures = failedFiles || [];
    try {
      const filePath = filePathFor(row);
      if (filePath && row.filename && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch(e) {
      failures.push({ file: row.filename || '', type: row.type || 'video', error: e.message });
    }
    try {
      if (row.thumb) {
        const thumbPath = path.join(root, 'public', String(row.thumb || '').replace(/^\/+/, ''));
        if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      }
    } catch(e) {
      failures.push({ file: row.thumb || '', type: 'thumb', error: e.message });
    }
    return failures;
  }

  function enrichMaterial(row) {
    try { row.tags = JSON.parse(row.tags || '[]'); }
    catch(e) { row.tags = []; }
    row.size = fileSizeFor(row);
    row.url = publicUrlFor(row);
    row.file_path = filePathFor(row);
    row.folder = row.folder || '/';
    if (remoteTargetPath(row)) {
      row.remote_storage = true;
      row.remote_target_path = remoteTargetPath(row);
      row.download_url = '/api/materials/remote-download/' + encodeURIComponent(row.id || '');
    }
    return row;
  }

  function mimeForExt(ext) {
    const map = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.m4v': 'video/mp4',
      '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska',
      '.flv': 'video/x-flv'
    };
    return map[String(ext || '').toLowerCase()] || 'application/octet-stream';
  }

  function getStorageSummary(cb) {
      db.all('SELECT type, filename, size, storage_path FROM materials WHERE status IS NULL OR status != ?', ['deleted'], function(err, indexedRows) {
      if (err) { cb(err); return; }

      const indexedByType = {};
      const remoteByType = {};
      const localByType = {};
      let indexedCount = 0;
      let indexedSize = 0;
      let remoteCount = 0;
      let remoteSize = 0;
      let localCount = 0;
      let localSize = 0;
      (indexedRows || []).forEach(row => {
        const type = row.type || 'video';
        const size = Number(row.size) || 0;
        if (!indexedByType[type]) indexedByType[type] = { count: 0, size: 0 };
        indexedByType[type].count += 1;
        indexedByType[type].size += size;
        indexedCount += 1;
        indexedSize += size;

        const target = remoteTargetPath(row);
        const targetByType = target ? remoteByType : localByType;
        if (!targetByType[type]) targetByType[type] = { count: 0, size: 0 };
        targetByType[type].count += 1;
        targetByType[type].size += size;
        if (target) {
          remoteCount += 1;
          remoteSize += size;
        } else {
          localCount += 1;
          localSize += size;
        }
      });

      cb(null, {
        root: internalFileStore && internalFileStore.enabled() ? 'internal-file-store' : 'local-compat',
        storage_mode: internalFileStore && internalFileStore.enabled() ? 'internal-file-store' : 'local-compat',
        remote_required: requireInternalFileStore,
        total_count: indexedCount,
        total_size: indexedSize,
        by_type: indexedByType,
        indexed_count: indexedCount,
        indexed_size: indexedSize,
        indexed_by_type: indexedByType,
        remote_count: remoteCount,
        remote_size: remoteSize,
        remote_by_type: remoteByType,
        local_count: localCount,
        local_size: localSize,
        local_by_type: localByType
      });
    });
  }

  function normalizeCategory(value) {
    return ['all', 'ALL', '__all__', 'all', ''].includes(value || '') ? '' : value;
  }

  function publicPathToFilePath(publicPath) {
    const clean = String(publicPath || '').replace(/^\/+/, '');
    return clean ? path.join(root, 'public', clean) : '';
  }

  async function autoTagMaterial(input) {
    const safeInput = input || {};
    const fallbackCategory = 'uncategorized';
    try {
      const ai = await classifier.autoCategory({
        filePath: safeInput.filePath,
        thumbPath: safeInput.thumbPath,
        fileType: safeInput.fileType || safeInput.type,
        original: safeInput.original || safeInput.filename || '',
        meta: {
          duration: safeInput.duration || 0,
          width: safeInput.width || 0,
          height: safeInput.height || 0
        }
      });
      return {
        category: ai && ai.category || fallbackCategory,
        tags: Array.isArray(ai && ai.tags) ? ai.tags : [],
        source: ai && ai.source || 'fallback',
        transcript_used: Boolean(ai && ai.transcript_used),
        transcript_length: Number(ai && ai.transcript_length) || 0
      };
    } catch(e) {
      console.log('[Materials] AI tag failed:', e.message);
      return { category: fallbackCategory, tags: [], source: 'fallback', transcript_used: false, transcript_length: 0 };
    }
  }

  const pendingAutoTagIds = new Set();

  function scheduleAutoTagMaterial(id, input) {
    const materialId = Number(id);
    if (!materialId || pendingAutoTagIds.has(materialId)) return;
    pendingAutoTagIds.add(materialId);
    const timer = setTimeout(async function() {
      try {
        const ai = await autoTagMaterial(input || {});
        db.run('UPDATE materials SET category=?, tags=? WHERE id=? AND (status IS NULL OR status != ?)', [
          ai.category || 'uncategorized',
          JSON.stringify(Array.isArray(ai.tags) ? ai.tags : []),
          materialId,
          'deleted'
        ], function(err) {
          if (err) console.error('[Materials] background AI tag update failed:', err.message);
        });
      } catch(e) {
        console.error('[Materials] background AI tag failed:', e.message);
      } finally {
        pendingAutoTagIds.delete(materialId);
      }
    }, 0);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  return {
    '/api/materials/upload': async function(body, cb) {
      try {
        const original = body.original || body.filename || body._originalName || 'file';
        const size = Number(body.size) || 0;
        const fileBase64 = body.file_base64 || body.video_base64 || '';
        const tempPath = body._tempPath || '';
        if (!fileBase64 && !tempPath) { cb({ error: 'missing file data' }); return; }
        if (size > 8 * 1024 * 1024 * 1024) { cb({ error: 'file is larger than 8GB' }); return; }

        const ext = path.extname(original || '.mp4').toLowerCase();
        const fileType = getFileType(ext);
        const baseOriginal = path.basename(original || 'file', ext) || 'file';
        const safe = media.safeName(baseOriginal) + ext;
        const filePath = path.join(uploadDir, fileType, safe);
        const typeDir = path.join(uploadDir, fileType);
        if (!fs.existsSync(typeDir)) fs.mkdirSync(typeDir, { recursive: true });

        if (tempPath) {
          fs.copyFileSync(tempPath, filePath);
          try { fs.unlinkSync(tempPath); } catch(e) {}
        } else {
          fs.writeFileSync(filePath, Buffer.from(fileBase64, 'base64'));
        }

        let duration = 0;
        let width = 0;
        let height = 0;
        let thumbUrl = '';
        let category = 'uncategorized';
        let tags = [];
        let aiMeta = { source: 'queued', queued: true };
        let storagePath = '';
        let remoteInfo = null;
        let autoTagInput = null;

        if (fileType === 'video') {
          const meta = await media.getVideoMeta(filePath);
          duration = meta.duration;
          width = meta.width;
          height = meta.height;
          const thumbName = media.safeName(original || 'video') + '.jpg';
          const thumbPath = path.join(thumbDir, thumbName);
          const thumbOk = await media.extractThumb(filePath, thumbPath);
          thumbUrl = thumbOk ? '/uploads/thumbs/' + thumbName : '';
          autoTagInput = {
            filePath: filePath,
            thumbPath: thumbOk ? thumbPath : '',
            fileType: fileType,
            original: original,
            duration: duration,
            width: width,
            height: height
          };
          if (internalFileStore && internalFileStore.enabled()) {
            try {
              remoteInfo = await internalFileStore.uploadFile(filePath, {
                filename: original || safe,
                size: size || fileSizeFor({ type: fileType, filename: safe, size: 0 }),
                type: mimeForExt(ext),
                lastModified: body.lastModified || body.last_modified || 0,
                duration: duration
              });
              storagePath = 'remote-file:' + remoteInfo.target_path;
              try { fs.unlinkSync(filePath); } catch(e) {}
              autoTagInput = Object.assign({}, autoTagInput, { filePath: '' });
            } catch(e) {
              console.error('[Materials] internal file upload failed:', e.message);
              if (requireInternalFileStore) {
                try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(unlinkErr) {}
                try { if (thumbUrl) fs.unlinkSync(publicPathToFilePath(thumbUrl)); } catch(unlinkThumbErr) {}
                cb({ error: 'internal file store upload failed; local fallback blocked: ' + e.message });
                return;
              }
              aiMeta = Object.assign({}, aiMeta || {}, {
                internal_file_error: e.message,
                storage_fallback: 'local'
              });
            }
          }
        } else if (fileType === 'image') {
          const meta = await media.getImageMeta(filePath);
          width = meta.width;
          height = meta.height;
          const thumbName = media.safeName(original || 'image') + '.jpg';
          const thumbPath = path.join(thumbDir, thumbName);
          const thumbOk = await media.extractImageThumb(filePath, thumbPath);
          thumbUrl = thumbOk ? '/uploads/thumbs/' + thumbName : '';
          autoTagInput = {
            filePath: filePath,
            thumbPath: thumbOk ? thumbPath : filePath,
            fileType: fileType,
            original: original,
            width: width,
            height: height
          };
        } else if (fileType === 'bgm') {
          autoTagInput = {
            filePath: filePath,
            fileType: fileType,
            original: original
          };
        }

        if (fileType !== 'video' && internalFileStore && internalFileStore.enabled()) {
          try {
            remoteInfo = await internalFileStore.uploadFile(filePath, {
              filename: original || safe,
              size: size || fileSizeFor({ type: fileType, filename: safe, size: 0 }),
              type: fileType === 'image' ? ('image/' + ext.replace(/^\./, '').replace('jpg', 'jpeg')) : mimeForExt(ext),
              lastModified: body.lastModified || body.last_modified || 0
            });
            storagePath = 'remote-file:' + remoteInfo.target_path;
            try { fs.unlinkSync(filePath); } catch(e) {}
            autoTagInput = Object.assign({}, autoTagInput || {}, { filePath: '', remote_storage: true });
          } catch(e) {
            console.error('[Materials] internal file upload failed:', e.message);
            if (requireInternalFileStore) {
              try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(unlinkErr) {}
              try { if (thumbUrl) fs.unlinkSync(publicPathToFilePath(thumbUrl)); } catch(unlinkThumbErr) {}
              cb({ error: 'internal file store upload failed; local fallback blocked: ' + e.message });
              return;
            }
            aiMeta = Object.assign({}, aiMeta || {}, {
              internal_file_error: e.message,
              storage_fallback: 'local'
            });
          }
        }

        const folder = body.folder || '/';
        db.run(
          `INSERT INTO materials (filename,original,size,duration,width,height,thumb,category,tags,type,folder,uploader,status,storage_path,created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            safe,
            original,
            size || fileSizeFor({ type: fileType, filename: safe, size: 0 }),
            duration,
            width,
            height,
            thumbUrl,
            category,
            JSON.stringify(tags),
            fileType,
            folder,
            body._auth && (body._auth.display_name || body._auth.username) || body.uploader || 'local-user',
            'ready',
            storagePath,
            Math.floor(Date.now() / 1000)
          ],
          function(err) {
            if (err) { cb({ error: err.message }); return; }
            if (autoTagInput) scheduleAutoTagMaterial(this.lastID, autoTagInput);
            const url = publicUrlFor({ id: this.lastID, type: fileType, filename: safe, storage_path: storagePath });
            cb({
              id: this.lastID,
              filename: safe,
              thumb: thumbUrl,
              category: category,
              tags: tags,
              type: fileType,
              folder: folder,
              storage_path: storagePath,
              remote_storage: Boolean(storagePath),
              remote_target_path: remoteInfo && remoteInfo.target_path || '',
              storage_fallback: aiMeta && aiMeta.storage_fallback || '',
              internal_file_error: aiMeta && aiMeta.internal_file_error || '',
              ai_queued: Boolean(autoTagInput),
              url: url,
              ai: aiMeta
            });
          }
        );
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/materials/list': function(body, cb) {
      const type = body.type || 'video';
      const category = normalizeCategory(body.category);
      const folder = body.folder;
      const search = body.search || '';
      const tag = body.tag || '';
      const id = parseInt(body.id || body.material_id || 0, 10) || 0;
      const page = Math.max(1, parseInt(body.page || 1, 10) || 1);
      const pageSize = Math.max(20, Math.min(200, parseInt(body.pageSize || body.page_size || 60, 10) || 60));
      const offset = (page - 1) * pageSize;
      const sortMap = {
        created_at: 'created_at',
        name: 'original',
        size: 'size',
        duration: 'duration',
        category: 'category'
      };
      const sortBy = sortMap[body.sortBy] || 'created_at';
      const sortDir = String(body.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
      let sql = 'SELECT * FROM materials WHERE type=? AND (status IS NULL OR status != ?)';
      const args = [type];
      args.push('deleted');
      if (category) {
        sql += ' AND category=?';
        args.push(category);
      }
      if (folder !== undefined && folder !== null && folder !== '') {
        sql += ' AND folder=?';
        args.push(folder);
      }
      if (search) {
        sql += ' AND (original LIKE ? OR category LIKE ? OR tags LIKE ? OR folder LIKE ?)';
        args.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
      }
      if (tag) {
        sql += ' AND tags LIKE ?';
        args.push('%' + tag + '%');
      }
      if (id) {
        sql += ' AND id=?';
        args.push(id);
      }

      const countSql = 'SELECT COUNT(*) as total FROM (' + sql + ')';
      db.get(countSql, args, function(countErr, countRow) {
        if (countErr) { cb({ error: countErr.message }); return; }
        db.all(sql, args, function(sizeErr, sizeRows) {
          if (sizeErr) { cb({ error: sizeErr.message }); return; }
          const totalSize = (sizeRows || []).reduce((sum, row) => sum + fileSizeFor(row), 0);
          const listSql = sql + ' ORDER BY ' + sortBy + ' ' + sortDir + ', id DESC LIMIT ? OFFSET ?';
          db.all(listSql, args.concat([pageSize, offset]), function(err, rows) {
            if (err) { cb({ error: err.message }); return; }
            getStorageSummary(function(storageErr, storage) {
              const materialRows = rows || [];
              const ids = materialRows.map(row => row.id).filter(Boolean);
              function finish(projectMap) {
                cb({
                  list: materialRows.map(row => {
                    const item = enrichMaterial(row);
                    const refs = projectMap[item.id] || [];
                    item.projects = refs;
                    item.project_names = refs.map(ref => ref.project_name).filter(Boolean);
                    return item;
                  }),
                  total: countRow && countRow.total || 0,
                  total_size: totalSize,
                  page: page,
                  pageSize: pageSize,
                  storage: storageErr ? null : storage
                });
              }
              if (!ids.length) {
                finish({});
                return;
              }
              const placeholders = ids.map(() => '?').join(',');
              const projectDbPath = path.join(root, 'data', 'project_delivery.db');
              function loadProjectRefs() {
                db.all(`SELECT tm.material_id, p.id AS project_id, p.name AS project_name, t.id AS task_id, t.group_name, t.plan_date
                  FROM project_delivery_db.project_delivery_task_materials tm
                  LEFT JOIN project_delivery_db.project_delivery_projects p ON p.id=tm.project_id
                  LEFT JOIN project_delivery_db.project_delivery_tasks t ON t.id=tm.task_id
                  WHERE tm.material_id IN (` + placeholders + `)`, ids, function(projectErr, projectRows) {
                  if (projectErr) {
                    finish({});
                    return;
                  }
                  const projectMap = {};
                  (projectRows || []).forEach(ref => {
                    if (!projectMap[ref.material_id]) projectMap[ref.material_id] = [];
                    projectMap[ref.material_id].push({
                      project_id: ref.project_id,
                      project_name: ref.project_name || '',
                      task_id: ref.task_id || 0,
                      group_name: ref.group_name || '',
                      plan_date: ref.plan_date || ''
                    });
                  });
                  finish(projectMap);
                });
              }
              db.run('ATTACH DATABASE ? AS project_delivery_db', [projectDbPath], function() {
                loadProjectRefs();
              });
              /*
              cb({
                list: (rows || []).map(enrichMaterial),
                total: countRow && countRow.total || 0,
                total_size: totalSize,
                page: page,
                pageSize: pageSize,
                storage: storageErr ? null : storage
              });
              */
            });
          });
        });
      });
    },

    '/api/materials/delete': function(body, cb) {
      const id = body.id;
      if (!id) { cb({ error: 'missing id' }); return; }
      db.get('SELECT filename, thumb, type, storage_path FROM materials WHERE id=?', [id], function(err, row) {
        if (err || !row) { cb({ error: 'not found' }); return; }
        db.run('UPDATE materials SET status=? WHERE id=?', ['deleted', id], function(deleteErr) {
          if (deleteErr) { cb({ error: deleteErr.message }); return; }
          cb({ ok: true, soft_deleted: true });
        });
      });
    },

    '/api/materials/download': function(body, cb) {
      const id = body.id;
      if (!id) { cb({ error: 'missing id' }); return; }
      cb({ ok: true, id: id });
    },

    '/api/materials/ai-tag': function(body, cb) {
      const id = body.id;
      if (!id) { cb({ error: 'missing id' }); return; }
      db.get('SELECT * FROM materials WHERE id=?', [id], async function(err, row) {
        if (err) { cb({ error: err.message }); return; }
        if (!row) { cb({ error: 'material not found' }); return; }

        const filePath = filePathFor(row);
        const thumbPath = row.thumb ? publicPathToFilePath(row.thumb) : '';
        const ai = await autoTagMaterial({
          filePath: filePath,
          thumbPath: thumbPath,
          fileType: row.type || 'video',
          original: row.original || row.filename || '',
          duration: row.duration || 0,
          width: row.width || 0,
          height: row.height || 0
        });

        db.run('UPDATE materials SET category=?, tags=? WHERE id=?', [
          ai.category,
          JSON.stringify(ai.tags),
          id
        ], function(updateErr) {
          if (updateErr) { cb({ error: updateErr.message }); return; }
          cb({
            ok: true,
            id: id,
            category: ai.category,
            tags: ai.tags,
            source: ai.source,
            transcript_used: ai.transcript_used,
            transcript_length: ai.transcript_length
          });
        });
      });
    },

    '/api/materials/update': function(body, cb) {
      const id = body.id;
      if (!id) { cb({ error: 'missing id' }); return; }
      const fields = [];
      const args = [];
      if (body.original !== undefined) { fields.push('original=?'); args.push(body.original); }
      if (body.tags !== undefined) { fields.push('tags=?'); args.push(JSON.stringify(body.tags)); }
      if (body.category !== undefined) { fields.push('category=?'); args.push(body.category); }
      if (body.folder !== undefined) { fields.push('folder=?'); args.push(body.folder); }
      if (!fields.length) { cb({ error: 'no fields to update' }); return; }
      args.push(id);

      db.run('UPDATE materials SET ' + fields.join(',') + ' WHERE id=?', args, function(err) {
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, changes: this.changes });
      });
    },

    '/api/materials/restore': function(body, cb) {
      const ids = Array.isArray(body.ids) ? body.ids : [body.id];
      const cleanIds = ids.filter(Boolean);
      if (!cleanIds.length) { cb({ error: 'missing id' }); return; }
      const placeholders = cleanIds.map(() => '?').join(',');
      db.run('UPDATE materials SET status=? WHERE id IN (' + placeholders + ')', ['ready'].concat(cleanIds), function(err) {
        if (err) { cb({ error: err.message }); return; }
        cb({ ok: true, restored: this.changes || 0 });
      });
    },

    '/api/materials/stats': function(body, cb) {
      const type = body.type || 'video';
      db.all('SELECT category, COUNT(*) as cnt FROM materials WHERE type=? AND (status IS NULL OR status != ?) GROUP BY category ORDER BY cnt DESC', [type, 'deleted'], function(err, rows) {
        if (err) { cb({ error: err.message }); return; }
        const total = rows.reduce((sum, row) => sum + row.cnt, 0);
        cb({ categories: rows, total: total });
      });
    },

    '/api/materials/storage': function(body, cb) {
      getStorageSummary(function(err, storage) {
        if (err) { cb({ error: err.message }); return; }
        cb(storage);
      });
    },

    '/api/materials/scan-unindexed': function(body, cb) {
      if (internalFileStore && internalFileStore.enabled()) {
        cb({
          ok: true,
          disabled: true,
          storage_mode: 'internal-file-store',
          total: 0,
          total_size: 0,
          by_type: {},
          files: []
        });
        return;
      }
      cb({
        ok: true,
        disabled: true,
        storage_mode: 'local-compat',
        total: 0,
        total_size: 0,
        by_type: {},
        files: []
      });
    },

    '/api/materials/import-unindexed': async function(body, cb) {
      try {
        cb({ error: 'local disk import is disabled; upload files to the internal file store' });
      } catch(e) {
        cb({ error: e.message });
      }
    },

    '/api/materials/folders': function(body, cb) {
      const type = body.type || 'video';
      db.all('SELECT folder, filename, type, size FROM materials WHERE type=? AND (status IS NULL OR status != ?)', [type, 'deleted'], function(countErr, materialRows) {
        if (countErr) { cb({ error: countErr.message }); return; }
        const folderStats = {};
        const folderDeepStats = {};
        (materialRows || []).forEach(row => {
          const key = row.folder || '/';
          const rowSize = fileSizeFor(row);
          if (!folderStats[key]) folderStats[key] = { count: 0, size: 0 };
          folderStats[key].count += 1;
          folderStats[key].size += rowSize;
          const parts = key.split('/').filter(Boolean);
          let currentPath = '/';
          if (!folderDeepStats[currentPath]) folderDeepStats[currentPath] = { count: 0, size: 0 };
          folderDeepStats[currentPath].count += 1;
          folderDeepStats[currentPath].size += rowSize;
          parts.forEach(part => {
            currentPath = currentPath === '/' ? '/' + part : currentPath + '/' + part;
            if (!folderDeepStats[currentPath]) folderDeepStats[currentPath] = { count: 0, size: 0 };
            folderDeepStats[currentPath].count += 1;
            folderDeepStats[currentPath].size += rowSize;
          });
        });
        db.all('SELECT * FROM folders WHERE type=? ORDER BY parent, name', [type], function(err, rows) {
          if (err) { cb({ error: err.message }); return; }
          const seenFolders = {};
          const childCounts = {};
          (rows || []).forEach(row => {
            const parent = row.parent || '/';
            childCounts[parent] = (childCounts[parent] || 0) + 1;
          });
          const folders = [];
          (rows || []).forEach(row => {
            const currentPath = folderPathFor(row);
            if (seenFolders[currentPath]) return;
            seenFolders[currentPath] = true;
            const stats = folderStats[currentPath] || { count: 0, size: 0 };
            const deepStats = folderDeepStats[currentPath] || stats;
            folders.push(Object.assign({}, row, {
              path: currentPath,
              count: stats.count,
              size: stats.size,
              deep_count: deepStats.count || 0,
              deep_size: deepStats.size || 0,
              children_count: childCounts[currentPath] || 0
            }));
          });
          cb({ folders: folders, root: Object.assign({}, folderStats['/'] || { count: 0, size: 0 }, {
            deep_count: folderDeepStats['/'] && folderDeepStats['/'].count || 0,
            deep_size: folderDeepStats['/'] && folderDeepStats['/'].size || 0
          }) });
        });
      });
    },

    '/api/materials/folders/create': function(body, cb) {
      const name = String(body.name || '').trim();
      const type = body.type || 'video';
      const parent = normalizeFolderParent(body.parent);
      if (!name) { cb({ error: 'missing folder name' }); return; }
      db.get('SELECT * FROM folders WHERE name=? AND parent=? AND type=? ORDER BY id LIMIT 1', [name, parent, type], function(getErr, existing) {
        if (getErr) { cb({ error: getErr.message }); return; }
        if (existing) {
          cb({ ok: true, id: existing.id, folder: Object.assign({}, existing, { path: folderPathFor(existing) }), existed: true });
          return;
        }
        db.run('INSERT INTO folders (name, parent, type) VALUES (?,?,?)', [name, parent, type], function(err) {
          if (err) { cb({ error: err.message }); return; }
          const folder = { id: this.lastID, name: name, parent: parent, type: type };
          cb({ ok: true, id: this.lastID, folder: Object.assign(folder, { path: folderPathFor(folder) }) });
        });
      });
    },

    '/api/materials/folders/delete': function(body, cb) {
      const id = body.id;
      const deleteMaterials = Boolean(body.deleteMaterials || body.delete_materials);
      if (!id) { cb({ error: 'missing id' }); return; }
      db.get('SELECT * FROM folders WHERE id=?', [id], function(err, row) {
        if (err || !row) { cb({ error: 'folder not found' }); return; }
        const currentPath = folderPathFor(row);
        if (deleteMaterials) {
          db.all('SELECT * FROM materials WHERE type=? AND (folder=? OR folder LIKE ?)', [row.type || 'video', currentPath, currentPath + '/%'], function(materialErr, materialRows) {
            if (materialErr) { cb({ error: materialErr.message }); return; }
            const failedFiles = [];
            (materialRows || []).forEach(material => deleteMaterialFiles(material, failedFiles));
            db.run('DELETE FROM materials WHERE type=? AND (folder=? OR folder LIKE ?)', [row.type || 'video', currentPath, currentPath + '/%'], function(materialDeleteErr) {
              if (materialDeleteErr) { cb({ error: materialDeleteErr.message }); return; }
              db.run('DELETE FROM folders WHERE (type=? AND name=? AND parent=?) OR parent=? OR parent LIKE ?', [row.type || 'video', row.name, row.parent || '/', currentPath, currentPath + '/%'], function(deleteErr) {
                if (deleteErr) { cb({ error: deleteErr.message }); return; }
                cb({
                  ok: true,
                  deleted_materials: (materialRows || []).length,
                  failed_files: failedFiles
                });
              });
            });
          });
          return;
        }
        db.run('DELETE FROM folders WHERE (type=? AND name=? AND parent=?) OR parent=? OR parent LIKE ?', [row.type || 'video', row.name, row.parent || '/', currentPath, currentPath + '/%'], function(deleteErr) {
          if (deleteErr) { cb({ error: deleteErr.message }); return; }
          db.run('UPDATE materials SET folder=? WHERE folder=? OR folder LIKE ?', ['/', currentPath, currentPath + '/%'], function(updateErr) {
            if (updateErr) { cb({ error: updateErr.message }); return; }
            cb({ ok: true });
          });
        });
      });
    },

    '/api/materials/folders/rename': function(body, cb) {
      const id = body.id;
      const name = String(body.name || '').trim();
      if (!id || !name) { cb({ error: 'missing id or name' }); return; }
      db.get('SELECT * FROM folders WHERE id=?', [id], function(getErr, row) {
        if (getErr || !row) { cb({ error: 'folder not found' }); return; }
        const oldPath = folderPathFor(row);
        const nextPath = row.parent === '/' ? '/' + name : row.parent + '/' + name;
        db.run('UPDATE folders SET name=? WHERE id=?', [name, id], function(err) {
          if (err) { cb({ error: err.message }); return; }
          db.run('UPDATE folders SET parent=REPLACE(parent, ?, ?) WHERE parent=? OR parent LIKE ?', [oldPath, nextPath, oldPath, oldPath + '/%'], function(parentErr) {
            if (parentErr) { cb({ error: parentErr.message }); return; }
            db.run('UPDATE materials SET folder=REPLACE(folder, ?, ?) WHERE folder=? OR folder LIKE ?', [oldPath, nextPath, oldPath, oldPath + '/%'], function(materialErr) {
              if (materialErr) { cb({ error: materialErr.message }); return; }
              cb({ ok: true, path: nextPath });
            });
          });
        });
      });
    },

    '/api/materials/folders/move': function(body, cb) {
      const id = body.id;
      const nextParent = normalizeFolderParent(body.parent || body.target || '/');
      if (!id) { cb({ error: 'missing id' }); return; }
      db.get('SELECT * FROM folders WHERE id=?', [id], function(getErr, row) {
        if (getErr || !row) { cb({ error: 'folder not found' }); return; }
        const oldPath = folderPathFor(row);
        if (oldPath === '/') { cb({ error: 'root folder cannot be moved' }); return; }
        if (nextParent === oldPath || nextParent.startsWith(oldPath + '/')) {
          cb({ error: 'cannot move a folder into itself' });
          return;
        }
        const nextPath = nextParent === '/' ? '/' + row.name : nextParent + '/' + row.name;
        if (nextPath === oldPath) { cb({ ok: true, path: oldPath, unchanged: true }); return; }
        db.get('SELECT id FROM folders WHERE name=? AND parent=? AND type=? AND id!=? LIMIT 1', [row.name, nextParent, row.type || 'video', id], function(conflictErr, conflict) {
          if (conflictErr) { cb({ error: conflictErr.message }); return; }
          if (conflict) { cb({ error: 'target folder already has a child with the same name' }); return; }
          db.run('UPDATE folders SET parent=? WHERE id=?', [nextParent, id], function(err) {
            if (err) { cb({ error: err.message }); return; }
            db.run('UPDATE folders SET parent=REPLACE(parent, ?, ?) WHERE parent=? OR parent LIKE ?', [oldPath, nextPath, oldPath, oldPath + '/%'], function(parentErr) {
              if (parentErr) { cb({ error: parentErr.message }); return; }
              db.run('UPDATE materials SET folder=REPLACE(folder, ?, ?) WHERE folder=? OR folder LIKE ?', [oldPath, nextPath, oldPath, oldPath + '/%'], function(materialErr) {
                if (materialErr) { cb({ error: materialErr.message }); return; }
                cb({ ok: true, path: nextPath, old_path: oldPath, parent: nextParent });
              });
            });
          });
        });
      });
    },

    _streamRemoteMaterial: function(options) {
      options = options || {};
      const id = options.id;
      const res = options.res;
      const mode = options.mode === 'download' ? 'download' : 'preview';
      if (!internalFileStore || !internalFileStore.enabled()) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('internal file store is not configured');
        return;
      }
      db.get('SELECT * FROM materials WHERE id=? AND (status IS NULL OR status != ?)', [id, 'deleted'], async function(err, row) {
        if (err || !row) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('material not found');
          return;
        }
        const targetPath = remoteTargetPath(row);
        if (!targetPath) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('material is not stored remotely');
          return;
        }
        try {
          await internalFileStore.proxyFile(targetPath, res, mode, options.req);
        } catch(e) {
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('remote file proxy failed: ' + e.message);
        }
      });
    }
  };
};


