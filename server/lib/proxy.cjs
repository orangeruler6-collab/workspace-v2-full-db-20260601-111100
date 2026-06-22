const { execFileSync } = require('child_process');

let HttpsProxyAgent;
try {
  HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent;
} catch (e) {
  HttpsProxyAgent = null;
}

let cachedWindowsProxy;

function normalizeProxyUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.indexOf('=') >= 0) {
    const parts = raw.split(';');
    for (const part of parts) {
      const pair = part.split('=');
      const key = String(pair[0] || '').trim().toLowerCase();
      const val = String(pair.slice(1).join('=') || '').trim();
      if ((key === 'https' || key === 'http') && val) {
        raw = val;
        break;
      }
    }
  }
  if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
  return raw;
}

function windowsSystemProxyUrl() {
  if (process.platform !== 'win32') return '';
  if (cachedWindowsProxy !== undefined) return cachedWindowsProxy;
  cachedWindowsProxy = '';
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabledOut = execFileSync('reg', ['query', key, '/v', 'ProxyEnable'], { encoding: 'utf8' });
    if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(enabledOut)) return cachedWindowsProxy;
    const proxyOut = execFileSync('reg', ['query', key, '/v', 'ProxyServer'], { encoding: 'utf8' });
    const match = proxyOut.match(/ProxyServer\s+REG_SZ\s+(.+)$/im);
    cachedWindowsProxy = normalizeProxyUrl(match && match[1]);
  } catch (e) {
    cachedWindowsProxy = '';
  }
  return cachedWindowsProxy;
}

function envProxyUrl(env) {
  const source = env || process.env;
  return normalizeProxyUrl(
    source.USAGI_PROXY_URL ||
    source.HTTPS_PROXY ||
    source.HTTP_PROXY ||
    source.ALL_PROXY ||
    source.https_proxy ||
    source.http_proxy ||
    source.all_proxy ||
    windowsSystemProxyUrl()
  );
}

function noProxyPatterns(env) {
  const source = env || process.env;
  return String(source.NO_PROXY || source.no_proxy || '127.0.0.1,localhost,::1')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function shouldBypassProxy(targetUrl, env) {
  let host = '';
  try {
    host = new URL(targetUrl).hostname.toLowerCase();
  } catch (e) {
    return false;
  }
  return noProxyPatterns(env).some(pattern => {
    if (pattern === '*') return true;
    if (pattern.startsWith('.')) return host.endsWith(pattern);
    return host === pattern || host.endsWith('.' + pattern);
  });
}

function buildProxyEnv(baseEnv) {
  const env = Object.assign({}, baseEnv || process.env);
  const proxyUrl = envProxyUrl(env);
  if (proxyUrl) {
    env.HTTP_PROXY = env.HTTP_PROXY || proxyUrl;
    env.HTTPS_PROXY = env.HTTPS_PROXY || proxyUrl;
    env.ALL_PROXY = env.ALL_PROXY || proxyUrl;
    env.http_proxy = env.http_proxy || proxyUrl;
    env.https_proxy = env.https_proxy || proxyUrl;
    env.all_proxy = env.all_proxy || proxyUrl;
  }
  env.NO_PROXY = env.NO_PROXY || env.no_proxy || '127.0.0.1,localhost,::1';
  env.no_proxy = env.no_proxy || env.NO_PROXY;
  return env;
}

function proxyAgentForUrl(targetUrl, env) {
  if (!HttpsProxyAgent || shouldBypassProxy(targetUrl, env)) return undefined;
  const proxyUrl = envProxyUrl(env);
  if (!proxyUrl) return undefined;
  return new HttpsProxyAgent(proxyUrl);
}

module.exports = {
  buildProxyEnv,
  envProxyUrl,
  normalizeProxyUrl,
  proxyAgentForUrl,
  windowsSystemProxyUrl
};
