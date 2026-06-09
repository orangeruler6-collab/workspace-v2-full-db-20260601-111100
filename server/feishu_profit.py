# -*- coding: utf-8 -*-
import sys, os, json, time, sqlite3

FEISHU_APP_ID = ''
FEISHU_APP_SECRET = ''
try:
    cfg_path = r'C:\Users\Administrator\.openclaw\openclaw.json'
    if os.path.exists(cfg_path):
        with open(cfg_path, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
            feishu_cfg = cfg.get('channels', {}).get('feishu', {})
            FEISHU_APP_ID = feishu_cfg.get('appId', '')
            FEISHU_APP_SECRET = feishu_cfg.get('appSecret', '')
except Exception:
    pass

APP_TOKEN = 'WKOmbG4ubaqYqUsH5ErcvwqSnMh'
TABLE_ID = 'tblOZXJZyQ9LCx6k'
PROFIT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'profit.db')

# 字段ID映射
FIELDS = {
    'month':      'fldPTAGAkM',   # 月份
    'project':    'fldkj0t7PX',   # 项目
    'platform':   'fldriEJ7Gb',   # 平台
    'account':    'fldoU0Amhm',   # 账号
    'fee':        'fldnBt0kU7',   # 费用（元）
    'schedule':   'fld7qlYAGD',   # 档期
    'note':       'fldCw1qkEw',   # 备注
}

TOKEN_CACHE = None
TOKEN_EXPIRES_AT = 0

def get_token():
    global TOKEN_CACHE, TOKEN_EXPIRES_AT
    if TOKEN_CACHE and time.time() < TOKEN_EXPIRES_AT - 60:
        return TOKEN_CACHE
    import urllib.request
    url = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal'
    data = json.dumps({'app_id': FEISHU_APP_ID, 'app_secret': FEISHU_APP_SECRET}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        if result.get('code') == 0:
            TOKEN_CACHE = result['tenant_access_token']
            TOKEN_EXPIRES_AT = result.get('expire', 7200) + time.time()
            return TOKEN_CACHE
    except Exception:
        pass
    return None

def api_post(path, payload, token):
    import urllib.request
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

def api_put(path, payload, token):
    import urllib.request
    url = 'https://open.feishu.cn/open-apis' + path
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }, method='PUT')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}

def api_get(path, token):
    import urllib.request
    url = 'https://open.feishu.cn/open-apis' + path
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}

def init_profit_db(conn):
    cols = {
        'feishu_record_id': 'TEXT',
        'feishu_sync_status': 'TEXT',
        'feishu_synced_at': 'INTEGER DEFAULT 0',
        'feishu_sync_error': 'TEXT',
    }
    for name, ddl in cols.items():
        try:
            conn.execute(f'ALTER TABLE profits ADD COLUMN {name} {ddl}')
        except Exception:
            pass
    conn.commit()

