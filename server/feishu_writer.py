# -*- coding: utf-8 -*-
import sys
import os
import json
import urllib.request
import urllib.parse

FEISHU_APP_ID = os.environ.get('FEISHU_APP_ID', '')
FEISHU_APP_SECRET = os.environ.get('FEISHU_APP_SECRET', '')

# 从 openclaw.json 读取飞书配置
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

def get_tenant_token():
    global TOKEN_CACHE, TOKEN_EXPIRES_AT
    import time
    if TOKEN_CACHE and time.time() < TOKEN_EXPIRES_AT - 60:
        return TOKEN_CACHE
    url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
    payload = json.dumps({'app_id': FEISHU_APP_ID, 'app_secret': FEISHU_APP_SECRET})
    data = payload.encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('code') == 0:
            TOKEN_CACHE = result['tenant_access_token']
            TOKEN_EXPIRES_AT = result.get('expire', 7200) + time.time()
            return TOKEN_CACHE
        else:
            return None
    except Exception as e:
        return None


def feishu_post(path, payload, token):
    url = 'https://open.feishu.cn/open-apis' + path
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}


def feishu_get(path, token):
    url = 'https://open.feishu.cn/open-apis' + path
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}


def text_to_blocks(text, title_hint=None):
    """将文本转换为飞书文档 blocks 格式"""
    blocks = []
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')
    for line in lines:
        line = line.rstrip()
        if len(line) > 1800:
            for i in range(0, len(line), 1800):
                chunk = line[i:i + 1800]
                if chunk:
                    blocks.append({'block_type': 2, 'text': {'elements': [{'text_run': {'content': chunk}}], 'style': {}}})
            continue
        if not line:
            blocks.append({'block_type': 2, 'text': {'elements': [{'text_run': {'content': ' '}}], 'style': {}}})
        elif line.startswith('# '):
            blocks.append({'block_type': 3, 'heading1': {'elements': [{'text_run': {'content': line[2:]}}], 'style': {}}})
        elif line.startswith('## '):
            blocks.append({'block_type': 4, 'heading2': {'elements': [{'text_run': {'content': line[3:]}}], 'style': {}}})
        elif line.startswith('### '):
            blocks.append({'block_type': 5, 'heading3': {'elements': [{'text_run': {'content': line[4:]}}], 'style': {}}})
        elif line.startswith('- ') or line.startswith('* '):
            blocks.append({'block_type': 12, 'bullet': {'elements': [{'text_run': {'content': line[2:]}}], 'style': {}}})
        else:
            blocks.append({'block_type': 2, 'text': {'elements': [{'text_run': {'content': line}}], 'style': {}}})
    return blocks


def chunk_blocks(blocks, size=40):
    for i in range(0, len(blocks), size):
        yield blocks[i:i + size]


def write_to_doc(title, content, doc_id=None):
    """写入或追加到飞书文档"""
    token = get_tenant_token()
    if not token:
        return {'code': 1, 'msg': '获取飞书 token 失败，请检查 FEISHU_APP_ID/FEISHU_APP_SECRET 配置'}

    if not doc_id:
        # 创建新文档
        result = feishu_post('/docx/v1/documents', {'title': title}, token)
        if result.get('code') != 0:
            return {'code': 2, 'msg': '创建文档失败: ' + result.get('msg', str(result))}
        doc_id = result['data']['document']['document_id']
        doc_url = 'https://tcnnt6cxkcat.feishu.cn/docx/' + doc_id
    else:
        doc_url = 'https://tcnnt6cxkcat.feishu.cn/docx/' + doc_id

    # 追加内容块
    blocks = text_to_blocks(content)
    if blocks:
        # 先获取文档现有块数
        children_result = feishu_get('/docx/v1/documents/' + doc_id + '/blocks?page_size=1', token)
        # 在末尾追加
        payload = {'children': blocks, 'index': -1}
        block_result = feishu_post('/docx/v1/documents/' + doc_id + '/blocks/' + doc_id + '/children', payload, token)
        if block_result.get('code') != 0:
            return {'code': 3, 'msg': '写入内容失败: ' + block_result.get('msg', str(block_result)), 'doc_id': doc_id, 'doc_url': doc_url}

    return {'code': 0, 'doc_id': doc_id, 'doc_url': doc_url}


def write_to_doc(title, content, doc_id=None):
    token = get_tenant_token()
    if not token:
        return {'code': 1, 'msg': '获取飞书 token 失败，请检查 FEISHU_APP_ID/FEISHU_APP_SECRET 配置'}

    if not doc_id:
        result = feishu_post('/docx/v1/documents', {'title': title}, token)
        if result.get('code') != 0:
            return {'code': 2, 'msg': '创建文档失败: ' + result.get('msg', str(result))}
        doc_id = result['data']['document']['document_id']
        doc_url = 'https://tcnnt6cxkcat.feishu.cn/docx/' + doc_id
    else:
        doc_url = 'https://tcnnt6cxkcat.feishu.cn/docx/' + doc_id

    blocks = text_to_blocks(content or '')
    written = 0
    for part in chunk_blocks(blocks):
        payload = {'children': part, 'index': -1}
        block_result = feishu_post('/docx/v1/documents/' + doc_id + '/blocks/' + doc_id + '/children', payload, token)
        if block_result.get('code') != 0:
            return {
                'code': 3,
                'msg': '写入内容失败: ' + block_result.get('msg', str(block_result)),
                'doc_id': doc_id,
                'doc_url': doc_url,
                'written_blocks': written,
                'failed_blocks': len(part)
            }
        written += len(part)

    if not blocks:
        return {'code': 4, 'msg': '没有可写入的正文内容', 'doc_id': doc_id, 'doc_url': doc_url}
    return {'code': 0, 'doc_id': doc_id, 'doc_url': doc_url, 'written_blocks': written}


def main(params):
    action = params.get('action', '')
    if action == 'write':
        # Node runPython writes {action, params} so content lives inside params
        p = params.get('params', params)
        tool = p.get('tool', 'doc')
        title = p.get('title', '乌萨奇工作台产出')
        content = p.get('content', '')
        doc_id = p.get('doc_id', '')
        return write_to_doc(title, content, doc_id)
    return {'code': -1, 'msg': 'unknown action'}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'code': -1, 'msg': 'Usage: feishu_writer.py <json_params_file>'}))
    else:
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                args = json.load(f)
            result = main(args)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'code': -1, 'msg': str(e)}, ensure_ascii=False))
