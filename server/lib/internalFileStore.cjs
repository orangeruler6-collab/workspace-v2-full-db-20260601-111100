const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const DEFAULT_SERVERS = [
  'https://open-local-file1.changwankeji.com',
  'https://open-local-file2.changwankeji.com',
  'https://open-local-file3.changwankeji.com',
  'http://172.16.102.244:10088'
];

function formBoundary() {
  return '----usagi-file-' + crypto.randomBytes(12).toString('hex');
}

function formBuffer(fields) {
  const boundary = formBoundary();
  const chunks = [];
  Object.keys(fields || {}).forEach(name => {
    const field = fields[name];
    chunks.push(Buffer.from('--' + boundary + '\r\n'));
    if (field && field.buffer !== undefined) {
      chunks.push(Buffer.from(
        'Content-Disposition: form-data; name="' + name + '"; filename="' + (field.filename || 'blob') + '"\r\n' +
        'Content-Type: ' + (field.contentType || 'application/octet-stream') + '\r\n\r\n'
      ));
      chunks.push(Buffer.isBuffer(field.buffer) ? field.buffer : Buffer.from(field.buffer));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from('Content-Disposition: form-data; name="' + name + '"\r\n\r\n'));
      chunks.push(Buffer.from(String(field === undefined || field === null ? '' : field)));
      chunks.push(Buffer.from('\r\n'));
    }
  });
  chunks.push(Buffer.from('--' + boundary + '--\r\n'));
  return { boundary, body: Buffer.concat(chunks) };
}

