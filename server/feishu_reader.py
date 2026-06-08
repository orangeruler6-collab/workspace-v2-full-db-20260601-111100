# -*- coding: utf-8 -*-
"""Read Feishu/Lark document text for workflow inputs."""
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request

FEISHU_APP_ID = os.environ.get('FEISHU_APP_ID', '')
FEISHU_APP_SECRET = os.environ.get('FEISHU_APP_SECRET', '')

if not FEISHU_APP_ID:
    try:
        cfg_path = r'C:\Users\Administrator\.openclaw\openclaw.json'
        if os.path.exists(cfg_path):
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
                feishu_cfg = cfg.get('channels', {}).get('feishu', {})
                FEISHU_APP_ID = feishu_cfg.get('appId', '')
                FEISHU_APP_SECRET = feishu_cfg.get('appSecret', '')
    except Exception:
        pass

TOKEN_CACHE = None
TOKEN_EXPIRES_AT = 0
LARK_CLI = (
    os.environ.get('LARK_CLI_BIN')
    or shutil.which('lark-cli')
    or shutil.which('lark-cli.cmd')
    or r'C:\Users\Administrator\AppData\Roaming\npm\lark-cli.cmd'
)


def get_tenant_token():
    global TOKEN_CACHE, TOKEN_EXPIRES_AT
    if TOKEN_CACHE and time.time() < TOKEN_EXPIRES_AT - 60:
        return TOKEN_CACHE

    url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
    payload = json.dumps({'app_id': FEISHU_APP_ID, 'app_secret': FEISHU_APP_SECRET}).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('code') == 0:
            TOKEN_CACHE = result['tenant_access_token']
            TOKEN_EXPIRES_AT = result.get('expire', 7200) + time.time()
            return TOKEN_CACHE
        return {'code': result.get('code'), 'msg': result.get('msg') or result.get('message') or 'tenant token rejected'}
    except Exception:
        return {'code': -1, 'msg': 'tenant token request failed'}


def feishu_get(path, token):
    url = 'https://open.feishu.cn/open-apis' + path
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}


def parse_jsonish(output):
    text = (output or '').strip()
    if not text:
        return None
    start = text.find('{')
    if start < 0:
        start = text.find('[')
    if start < 0:
        return None
    decoder = json.JSONDecoder()
    try:
        value, _ = decoder.raw_decode(text[start:])
        return value
    except Exception:
        return None


def read_with_lark_cli(doc_id):
    if not LARK_CLI or not os.path.exists(LARK_CLI):
        return {'error': 'lark-cli not found'}
    cmd = [
        LARK_CLI,
        'docs',
        '+fetch',
        '--doc',
        doc_id,
        '--as',
        'user',
        '--format',
        'json'
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=90
        )
    except Exception as e:
        return {'error': 'lark-cli fetch failed', 'detail': str(e)}

    raw = (proc.stdout or '') + ('\n' + proc.stderr if proc.stderr else '')
    parsed = parse_jsonish(raw)
    if proc.returncode != 0:
        return {
            'error': 'lark-cli fetch failed',
            'code': proc.returncode,
            'detail': parsed or raw[-1200:]
        }
    if not isinstance(parsed, dict):
        return {'error': 'lark-cli fetch parse failed', 'detail': raw[-1200:]}
    if not parsed.get('ok'):
        return {'error': 'lark-cli fetch failed', 'detail': parsed}

    data = parsed.get('data') if isinstance(parsed.get('data'), dict) else {}
    text = data.get('markdown') or data.get('content') or data.get('text') or ''
    # lark-cli returns URL-encoded link targets in markdown; leave body text intact.
    text = re.sub(r'\]\((https?%3A%2F%2F[^)]+)\)', lambda m: '](' + urllib.parse.unquote(m.group(1)) + ')', str(text))
    return {
        'title': data.get('title') or '',
        'text': text.strip(),
        'doc_id': data.get('doc_id') or doc_id,
        'source': 'lark-cli',
        'length': data.get('length') or len(text)
    }


def read_url_with_lark_cli(url):
    if not LARK_CLI or not os.path.exists(LARK_CLI):
        return {'error': 'lark-cli not found'}
    cmd = [
        LARK_CLI,
        'docs',
        '+fetch',
        '--doc',
        url,
        '--as',
        'user',
        '--format',
        'json'
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            timeout=90
        )
    except Exception as e:
        return {'error': 'lark-cli fetch failed', 'detail': str(e)}

    raw = (proc.stdout or '') + ('\n' + proc.stderr if proc.stderr else '')
    parsed = parse_jsonish(raw)
    if proc.returncode != 0:
        return {'error': 'lark-cli fetch failed', 'code': proc.returncode, 'detail': parsed or raw[-1200:]}
    if not isinstance(parsed, dict):
        return {'error': 'lark-cli fetch parse failed', 'detail': raw[-1200:]}
    if not parsed.get('ok'):
        return {'error': 'lark-cli fetch failed', 'detail': parsed}

    data = parsed.get('data') if isinstance(parsed.get('data'), dict) else {}
    text = data.get('markdown') or data.get('content') or data.get('text') or ''
    text = re.sub(r'\]\((https?%3A%2F%2F[^)]+)\)', lambda m: '](' + urllib.parse.unquote(m.group(1)) + ')', str(text))
    return {
        'title': data.get('title') or '',
        'text': text.strip(),
        'doc_id': data.get('doc_id') or extract_doc_id(url),
        'url': url,
        'source': 'lark-cli',
        'length': data.get('length') or len(text)
    }


