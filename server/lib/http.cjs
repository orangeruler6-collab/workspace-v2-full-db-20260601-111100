const fs = require('fs');
const path = require('path');

function sendJSON(res, status, data) {
  if (res.writableEnded || res.destroyed) return;
  if (!res.headersSent) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    });
  }
  res.end(JSON.stringify(data));
}

function sendOptions(res) {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end();
}

function parseBody(req, parsedUrl, callback) {
  if (req.body !== undefined) {
    var parsedBody = req.body || {};
    if (typeof parsedBody === 'string') {
      try { parsedBody = JSON.parse(parsedBody); } catch (e) { parsedBody = {}; }
    }
    parsedBody._method = req.method;
    parsedUrl.searchParams.forEach(function(value, key) {
      if (parsedBody[key] === undefined) parsedBody[key] = value;
    });
    callback(parsedBody);
    return;
  }

  var rawBody = [];
  var totalSize = 0;
  var maxSize = Number(process.env.JSON_BODY_LIMIT_BYTES || 120 * 1024 * 1024);
  req.on('data', function(c) {
    totalSize += c.length;
    if (totalSize > maxSize) {
      req.destroy(new Error('request body too large'));
      return;
    }
    rawBody.push(c);
  });
  req.on('end', function() {
    var bodyStr = Buffer.concat(rawBody).toString('utf8');
    var body = {};
    try { body = JSON.parse(bodyStr); } catch (e) {
      console.error('JSON parse error:', e.message, 'body:', bodyStr);
    }
    body._method = req.method;
    parsedUrl.searchParams.forEach(function(value, key) {
      if (body[key] === undefined) body[key] = value;
    });
    callback(body);
  });
}

function serveUpload(root, routePath, res) {
  var uploadsMatch = routePath.match(/^\/uploads\/(.*)/);
  if (!uploadsMatch) return false;

  var uploadRoot = path.resolve(root, 'public', 'uploads');
  var uploadRel = uploadsMatch[1];
  try { uploadRel = decodeURIComponent(uploadRel); } catch (e) {}
  var filePath = path.resolve(uploadRoot, uploadRel);
  if (filePath !== uploadRoot && filePath.indexOf(uploadRoot + path.sep) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  fs.readFile(filePath, function(err, data) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    var ext = path.extname(filePath).toLowerCase();
    var mimeTypes = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.webm': 'video/webm',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.json': 'application/json',
      '.jsonl': 'application/x-ndjson',
      '.txt': 'text/plain; charset=utf-8',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.srt': 'text/plain; charset=utf-8',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.wav': 'audio/wav',
      '.flv': 'video/x-flv'
    };
    var headers = {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Content-Length': data.length
    };
    if (ext === '.doc' || ext === '.docx') {
      headers['Content-Disposition'] = "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(filePath));
    }
    res.writeHead(200, headers);
    res.end(data);
  });
  return true;
}

module.exports = {
  parseBody: parseBody,
  sendJSON: sendJSON,
  sendOptions: sendOptions,
  serveUpload: serveUpload
};
