# -*- coding: utf-8 -*-
import sys, os, json, time

FEISHU_APP_ID = ''
FEISHU_APP_SECRET = ''
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

APP_TOKEN = 'WKOmbG4ubaqYqUsH5ErcvwqSnMh'
TABLE_ID = 'tblOZXJZyQ9LCx6k'

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

def api_get(path, token):
    import urllib.request
    url = 'https://open.feishu.cn/open-apis' + path
    req = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token}, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {'code': -1, 'msg': str(e)}

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
        result = api_get(
            f'/bitable/v1/apps/{APP_TOKEN}/tables/{TABLE_ID}/records?page_size=500',
            token
        )
        if result.get('code') == 0:
            items = []
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
            return {'items': items, 'total': len(items)}
        return {'code': 2, 'msg': result}

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
