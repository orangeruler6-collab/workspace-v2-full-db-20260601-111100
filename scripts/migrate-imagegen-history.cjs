const fs = require('fs');
const https = require('https');
const path = require('path');
const sqlite3 = require('sqlite3');

const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'server', 'data', 'imagegen_history.db');
const uploadDir = path.join(root, 'public', 'uploads', 'imagegen');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function extFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('image/jpeg') || type.includes('image/jpg')) return '.jpg';
  if (type.includes('image/webp')) return '.webp';
  if (type.includes('image/gif')) return '.gif';
  return '.png';
}

function localUrl(filePath) {
  return '/uploads/imagegen/' + encodeURIComponent(path.basename(filePath));
}

function saveDataImage(value, model) {
  const match = String(value || '').match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) return '';
  const fileName = (model || 'imagegen') + '-migrated-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + extFromContentType(match[1]);
  const filePath = path.join(uploadDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'));
  return localUrl(filePath);
}

function downloadImage(url, model) {
  return new Promise(resolve => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { resolve(''); return; }
    if (!/^https?:$/i.test(parsed.protocol)) { resolve(''); return; }

    const req = https.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 UsagiImageHistory/1.0',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadImage(new URL(res.headers.location, parsed).toString(), model).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        resolve('');
        return;
      }
      const chunks = [];
      let size = 0;
      const maxSize = 24 * 1024 * 1024;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxSize) {
          req.destroy(new Error('too large'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const fileName = (model || 'imagegen') + '-migrated-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + extFromContentType(res.headers['content-type']);
        const filePath = path.join(uploadDir, fileName);
        fs.writeFile(filePath, Buffer.concat(chunks), err => resolve(err ? '' : localUrl(filePath)));
      });
    });
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(''));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      err ? reject(err) : resolve(this.changes || 0);
    });
  });
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.log('imagegen history db not found');
    return;
  }
  const db = new sqlite3.Database(dbPath);
  const rows = await all(db, "SELECT id, model, result_url FROM imagegen_history WHERE result_url NOT LIKE '/uploads/imagegen/%' ORDER BY id");
  let converted = 0;
  let skipped = 0;
  for (const row of rows) {
    const raw = String(row.result_url || '');
    let nextUrl = '';
    if (raw.startsWith('data:image/')) nextUrl = saveDataImage(raw, row.model);
    else if (/^https?:\/\//i.test(raw)) nextUrl = await downloadImage(raw, row.model);

    if (nextUrl) {
      await run(db, 'UPDATE imagegen_history SET result_url=? WHERE id=?', [nextUrl, row.id]);
      converted += 1;
      console.log('converted', row.id, nextUrl);
    } else {
      skipped += 1;
      console.log('skipped', row.id);
    }
  }
  db.close();
  console.log(JSON.stringify({ converted, skipped, total: rows.length }));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
