# -*- coding: utf-8 -*-
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request


MAX_FETCH_RESULTS = 5
MAX_CONTENT_CHARS = 3500


def write(data):
    sys.stdout.buffer.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))


def clean(text):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', text or ''))).strip()


def truncate(text, limit):
    text = clean(text)
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + '...'


def fetch_url(url, timeout=10):
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        content_type = resp.headers.get('Content-Type', '')
        if 'text/html' not in content_type and 'application/xhtml' not in content_type:
            return ''
        raw = resp.read(1024 * 1024 * 2)
        charset = resp.headers.get_content_charset() or 'utf-8'
        return raw.decode(charset, errors='replace')


def strip_noise(markup):
    markup = re.sub(r'(?is)<script[^>]*>.*?</script>', ' ', markup)
    markup = re.sub(r'(?is)<style[^>]*>.*?</style>', ' ', markup)
    markup = re.sub(r'(?is)<noscript[^>]*>.*?</noscript>', ' ', markup)
    markup = re.sub(r'(?is)<!--.*?-->', ' ', markup)
    return markup


def extract_meta_description(markup):
    patterns = [
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:description["\']',
    ]
    for pattern in patterns:
        m = re.search(pattern, markup, re.I)
        if m:
            return clean(m.group(1))
    return ''


def block_score(text):
    if not text:
        return 0
    chinese = len(re.findall(r'[\u4e00-\u9fff]', text))
    punct = len(re.findall(r'[，。！？；：、]', text))
    return chinese + punct * 6 + min(len(text), 2000) * 0.05


def extract_article_text(markup):
    markup = strip_noise(markup)
    candidates = []
    selectors = [
        r'<article[^>]*>([\s\S]*?)</article>',
        r'<main[^>]*>([\s\S]*?)</main>',
        r'<div[^>]+(?:id|class)=["\'][^"\']*(?:article|content|main|text|post|body|rich_media|detail|news)[^"\']*["\'][^>]*>([\s\S]*?)</div>',
    ]
    for pattern in selectors:
        for block in re.findall(pattern, markup, re.I):
            text = clean(block)
            if len(text) >= 120:
                candidates.append(text)

    paragraphs = re.findall(r'<p[^>]*>([\s\S]*?)</p>', markup, re.I)
    paragraph_text = '\n'.join(clean(p) for p in paragraphs if len(clean(p)) >= 20)
    if len(paragraph_text) >= 120:
        candidates.append(paragraph_text)

    if not candidates:
        text = clean(markup)
        if len(text) >= 120:
            candidates.append(text)

    if not candidates:
        return ''
    candidates.sort(key=block_score, reverse=True)
    return truncate(candidates[0], MAX_CONTENT_CHARS)


def enrich_results(result):
    organic = result.get('organic') or []
    for idx, item in enumerate(organic):
        link = item.get('link') or item.get('url') or ''
        item['content'] = ''
        item['summary'] = truncate(item.get('snippet') or item.get('text') or '', 500)
        item['content_status'] = 'snippet_only'
        if idx >= MAX_FETCH_RESULTS or not link.startswith(('http://', 'https://')):
            continue
        if any(domain in link for domain in ['douyin.com', 'video/', 'javascript:']):
            continue
        try:
            markup = fetch_url(link)
            meta = extract_meta_description(markup)
            content = extract_article_text(markup)
            if content:
                item['content'] = content
                item['summary'] = truncate(content, 650)
                item['content_status'] = 'fetched'
            elif meta:
                item['summary'] = truncate(meta, 650)
                item['content_status'] = 'meta_only'
        except Exception as e:
            item['content_status'] = 'fetch_error'
            item['fetch_error'] = str(e)[:120]
    return result


def search_duckduckgo(query):
    url = 'https://duckduckgo.com/html/?' + urllib.parse.urlencode({'q': query})
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode('utf-8', errors='replace')

    blocks = re.findall(r'<div class="result[^"]*">([\s\S]*?)</div>\s*</div>', raw)
    organic = []
    for block in blocks:
        link_match = re.search(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>', block)
        if not link_match:
            continue
        href = html.unescape(link_match.group(1))
        if 'uddg=' in href:
            parsed = urllib.parse.urlparse(href)
            qs = urllib.parse.parse_qs(parsed.query)
            href = qs.get('uddg', [href])[0]
        snippet_match = re.search(r'<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)</a>', block)
        organic.append({
            'title': clean(link_match.group(2)),
            'link': href,
            'snippet': clean(snippet_match.group(1) if snippet_match else ''),
            'date': ''
        })
        if len(organic) >= 8:
            break
    return {'organic': organic, 'query': query, 'source': 'duckduckgo'}


def search_mcporter(query):
    workspace = r'C:\Users\Administrator\.openclaw\workspace'
    if os.name != 'nt' or not os.path.isdir(workspace):
        return None
    safe_query = "'" + str(query).replace("'", "''") + "'"
    cmd = [
        'powershell', '-NoProfile', '-NonInteractive',
        '-Command', f'mcporter call "minimax.web_search" query={safe_query} --output json'
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=workspace,
        env=dict(os.environ, PATHEXT='.COM;.EXE;.BAT;.CMD'),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=False
    )
    out, err = proc.communicate(timeout=25)
    raw = (out or b'').decode('utf-8', errors='replace')
    if proc.returncode != 0:
        detail = (err or b'').decode('utf-8', errors='replace')[:300]
        raise RuntimeError('mcporter failed: ' + detail)
    parsed = json.loads(raw)
    return {'organic': parsed.get('organic', []), 'query': query, 'source': 'mcporter'}


def main():
    query = sys.argv[1] if len(sys.argv) > 1 else ''
    if not query:
        return {'organic': []}
    try:
        result = search_mcporter(query)
        if result is not None:
            return enrich_results(result)
    except Exception:
        pass
    try:
        return enrich_results(search_duckduckgo(query))
    except Exception as e:
        return {'organic': [], 'error': str(e), 'query': query}


if __name__ == '__main__':
    write(main())
