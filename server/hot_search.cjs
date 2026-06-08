// 热点搜索 - 独立脚本：读取 argv，输出 JSON 到 stdout
// 用法: node hot_search.cjs "搜索关键词"
const { spawn } = require('child_process');
const path = require('path');

const query = process.argv[2] || '';
if (!query.trim()) {
  process.stdout.write(JSON.stringify({ organic: [] }));
  process.exit(0);
}

const scriptPath = path.join(__dirname, 'hot_search_worker.py');
const py = spawn(process.env.PYTHON || 'python3', [scriptPath, query], {
  cwd: path.join(__dirname),
  windowsHide: true,
  shell: false
});

let stdout = '', stderr = '';
py.stdout.on('data', d => { stdout += d.toString(); });
py.stderr.on('data', d => { stderr += d.toString(); });

py.on('close', code => {
  try {
    // 提取最后一行有效 JSON（可能有多行缓冲杂音）
    const lines = stdout.trim().split('\n');
    let parsed = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        try {
          parsed = JSON.parse(line);
          break;
        } catch {}
      }
    }
    if (!parsed) {
      process.stdout.write(JSON.stringify({ organic: [], error: 'parse failed' }));
      process.exit(0);
    }
    const organic = (parsed.organic || []).map(item => ({
      title: item.title || '',
      link: item.link || '',
      snippet: (item.snippet || '').replace(/<[^>]+>/g, '').slice(0, 120),
      date: item.date || ''
    }));
    process.stdout.write(JSON.stringify({ organic, query }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ organic: [], error: e.message }));
  }
});

py.on('error', e => {
  process.stdout.write(JSON.stringify({ organic: [], error: e.message }));
});
