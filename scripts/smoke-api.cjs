#!/usr/bin/env node

const http = require('http');
const https = require('https');
const path = require('path');

require('../server/env.cjs').loadEnv(path.join(__dirname, '..'));

const BASE_URL = process.env.API_BASE || 'http://127.0.0.1:5555';
const ADMIN_USER = process.env.SMOKE_ADMIN_USER || process.env.USAGI_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD || process.env.USAGI_ADMIN_PASSWORD || process.env.GATEWAY_TOKEN || '';

const preAuthChecks = [
  { name: '未登录禁止访问流水', method: 'GET', path: '/api/profits', expectedStatus: 401 },
  { name: '未登录禁止访问后台日志', method: 'POST', path: '/api/admin/logs', body: { limit: 1 }, expectedStatus: 401 }
];

const checks = [
  { name: '流水列表', method: 'GET', path: '/api/profits?grp=' + encodeURIComponent('内容四组') },
  { name: '素材列表', method: 'POST', path: '/api/materials/list', body: { category: '全部', search: '' } },
  { name: '排期加载', method: 'POST', path: '/api/schedule/load', body: {} },
  { name: '创意列表', method: 'GET', path: '/api/ideas/list' },
  { name: '向量列表', method: 'GET', path: '/api/vector/list' }
];

const postAuthSecurityChecks = [
  { name: '未映射 API 默认拒绝', method: 'GET', path: '/api/__security_probe__', expectedStatus: 403 }
];

function requestJson(check, token) {
  const url = new URL(check.path, BASE_URL);
  const client = url.protocol === 'https:' ? https : http;
  const body = check.body === undefined ? '' : JSON.stringify(check.body);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  if (token) headers.Authorization = 'Bearer ' + token;

  return new Promise((resolve, reject) => {
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: check.method,
      headers: headers,
      timeout: 20000
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch (err) {
          reject(new Error(check.name + ' 返回的不是 JSON: ' + raw.slice(0, 120)));
          return;
        }

        if (check.expectedStatus) {
          if (res.statusCode !== check.expectedStatus) {
            reject(new Error(check.name + ' 期望 HTTP ' + check.expectedStatus + '，实际 HTTP ' + res.statusCode + ': ' + (data.error || raw)));
            return;
          }
          resolve(data);
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(check.name + ' HTTP ' + res.statusCode + ': ' + (data.error || raw)));
          return;
        }
        if (data.error) {
          reject(new Error(check.name + ' 返回错误: ' + data.error));
          return;
        }
        resolve(data);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(check.name + ' 请求超时'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function countItems(data) {
  const list = data.items || data.data || data.list || data.tasks || data.logs || [];
  return Array.isArray(list) ? list.length : 0;
}

(async () => {
  console.log('API smoke base:', BASE_URL);
  const health = await requestJson({ name: '健康检查', method: 'GET', path: '/api/health' });
  console.log('✓ 健康检查 /api/health' + (health.authDisabled ? ' (免登录模式)' : ''));

  let token = '';
  if (health.authDisabled) {
    console.log('· 已开启 USAGI_AUTH_DISABLED，跳过未登录拦截和管理员登录检查');
  } else {
    for (const check of preAuthChecks) {
      await requestJson(check);
      console.log('✓ ' + check.name + ' ' + check.method + ' ' + check.path + ' (HTTP ' + check.expectedStatus + ')');
    }
    if (!ADMIN_PASSWORD) throw new Error('missing admin password: set USAGI_ADMIN_PASSWORD or GATEWAY_TOKEN');
    const auth = await requestJson({
      name: '管理员登录',
      method: 'POST',
      path: '/api/auth/login',
      body: { username: ADMIN_USER, password: ADMIN_PASSWORD }
    });
    if (!auth.token) throw new Error('管理员登录未返回 token');
    token = auth.token;
    console.log('✓ 管理员登录 ' + ADMIN_USER);
  }

  for (const check of checks) {
    const data = await requestJson(check, token);
    console.log('✓ ' + check.name + ' ' + check.method + ' ' + check.path + ' (' + countItems(data) + ' items)');
  }
  if (!health.authDisabled) {
    const logs = await requestJson({ name: '操作日志', method: 'POST', path: '/api/admin/logs', body: { limit: 5 } }, token);
    console.log('✓ 操作日志 POST /api/admin/logs (' + countItems(logs) + ' items)');
    for (const check of postAuthSecurityChecks) {
      await requestJson(check, token);
      console.log('✓ ' + check.name + ' ' + check.method + ' ' + check.path + ' (HTTP ' + check.expectedStatus + ')');
    }
  }
})().catch(err => {
  console.error('✗ smoke failed:', err.message);
  process.exit(1);
});