def extract_doc_id(value):
    raw = str(value or '').strip()
    if not raw:
        return ''
    try:
        raw = urllib.parse.unquote(raw)
    except Exception:
        pass
    m = re.search(r'/(?:docx|docs|wiki)/([A-Za-z0-9_-]{8,})', raw)
    if m:
        return m.group(1)
    m = re.search(r'([A-Za-z0-9_-]{10,})', raw)
    return m.group(1) if m else raw


def collect_text(value, parts):
    if isinstance(value, dict):
        text_run = value.get('text_run')
        if isinstance(text_run, dict) and text_run.get('content'):
            parts.append(str(text_run.get('content')))
        for child in value.values():
            collect_text(child, parts)
    elif isinstance(value, list):
        for child in value:
            collect_text(child, parts)


def extract_text(blocks):
    parts = []
    for block in blocks:
        before = len(parts)
        collect_text(block, parts)
        if len(parts) > before:
            parts.append('\n')
    return ''.join(parts).strip()


def read_blocks(doc_id, token, api='docx'):
    all_blocks = []
    page_token = ''
    prefix = '/docx/v1/documents' if api == 'docx' else '/docs/v1/documents'
    while True:
        path = f'{prefix}/{doc_id}/blocks?page_size=500'
        if page_token:
            path += '&page_token=' + page_token
        resp = feishu_get(path, token)
        if resp.get('code') != 0:
            return all_blocks, resp
        data = resp.get('data', {})
        all_blocks.extend(data.get('items', []))
        if not data.get('has_more', False):
            return all_blocks, resp
        page_token = data.get('page_token', '')
        if not page_token:
            return all_blocks, resp


def read_title(doc_id, token, api='docx'):
    prefix = '/docx/v1/documents' if api == 'docx' else '/docs/v1/documents'
    resp = feishu_get(f'{prefix}/{doc_id}', token)
    if resp.get('code') != 0:
        return '', resp
    return resp.get('data', {}).get('document', {}).get('title', '') or '', resp


def main(params):
    p = params.get('params', params)
    url = p.get('url') or p.get('link') or p.get('feishu_url') or ''
    doc_id = p.get('doc_id', '') or extract_doc_id(url)
    if not doc_id:
        return {'error': 'doc_id or url required'}

    if url and '/wiki/' in url:
        cli_result = read_url_with_lark_cli(url)
        if cli_result.get('text'):
            cli_result['fallback_reason'] = 'wiki url resolved by lark-cli'
            return cli_result

    token = get_tenant_token()
    if not token or isinstance(token, dict):
        cli_result = read_with_lark_cli(doc_id)
        if cli_result.get('text'):
            cli_result['fallback_reason'] = 'tenant token failed'
            return cli_result
        return {
            'error': 'feishu token failed',
            'detail': token if isinstance(token, dict) else {'code': -1, 'msg': 'empty token response'},
            'cli_fallback': cli_result,
            'config': {
                'has_app_id': bool(FEISHU_APP_ID),
                'has_app_secret': bool(FEISHU_APP_SECRET)
            }
        }

    errors = {}
    title, title_resp = read_title(doc_id, token, 'docx')
    if title_resp.get('code') != 0:
        errors['docx_title'] = title_resp

    blocks, blocks_resp = read_blocks(doc_id, token, 'docx')
    if blocks_resp.get('code') != 0:
        errors['docx_blocks'] = blocks_resp

    if not blocks:
        legacy_title, legacy_title_resp = read_title(doc_id, token, 'docs')
        if legacy_title:
            title = legacy_title
        elif legacy_title_resp.get('code') != 0:
            errors['docs_title'] = legacy_title_resp
        blocks, legacy_blocks_resp = read_blocks(doc_id, token, 'docs')
        if legacy_blocks_resp.get('code') != 0:
            errors['docs_blocks'] = legacy_blocks_resp

    text = extract_text(blocks)
    if not text:
        cli_result = read_with_lark_cli(doc_id)
        if cli_result.get('text'):
            cli_result['fallback_reason'] = 'openapi returned empty text'
            return cli_result
    result = {'title': title, 'text': text, 'doc_id': doc_id}
    if not text and errors:
        result['errors'] = errors
    return result


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: feishu_reader.py <json_params_file>'}, ensure_ascii=False))
    else:
        try:
            with open(sys.argv[1], 'r', encoding='utf-8-sig') as f:
                args = json.load(f)
            print(json.dumps(main(args), ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'error': str(e)}, ensure_ascii=False))