function requestBuffer(method, url, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'http:' ? http : https;
    const req = transport.request({
      method,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'http:' ? 80 : 443),
      path: target.pathname + target.search,
      headers: options.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body,
          text: body.toString('utf8')
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(options.timeoutMs || 15000, () => req.destroy(new Error('request timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function parseJson(text) {
  try { return JSON.parse(text); } catch(e) { return null; }
}

function createInternalFileStore(options) {
  options = options || {};
  const token = options.token || process.env.INTERNAL_FILE_TOKEN || process.env.CONTENT_FILE_TOKEN || '';
  const servers = String(options.servers || process.env.INTERNAL_FILE_SERVERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  const serverList = servers.length ? servers : DEFAULT_SERVERS;
  const chunkSize = Number(options.chunkSize || process.env.INTERNAL_FILE_CHUNK_SIZE || 10 * 1024 * 1024);
  let cachedBaseUrl = '';
  let cachedAt = 0;

  function log(message, meta) {
    if (String(process.env.INTERNAL_FILE_DEBUG || 'true').toLowerCase() === 'false') return;
    try { console.log('[InternalFile]', message, meta ? JSON.stringify(meta) : ''); } catch(e) {}
  }

  function enabled() {
    return Boolean(token);
  }

  async function detectServer(force) {
    if (!enabled()) throw new Error('INTERNAL_FILE_TOKEN is not configured');
    if (!force && cachedBaseUrl && Date.now() - cachedAt < 10 * 60 * 1000) return cachedBaseUrl;
    const errors = [];
    for (const base of serverList) {
      try {
        const res = await requestBuffer('GET', base.replace(/\/+$/, '') + '/index.php', { timeoutMs: 3000 });
        const json = parseJson(res.text);
        if (json && json.data && json.data.status === 'running') {
          cachedBaseUrl = base.replace(/\/+$/, '');
          cachedAt = Date.now();
          return cachedBaseUrl;
        }
        errors.push(base + ' status=' + res.statusCode);
      } catch(e) {
        errors.push(base + ' ' + e.message);
      }
    }
    throw new Error('内网文件服务不可用：' + errors.join('；'));
  }

  function authHeaders(extra) {
    return Object.assign({
      Authorization: 'Bearer ' + token
    }, extra || {});
  }

  function fileHash(fileInfo) {
    const payload = JSON.stringify({
      name: fileInfo.name,
      size: fileInfo.size,
      lastModified: fileInfo.lastModified,
      type: fileInfo.type,
      chunk_size: chunkSize
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  async function postForm(endpoint, fields, timeoutMs) {
    const base = await detectServer();
    const form = formBuffer(fields);
    const res = await requestBuffer('POST', base + endpoint, {
      timeoutMs: timeoutMs || 120000,
      headers: authHeaders({
        'Content-Type': 'multipart/form-data; boundary=' + form.boundary,
        'Content-Length': form.body.length
      }),
      body: form.body
    });
    const json = parseJson(res.text);
    if (!json) throw new Error(endpoint + ' returned non-json: ' + res.text.slice(0, 160));
    if (json.code !== 200) throw new Error(json.msg || (json.data && json.data.msg) || (endpoint + ' failed'));
    return json.data || {};
  }

  async function check(fileInfo, hash, totalChunks) {
    return postForm('/api/check.php', {
      file_hash: hash,
      filename: fileInfo.name,
      size: fileInfo.size,
      total_chunks: totalChunks,
      chunk_size: chunkSize,
      filetype: fileInfo.type || '',
      fileext: path.extname(fileInfo.name || '').replace(/^\./, ''),
      during: fileInfo.duration || '',
      thumbpath: fileInfo.thumbpath || ''
    });
  }

  async function uploadChunk(hash, index, totalChunks, buffer) {
    const md5 = crypto.createHash('md5').update(buffer).digest('hex');
    return postForm('/api/upload.php', {
      file_hash: hash,
      chunk: index,
      total_chunk: totalChunks,
      chunk_md5: md5,
      fileChunk: {
        filename: 'chunk_' + index,
        contentType: 'application/octet-stream',
        buffer
      }
    }, 180000);
  }

  async function uploadFile(filePath, meta) {
    if (!enabled()) throw new Error('INTERNAL_FILE_TOKEN is not configured');
    const stat = fs.statSync(filePath);
    const fileInfo = {
      name: meta && meta.filename || path.basename(filePath),
      size: meta && Number(meta.size) || stat.size,
      lastModified: meta && Number(meta.lastModified) || Math.floor(stat.mtimeMs),
      type: meta && meta.type || 'video/mp4',
      duration: meta && meta.duration || ''
    };
    const hash = fileHash(fileInfo);
    const totalChunks = Math.max(1, Math.ceil(fileInfo.size / chunkSize));
    log('check start', { name: fileInfo.name, size: fileInfo.size, totalChunks });
    let status = await check(fileInfo, hash, totalChunks);
    log('check done', { status: status.status, missing: Array.isArray(status.missing_indexes) ? status.missing_indexes.length : null, target_path: status.target_path || status.relative_path || '' });
    const targetPath = status.target_path || status.relative_path || '';
    if (status.status !== 'completed') {
      const missing = Array.isArray(status.missing_indexes)
        ? status.missing_indexes
        : Array.from({ length: totalChunks }, (_, index) => index);
      const fd = fs.openSync(filePath, 'r');
      try {
        for (const index of missing) {
          const start = index * chunkSize;
          const len = Math.min(chunkSize, fileInfo.size - start);
          if (len <= 0) continue;
          const buffer = Buffer.alloc(len);
          fs.readSync(fd, buffer, 0, len, start);
          log('chunk upload start', { index, totalChunks, bytes: len });
          await uploadChunk(hash, index, totalChunks, buffer);
          log('chunk upload done', { index, totalChunks });
        }
      } finally {
        fs.closeSync(fd);
      }
      for (let retry = 0; retry < 15; retry += 1) {
        status = await check(fileInfo, hash, totalChunks);
        log('merge poll', { retry, status: status.status, progress: status.progress });
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (status.status !== 'completed') throw new Error('内网文件上传合并超时');
    }
    const finalTarget = status.target_path || status.relative_path || targetPath;
    return {
      ok: true,
      base_url: await detectServer(),
      file_hash: hash,
      target_path: finalTarget,
      relative_path: finalTarget,
      status: status.status || 'completed',
      preview_url: previewUrl(finalTarget),
      download_url: downloadUrl(finalTarget)
    };
  }

  function previewUrl(targetPath) {
    if (!targetPath) return '';
    const base = cachedBaseUrl || serverList[0].replace(/\/+$/, '');
    return base + '/api/preview.php?file_path=' + encodeURIComponent(targetPath);
  }

  function downloadUrl(targetPath) {
    if (!targetPath) return '';
    const base = cachedBaseUrl || serverList[0].replace(/\/+$/, '');
    return base + '/api/download.php?file_path=' + encodeURIComponent(targetPath);
  }

  async function proxyFile(targetPath, res, mode, clientReq) {
    const base = await detectServer();
    const endpoint = mode === 'download' ? '/api/download.php' : '/api/preview.php';
    return new Promise((resolve, reject) => {
      const target = new URL(base + endpoint + '?file_path=' + encodeURIComponent(targetPath));
      const transport = target.protocol === 'http:' ? http : https;
      const headers = authHeaders();
      if (clientReq && clientReq.headers && clientReq.headers.range) headers.Range = clientReq.headers.range;
      const upstream = transport.request({
        method: 'GET',
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: target.pathname + target.search,
        headers
      }, upstreamRes => {
        const passHeaders = {};
        [
          'content-type',
          'content-length',
          'content-range',
          'accept-ranges',
          'content-disposition',
          'last-modified',
          'etag'
        ].forEach(key => {
          if (upstreamRes.headers[key] !== undefined) passHeaders[key] = upstreamRes.headers[key];
        });
        passHeaders['Access-Control-Allow-Origin'] = '*';
        res.writeHead(upstreamRes.statusCode || 200, passHeaders);
        upstreamRes.pipe(res);
        upstreamRes.on('end', resolve);
        upstreamRes.on('error', reject);
      });
      upstream.on('error', reject);
      upstream.setTimeout(120000, () => upstream.destroy(new Error('remote preview timeout')));
      upstream.end();
    });
  }

  return {
    enabled,
    detectServer,
    uploadFile,
    previewUrl,
    downloadUrl,
    proxyFile
  };
}

module.exports = createInternalFileStore;
