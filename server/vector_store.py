# -*- coding: utf-8 -*-
import json
import os
import re
import sqlite3
import time
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(ROOT, 'data')
DB_PATH = os.environ.get('USAGI_VECTOR_DB') or os.path.join(DATA_DIR, 'vector_store.db')

COLLECTION_ALIASES = {
    'anythingllm_md_v2': 'wenan',
    'bf_library_v1': 'bf',
    'cases_library_v1': 'cases',
}

SEARCH_INTENT_WORDS = set()


def normalize_collection(value):
    key = str(value or 'wenan').strip() or 'wenan'
    return COLLECTION_ALIASES.get(key, key)


def get_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('''
        CREATE TABLE IF NOT EXISTS vector_items (
            id          TEXT PRIMARY KEY,
            collection  TEXT NOT NULL,
            text        TEXT NOT NULL,
            account     TEXT DEFAULT '通用',
            scene       TEXT DEFAULT '素材',
            type        TEXT DEFAULT 'template',
            hook        TEXT DEFAULT '',
            golden_line TEXT DEFAULT '',
            progression TEXT DEFAULT '',
            source      TEXT DEFAULT '',
            marketing_target TEXT DEFAULT '',
            content_direction TEXT DEFAULT '',
            case_tags   TEXT DEFAULT '',
            link        TEXT DEFAULT '',
            created_at  INTEGER DEFAULT 0,
            updated_at  INTEGER DEFAULT 0
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vector_items_collection ON vector_items(collection)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vector_items_collection_updated ON vector_items(collection, updated_at DESC, created_at DESC)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vector_items_collection_account ON vector_items(collection, account)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_vector_items_collection_scene ON vector_items(collection, scene)')
    conn.commit()
    return conn


def row_to_item(row):
    return {
        'id': row['id'],
        'content': row['text'],
        'text': row['text'],
        'account': row['account'] or '通用',
        'scene': row['scene'] or '素材',
        'type': row['type'] or 'template',
        'hook': row['hook'] or '',
        'golden_line': row['golden_line'] or '',
        'progression': row['progression'] or '',
        'source': row['source'] if 'source' in row.keys() else '',
        'marketing_target': row['marketing_target'] if 'marketing_target' in row.keys() else '',
        'content_direction': row['content_direction'] if 'content_direction' in row.keys() else '',
        'case_tags': row['case_tags'] if 'case_tags' in row.keys() else '',
        'link': row['link'] if 'link' in row.keys() else '',
        'created_at': row['created_at'] or 0,
        'updated_at': row['updated_at'] or 0,
    }


def row_to_list_item(row, preview_chars=320):
    item = row_to_item(row)
    full_text = item.get('text') or item.get('content') or ''
    preview = full_text[:preview_chars]
    item['content'] = preview
    item['text'] = preview
    item['preview'] = preview
    item['text_length'] = len(full_text)
    item['is_preview'] = len(full_text) > len(preview)
    return item


def clamp_int(value, fallback, minimum, maximum):
    try:
        n = int(value)
    except Exception:
        n = fallback
    return max(minimum, min(maximum, n))


def list_items(collection, params=None):
    key = normalize_collection(collection)
    params = params or {}
    limit = clamp_int(params.get('limit') or params.get('page_size') or params.get('pageSize'), 60, 1, 500)
    page = clamp_int(params.get('page'), 1, 1, 1000000)
    offset = params.get('offset')
    if offset is None:
        offset = (page - 1) * limit
    offset = clamp_int(offset, 0, 0, 100000000)
    keyword = str(params.get('keyword') or params.get('search') or '').strip().lower()
    account_filter = str(params.get('account') or '').strip()
    scene_filter = str(params.get('scene') or '').strip()

    where = ['collection=?']
    args = [key]
    if account_filter:
        where.append('account=?')
        args.append(account_filter)
    if scene_filter:
        where.append('scene=?')
        args.append(scene_filter)
    if keyword:
        pattern = '%' + keyword + '%'
        where.append('(' + ' OR '.join([
            'LOWER(text) LIKE ?',
            'LOWER(account) LIKE ?',
            'LOWER(scene) LIKE ?',
            'LOWER(type) LIKE ?',
            'LOWER(hook) LIKE ?',
            'LOWER(golden_line) LIKE ?',
            'LOWER(progression) LIKE ?',
            'LOWER(source) LIKE ?',
            'LOWER(marketing_target) LIKE ?',
            'LOWER(content_direction) LIKE ?',
            'LOWER(case_tags) LIKE ?',
            'LOWER(link) LIKE ?',
        ]) + ')')
        args.extend([pattern] * 12)

    conn = get_db()
    where_sql = ' AND '.join(where)
    total = conn.execute(
        'SELECT COUNT(*) AS cnt FROM vector_items WHERE ' + where_sql,
        tuple(args)
    ).fetchone()['cnt']
    rows = conn.execute(
        'SELECT * FROM vector_items WHERE ' + where_sql + ' ORDER BY updated_at DESC, created_at DESC LIMIT ? OFFSET ?',
        tuple(args + [limit, offset])
    ).fetchall()
    conn.close()
    items = [row_to_list_item(row) for row in rows]
    return {
        'data': items,
        'items': items,
        'total': total,
        'count': len(items),
        'limit': limit,
        'offset': offset,
        'page': page,
        'has_more': offset + len(items) < total,
        'collection': key
    }


def collection_stats(collection):
    key = normalize_collection(collection)
    conn = get_db()
    row = conn.execute(
        'SELECT COUNT(*) AS total, COUNT(DISTINCT account) AS accounts, COUNT(DISTINCT scene) AS scenes FROM vector_items WHERE collection=?',
        (key,)
    ).fetchone()
    conn.close()
    return {
        'collection': key,
        'total': row['total'] or 0,
        'accounts': row['accounts'] or 0,
        'scenes': row['scenes'] or 0
    }


def collection_facets(collection):
    key = normalize_collection(collection)
    conn = get_db()
    accounts = [
        row['account'] for row in conn.execute(
            'SELECT account FROM vector_items WHERE collection=? AND account != "" GROUP BY account ORDER BY COUNT(*) DESC, account LIMIT 300',
            (key,)
        ).fetchall()
    ]
    scenes = [
        row['scene'] for row in conn.execute(
            'SELECT scene FROM vector_items WHERE collection=? AND scene != "" GROUP BY scene ORDER BY COUNT(*) DESC, scene LIMIT 300',
            (key,)
        ).fetchall()
    ]
    conn.close()
    return {'collection': key, 'accounts': accounts, 'scenes': scenes}


def get_item(collection, id_):
    key = normalize_collection(collection)
    id_ = str(id_ or '').strip()
    if not id_:
        return {'success': False, 'error': 'id required', 'collection': key}
    conn = get_db()
    row = conn.execute(
        'SELECT * FROM vector_items WHERE collection=? AND id=?',
        (key, id_)
    ).fetchone()
    conn.close()
    if not row:
        return {'success': False, 'error': 'not found', 'collection': key, 'id': id_}
    item = row_to_item(row)
    return {'success': True, 'item': item, 'data': item, 'collection': key}


def add_item(collection, params):
    key = normalize_collection(collection)
    params = params or {}
    text = str(params.get('text') or params.get('content') or '').strip()
    if not text:
        return {'success': False, 'error': 'text required', 'collection': key}

    now = int(time.time())
    id_ = str(params.get('id') or '').strip() or str(uuid.uuid4())
    conn = get_db()
    exists = conn.execute(
        'SELECT id FROM vector_items WHERE id=? AND collection=?',
        (id_, key)
    ).fetchone()
    values = (
        id_,
        key,
        text,
        str(params.get('account') or '通用'),
        str(params.get('scene') or '素材'),
        str(params.get('type') or 'template'),
        str(params.get('hook') or ''),
        str(params.get('golden_line') or ''),
        str(params.get('progression') or ''),
        str(params.get('source') or ''),
        str(params.get('marketing_target') or ''),
        str(params.get('content_direction') or ''),
        str(params.get('case_tags') or ''),
        str(params.get('link') or ''),
        now,
        now,
    )

    if exists:
        conn.execute('''
            UPDATE vector_items
               SET text=?, account=?, scene=?, type=?, hook=?, golden_line=?, progression=?, source=?, marketing_target=?, content_direction=?, case_tags=?, link=?, updated_at=?
             WHERE id=? AND collection=?
        ''', (values[2], values[3], values[4], values[5], values[6], values[7], values[8], values[9], values[10], values[11], values[12], values[13], now, id_, key))
    else:
        conn.execute('''
            INSERT INTO vector_items
                (id, collection, text, account, scene, type, hook, golden_line, progression, source, marketing_target, content_direction, case_tags, link, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', values)

    conn.commit()
    conn.close()
    return {'success': True, 'id': id_, 'collection': key}


def delete_item(collection, id_):
    key = normalize_collection(collection)
    id_ = str(id_ or '').strip()
    if not id_:
        return {'success': False, 'error': 'id required', 'collection': key}

    conn = get_db()
    cur = conn.execute('DELETE FROM vector_items WHERE id=? AND collection=?', (id_, key))
    conn.commit()
    conn.close()
    return {'success': True, 'id': id_, 'deleted': cur.rowcount, 'collection': key}


def query_tokens(query):
    q = str(query or '').lower().strip()
    if not q:
        return []
    raw = []
    for part in q.replace('\n', ' ').replace('\r', ' ').split():
        part = part.strip('.,!?;:，。！？；：、()[]【】"\'“”')
        if part:
            raw.append(part)
    if not raw:
        raw = [q]
    noise = {
        '这个', '一个', '视频', '内容', '素材', '文案', '分析', '结构', '背景', '搜索',
        '转写', '原文', '来源', '可以', '需要', '但是', '因为', '所以', '我们', '他们',
        '帮我', '找一下', '看一下', '相关', '资料', '有没有', '适合', '参考一下',
        'the', 'and', 'http', 'https', 'www', 'com',
    }
    tokens = []
    for part in raw:
        if part in noise or len(part) < 2:
            continue
        if len(part) <= 18:
            tokens.append(part)
            for intent in SEARCH_INTENT_WORDS:
                if intent in part and intent != part:
                    tokens.append(intent)
            continue
        # Long pasted text is too noisy as a query. Keep only compact Chinese/ASCII entities.
        for match in re.findall(r'[a-z0-9_-]{2,30}|[\u4e00-\u9fff]{2,8}', part):
            if match not in noise:
                tokens.append(match)
    seen = set()
    picked = []
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        picked.append(token)
        if len(picked) >= 12:
            break
    return picked


def item_search_fields(item):
    return [
        (item.get('hook') or '', 5),
        (item.get('golden_line') or '', 5),
        (item.get('case_tags') or '', 4),
        (item.get('marketing_target') or '', 4),
        (item.get('content_direction') or '', 4),
        (item.get('account') or '', 3),
        (item.get('scene') or '', 3),
        (item.get('progression') or '', 3),
        (item.get('source') or '', 2),
        (item.get('content') or item.get('text') or '', 1),
        (item.get('link') or '', 1),
        (item.get('type') or '', 1),
    ]


def normalize_search_text(value):
    return str(value or '').lower()


def token_field_score(fields, token):
    token = str(token or '').lower().strip()
    if not token:
        return 0
    score = 0
    for raw_text, weight in fields:
        text = normalize_search_text(raw_text)
        if not text or token not in text:
            continue
        count = min(text.count(token), 4)
        base = 9 if len(token) >= 4 else 5
        score += (base + count) * weight
    return score


def score_item(item, query):
    q = str(query or '').lower().strip()
    tokens = query_tokens(q)
    if not q and not tokens:
        return 0
    fields = item_search_fields(item)
    text = ' '.join(normalize_search_text(value) for value, _ in fields)
    score = 0
    if q in text:
        score += 120 + min(text.count(q), 6) * 4
    matched = 0
    matched_terms = []
    for token in tokens:
        token_score = token_field_score(fields, token)
        if token_score:
            matched += 1
            matched_terms.append(token)
            score += token_score
    if tokens and matched == 0:
        return 0
    if len(tokens) >= 2:
        coverage = matched / float(len(tokens))
        if coverage >= 0.67:
            score += 18
        elif len(tokens) >= 3 and coverage >= 0.5:
            score += 7
        else:
            return 0
    item['_matched_tokens'] = matched
    item['_matched_terms'] = matched_terms[:8]
    return int(score)


def load_search_items(collection, account_filter='', scene_filter='', max_items=5000):
    key = normalize_collection(collection)
    where = ['collection=?']
    args = [key]
    if account_filter and account_filter != '通用':
        where.append('account=?')
        args.append(account_filter)
    if scene_filter:
        where.append('scene=?')
        args.append(scene_filter)
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM vector_items WHERE ' + ' AND '.join(where) + ' ORDER BY updated_at DESC, created_at DESC LIMIT ?',
        tuple(args + [max_items])
    ).fetchall()
    conn.close()
    return [row_to_item(row) for row in rows]


def search_result_item(item, preview_chars=900):
    full_text = item.get('text') or item.get('content') or ''
    preview = full_text[:preview_chars]
    result = dict(item)
    result['text'] = preview
    result['content'] = preview
    result['preview'] = preview
    result['text_length'] = len(full_text)
    result['is_preview'] = len(full_text) > len(preview)
    return result


def search_items(collection, params):
    key = normalize_collection(collection)
    params = params or {}
    query = str(params.get('query') or '').strip()
    limit = int(params.get('top_k') or params.get('limit') or 6)
    min_score = int(params.get('min_score') or params.get('minScore') or 1)
    account_filter = str(params.get('account') or '').strip()
    scene_filter = str(params.get('scene') or '').strip()

    items = load_search_items(key, account_filter, scene_filter)

    ranked = []
    for item in items:
        score = score_item(item, query)
        if query and score < min_score:
            continue
        next_item = search_result_item(item)
        next_item['score'] = score
        next_item['matched_tokens'] = item.get('_matched_tokens', 0)
        next_item['matched_terms'] = item.get('_matched_terms', [])
        ranked.append((score, next_item))
    ranked.sort(key=lambda pair: pair[0], reverse=True)

    results = [item for _, item in ranked[:limit]]
    return {'results': results, 'data': results, 'total': len(results), 'collection': key}


def run_action(action, params):
    params = params or {}
    collection = normalize_collection(params.get('collection') or params.get('key') or 'wenan')
    inner = params.get('params') if isinstance(params.get('params'), dict) else params

    if action == 'list':
        return list_items(collection, inner)
    if action == 'stats':
        return collection_stats(collection)
    if action == 'facets':
        return collection_facets(collection)
    if action == 'get':
        return get_item(collection, inner.get('id') if isinstance(inner, dict) else params.get('id'))
    if action == 'add':
        return add_item(collection, inner)
    if action == 'delete':
        return delete_item(collection, inner.get('id') if isinstance(inner, dict) else params.get('id'))
    if action == 'search':
        return search_items(collection, inner)
    return {'error': 'unknown action: ' + str(action), 'collection': collection}


def main_from_file(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
      payload = json.load(f)
    action = payload.get('action') or 'list'
    params = payload.get('params') or {}
    return run_action(action, params)


def write_json(result):
    text = json.dumps(result, ensure_ascii=False)
    try:
        sys_stdout = getattr(__import__('sys'), 'stdout')
        sys_stdout.buffer.write((text + '\n').encode('utf-8'))
    except Exception:
        print(json.dumps(result, ensure_ascii=True))
