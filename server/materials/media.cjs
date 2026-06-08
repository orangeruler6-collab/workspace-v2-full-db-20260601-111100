const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function ensureDirs(paths) {
  paths.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function safeName(filename) {
  return Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + String(filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function extractThumb(videoPath, outPath) {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-y', '-i', videoPath, '-ss', '00:00:01', '-vframes', '1', '-q:v', '2', '-f', 'image2', outPath]);
    proc.stderr.on('data', () => {});
    proc.on('error', () => resolve(false));
    proc.on('close', code => resolve(code === 0 && fs.existsSync(outPath)));
  });
}

function extractImageThumb(imagePath, outPath) {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-y', '-i', imagePath, '-vf', 'scale=320:-1', '-q:v', '2', outPath]);
    proc.stderr.on('data', () => {});
    proc.on('error', () => resolve(false));
    proc.on('close', code => resolve(code === 0 && fs.existsSync(outPath)));
  });
}

function getVideoMeta(videoPath) {
  return new Promise(resolve => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=width,height,codec_type',
      '-of', 'json',
      videoPath
    ]);
    let out = '';
    proc.stdout.on('data', chunk => { out += chunk.toString(); });
    proc.on('error', () => resolve({ duration: 0, width: 0, height: 0 }));
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const stream = (data.streams || []).find(item => item.codec_type === 'video') || {};
        resolve({
          duration: parseFloat(data.format && data.format.duration || 0) || 0,
          width: stream.width || 0,
          height: stream.height || 0
        });
      } catch(e) {
        resolve({ duration: 0, width: 0, height: 0 });
      }
    });
  });
}

function getImageMeta(imagePath) {
  return new Promise(resolve => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      imagePath
    ]);
    let out = '';
    proc.stdout.on('data', chunk => { out += chunk.toString(); });
    proc.on('error', () => resolve({ width: 0, height: 0 }));
    proc.on('close', () => {
      try {
        const data = JSON.parse(out);
        const stream = (data.streams || [])[0] || {};
        resolve({
          width: stream.width || 0,
          height: stream.height || 0
        });
      } catch(e) {
        resolve({ width: 0, height: 0 });
      }
    });
  });
}

function removeMaterialFiles(root, uploadDir, row) {
  if (!row) return;
  const filePath = path.join(uploadDir, row.type || 'video', row.filename || '');
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  if (row.thumb) {
    const thumbPath = path.join(root, 'public', row.thumb);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
  }
}

module.exports = {
  ensureDirs,
  safeName,
  extractThumb,
  extractImageThumb,
  getVideoMeta,
  getImageMeta,
  removeMaterialFiles
};