def get_profit_row(row_id):
    conn = sqlite3.connect(PROFIT_DB_PATH)
    conn.row_factory = sqlite3.Row
    init_profit_db(conn)
    row = conn.execute('SELECT * FROM profits WHERE id=?', (row_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def list_profit_rows(limit=0):
    conn = sqlite3.connect(PROFIT_DB_PATH)
    conn.row_factory = sqlite3.Row
    init_profit_db(conn)
    sql = 'SELECT * FROM profits ORDER BY id ASC'
    params = ()
    if limit:
        sql += ' LIMIT ?'
        params = (int(limit),)
    rows = [dict(row) for row in conn.execute(sql, params).fetchall()]
    conn.close()
    return rows

def mark_profit_sync(row_id, status, record_id='', error=''):
    conn = sqlite3.connect(PROFIT_DB_PATH)
    init_profit_db(conn)
    if record_id:
        conn.execute(
            'UPDATE profits SET feishu_record_id=?, feishu_sync_status=?, feishu_synced_at=?, feishu_sync_error=? WHERE id=?',
            (record_id, status, int(time.time()), error[:500], row_id)
        )
    else:
        conn.execute(
            'UPDATE profits SET feishu_sync_status=?, feishu_synced_at=?, feishu_sync_error=? WHERE id=?',
            (status, int(time.time()), error[:500], row_id)
        )
    conn.commit()
    conn.close()

def list_bitable_field_names(token):
    result = api_get(f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/fields?page_size=100', token)
    if result.get('code') != 0:
        return set()
    items = result.get('data', {}).get('items', [])
    return set(str(item.get('field_name') or '').strip() for item in items if item.get('field_name'))

def first_existing(available, names):
    for name in names:
        if not available or name in available:
            return name
    return ''

def put_field(fields, available, aliases, value):
    if value in (None, ''):
        return
    name = first_existing(available, aliases)
    if name:
        fields[name] = value

def profit_to_feishu_fields(row, available):
    fields = {}
    put_field(fields, available, ['本地ID', '本地id', 'ID'], str(row.get('id') or ''))
    put_field(fields, available, ['月份'], row.get('month') or '')
    put_field(fields, available, ['组别', '归属组', '小组'], row.get('grp') or '')
    put_field(fields, available, ['项目', '产品', '投放产品', '项目名称'], row.get('project') or '')
    put_field(fields, available, ['平台'], row.get('platform') or '')
    put_field(fields, available, ['账号', '账号名'], row.get('account') or '')
    put_field(fields, available, ['业务口径', '类型', '产品类型'], row.get('business_type') or row.get('category') or '')
    put_field(fields, available, ['流水', '费用（元）', '费用', '最终合作价'], int(row.get('revenue') or 0))
    put_field(fields, available, ['毛利', '预估毛利', '毛利预估'], int(row.get('margin') or 0))
    put_field(fields, available, ['档期'], row.get('month') or '')
    put_field(fields, available, ['备注', '说明'], row.get('remark') or '')
    put_field(fields, available, ['下单金额'], int(row.get('order_amount') or 0))
    put_field(fields, available, ['返点金额'], int(row.get('rebate_amount') or 0))
    put_field(fields, available, ['最终合作价格', '最终合作价'], int(row.get('final_amount') or row.get('revenue') or 0))
    put_field(fields, available, ['成本合计'], int(row.get('cost_total') or 0))
    put_field(fields, available, ['锁档日期'], row.get('lock_date') or '')
    put_field(fields, available, ['发布日期', '实际发布日期'], row.get('publish_date') or '')
    put_field(fields, available, ['是否发布'], '是' if int(row.get('is_published') or 0) else '否')
    put_field(fields, available, ['链接', '发布链接'], row.get('link') or '')
    put_field(fields, available, ['单号', 'CRM单号'], row.get('order_no') or '')
    put_field(fields, available, ['来源'], row.get('entry_source') or '')
    return fields

def upsert_profit_row(row, token, available_fields=None):
    available = available_fields if available_fields is not None else list_bitable_field_names(token)
    fields = profit_to_feishu_fields(row, available)
    if not fields:
        return {'ok': False, 'error': '飞书表格没有可写入字段'}
    record_id = row.get('feishu_record_id') or ''
    if record_id:
        result = api_put(f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records/{record_id}', {'fields': fields}, token)
        if result.get('code') == 0:
            mark_profit_sync(row.get('id'), 'synced', record_id, '')
            return {'ok': True, 'action': 'updated', 'record_id': record_id}
    result = api_post(f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records', {'fields': fields}, token)
    if result.get('code') == 0:
        new_id = result.get('data', {}).get('record', {}).get('record_id') or result.get('data', {}).get('record_id') or ''
        mark_profit_sync(row.get('id'), 'synced', new_id, '')
        return {'ok': True, 'action': 'created', 'record_id': new_id}
    error = result.get('msg') or result.get('message') or json.dumps(result, ensure_ascii=False)
    mark_profit_sync(row.get('id'), 'failed', record_id, error)
    return {'ok': False, 'error': error, 'feishu': result}

def batch_create_profit_rows(rows, token, available):
    payload_records = []
    source_rows = []
    for row in rows:
        fields = profit_to_feishu_fields(row, available)
        if fields:
            payload_records.append({'fields': fields})
            source_rows.append(row)
    if not payload_records:
        return {'created': 0, 'failed': len(rows), 'errors': [{'error': '飞书表格没有可写入字段'}]}
    result = api_post(
        f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records/batch_create',
        {'records': payload_records},
        token
    )
    if result.get('code') != 0:
        errors = []
        created = 0
        failed = 0
        for row in source_rows:
            single = upsert_profit_row(row, token, available)
            if single.get('ok'):
                created += 1
            else:
                failed += 1
                if len(errors) < 5:
                    errors.append({'id': row.get('id'), 'error': single.get('error')})
        return {'created': created, 'failed': failed, 'errors': errors}
    created_records = result.get('data', {}).get('records') or []
    for row, rec in zip(source_rows, created_records):
        record_id = rec.get('record_id') or ''
        mark_profit_sync(row.get('id'), 'synced', record_id, '')
    failed = max(0, len(source_rows) - len(created_records))
    return {'created': len(created_records), 'failed': failed, 'errors': []}

def sync_all_profit(limit=0):
    token = get_token()
    if not token:
        return {'code': 1, 'msg': '获取飞书token失败，请检查飞书 appId/appSecret 和应用权限'}
    rows = list_profit_rows(limit)
    available = list_bitable_field_names(token)
    stats = {'code': 0, 'total': len(rows), 'created': 0, 'updated': 0, 'failed': 0, 'errors': []}
    pending_create = []
    for row in rows:
        if not row.get('feishu_record_id'):
            pending_create.append(row)
            continue
        result = upsert_profit_row(row, token, available)
        if result.get('ok') and result.get('action') == 'created':
            stats['created'] += 1
        elif result.get('ok') and result.get('action') == 'updated':
            stats['updated'] += 1
        else:
            stats['failed'] += 1
            if len(stats['errors']) < 5:
                stats['errors'].append({'id': row.get('id'), 'error': result.get('error')})
    for i in range(0, len(pending_create), 100):
        batch = pending_create[i:i + 100]
        result = batch_create_profit_rows(batch, token, available)
        stats['created'] += result.get('created', 0)
        stats['failed'] += result.get('failed', 0)
        for err in result.get('errors', []):
            if len(stats['errors']) < 5:
                stats['errors'].append(err)
    return stats

def parse_text_with_ai(text, sf_key):
    """用AI把文本解析成结构化记录"""
    import urllib.request
    prompt = """你是一个财务记录解析助手。请从文本中提取毛利记录，输出纯JSON数组，不要任何其他文字。

支持的账号：天机妹、花蛮楼、麦晓花、夏天丶Cat、夏天Cat、有事找学姐、小张同学、呼叫网管、王者代做、代做

每条记录格式：
{
  "account": "账号名（必须匹配上述账号之一）",
  "fee": 金额（数字，单位元）,
  "project": "项目名称",
  "platform": "平台（抖音/B站/快手/私单）",
  "schedule": "档期（如：4月上旬、2026.4.10等，可空）",
  "note": "备注（可空）"
}

注意：
- 只提取我司账号，非我司账号忽略
- 金额必须是数字，如"3500"或"3500元"
- 如果文本中无法确定某个字段，设为空字符串""
- month 固定为 "4月"
- 只返回我司账号的记录，忽略其他

文本：
""" + text

    payload = json.dumps({
        'model': 'deepseek-ai/DeepSeek-V3',
        'messages': [
            {'role': 'user', 'content': prompt}
        ],
        'max_tokens': 2000,
        'temperature': 0.1
    })

    req = urllib.request.Request(
        'https://api.siliconflow.cn/v1/chat/completions',
        data=payload.encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sf_key},
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode('utf-8'))
        reply = result.get('choices', [{}])[0].get('message', {}).get('content', '')
        # 去掉可能的markdown代码块
        reply = reply.strip()
        if reply.startswith('```'):
            lines = reply.split('\n')
            reply = '\n'.join(lines[1:-1] if lines[-1].strip() == '```' else lines[1:])
        records = json.loads(reply)
        if isinstance(records, dict):
            records = [records]
        return records
    except Exception as e:
        return {'error': str(e)}

def parse_excel_from_data(file_data_b64, sf_key):
    """接收base64数据，保存临时文件，用pandas读取，再删文件"""
    import tempfile, base64, pandas as pd
    tmp = None
    try:
        tmp = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
        tmp.write(base64.b64decode(file_data_b64))
        tmp.close()
        df = pd.read_excel(tmp.name, sheet_name=0)
        records = []
        for _, row in df.iterrows():
            records.append({
                'account': str(row.iloc[0]) if len(row) > 0 else '',
                'fee': int(float(row.iloc[1])) if len(row) > 1 and str(row.iloc[1]).strip() else 0,
                'project': str(row.iloc[2]) if len(row) > 2 else '',
                'platform': str(row.iloc[3]) if len(row) > 3 else '抖音',
                'schedule': str(row.iloc[4]) if len(row) > 4 else '',
                'note': str(row.iloc[5]) if len(row) > 5 else '',
            })
        return records
    except Exception as e:
        return {'error': 'Excel解析失败: ' + str(e)}
    finally:
        if tmp:
            try: os.unlink(tmp.name)
            except: pass

def create_record(fields_data, token):
    """在bitable创建一条记录"""
    fields = {}
    for k, v in fields_data.items():
        fid = FIELDS.get(k)
        if fid and v not in (None, '', 0):
            fields[fid] = v

    result = api_post(
        f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records',
        {'fields': fields},
        token
    )
    return result

def write_records(records, token):
    """批量写入记录"""
    results = []
    for rec in records:
        if isinstance(rec, dict) and 'error' in rec:
            results.append({'ok': False, 'error': rec['error']})
            continue
        fields_data = {
            'month': '4月',
            'account': rec.get('account', ''),
            'fee': int(float(rec.get('fee', 0))),
            'project': rec.get('project', ''),
            'platform': rec.get('platform', '抖音'),
            'schedule': rec.get('schedule', ''),
            'note': rec.get('note', ''),
        }
        r = create_record(fields_data, token)
        results.append({'ok': r.get('code') == 0, 'record': rec, 'feishu': r})
    return results

def main(params):
    action = params.get('action', 'parse')
    p = params.get('params', params)

    try:
        from env import load_env
        load_env()
    except Exception:
        pass
    SF_KEY = os.environ.get('SILICONFLOW_API_KEY') or os.environ.get('SF_KEY') or ''

    if action == 'parse_text':
        text = p.get('text', '')
        records = parse_text_with_ai(text, SF_KEY)
        return {'records': records, 'count': len(records) if isinstance(records, list) else 0}

    elif action == 'parse_excel':
        file_data = p.get('file_data', '')
        if file_data:
            records = parse_excel_from_data(file_data, SF_KEY)
        else:
            records = {'error': 'no file data'}
        return {'records': records, 'count': len(records) if isinstance(records, list) else 0}

    elif action == 'write':
        records = p.get('records', [])
        token = get_token()
        if not token:
            return {'code': 1, 'msg': '获取飞书token失败'}
        results = write_records(records, token)
        ok_count = sum(1 for r in results if r.get('ok'))
        return {'code': 0, 'total': len(records), 'written': ok_count, 'results': results}

    elif action == 'read':
        token = get_token()
        if not token:
            return {'code': 1, 'msg': '获取飞书token失败'}
        items = []
        page_token = ''
        while True:
            path = f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records?page_size=500'
            if page_token:
                path += '&page_token=' + page_token
            result = api_get(path, token)
            if result.get('code') != 0:
                return {'code': 2, 'msg': result}
            for rec in result.get('data', {}).get('items', []):
                f = rec.get('fields', {})
                items.append({
                    'id': rec.get('record_id', ''),
                    '月份': f.get('月份', ''),
                    '项目': f.get('项目', ''),
                    '平台': f.get('平台', ''),
                    '账号': f.get('账号', ''),
                    '费用': f.get('费用（元）', 0),
                    '档期': f.get('档期', ''),
                    '备注': f.get('备注', ''),
                })
            data = result.get('data', {})
            if not data.get('has_more'):
                break
            page_token = data.get('page_token') or ''
            if not page_token:
                break
        return {'items': items, 'total': len(items)}

    elif action == 'upsert_profit':
        token = get_token()
        if not token:
            return {'code': 1, 'msg': '获取飞书token失败，请检查飞书 appId/appSecret 和应用权限'}
        row_id = p.get('id')
        row = get_profit_row(row_id)
        if not row:
            return {'code': 2, 'msg': '本地流水记录不存在'}
        result = upsert_profit_row(row, token)
        return {'code': 0 if result.get('ok') else 3, **result}

    elif action == 'sync_all_profit':
        return sync_all_profit(int(p.get('limit') or 0))

    return {'code': -1, 'msg': 'unknown action'}

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'code': -1, 'msg': 'Usage: feishu_profit.py <json_params_file>'}))
    else:
        try:
            with open(sys.argv[1], 'r', encoding='utf-8') as f:
                args = json.load(f)
            result = main(args)
            print(json.dumps(result, ensure_ascii=False))
        except Exception as e:
            print(json.dumps({'code': -1, 'msg': str(e)}, ensure_ascii=False))
