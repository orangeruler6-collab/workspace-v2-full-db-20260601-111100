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
PROFIT_SPREADSHEET_TOKEN = 'Eha8sWY5GhDmVQtBHg5cthtenZb'
PROFIT_SPREADSHEET_URL = 'https://tcnnt6cxkcat.feishu.cn/sheets/Eha8sWY5GhDmVQtBHg5cthtenZb'
NON_ONE_PRICE_SPREADSHEET_TOKEN = os.environ.get('FEISHU_NON_ONE_PRICE_PROFIT_SPREADSHEET_TOKEN') or 'V9HGsvCHfhXBKkta3oPcrwIunmY'
NON_ONE_PRICE_SPREADSHEET_URL = os.environ.get('FEISHU_NON_ONE_PRICE_PROFIT_SPREADSHEET_URL') or 'https://tcnnt6cxkcat.feishu.cn/sheets/V9HGsvCHfhXBKkta3oPcrwIunmY'
PROFIT_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'profit.db')
DEFAULT_ACTIVE_PROFIT_YEAR = 2026

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

def api_patch(path, payload, token):
    import urllib.request
    url = 'https://open.feishu.cn/open-apis' + path
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
    }, method='PATCH')
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
        'category': 'TEXT',
        'business_type': 'TEXT',
        'entry_source': 'TEXT',
        'origin_group': 'TEXT',
        'producer_group': 'TEXT',
        'origin_share': 'INTEGER DEFAULT 30',
        'producer_share': 'INTEGER DEFAULT 70',
        'split_enabled': 'INTEGER DEFAULT 0',
        'group_revenue': 'INTEGER DEFAULT 0',
        'tax_revenue': 'INTEGER DEFAULT 0',
        'group_margin': 'INTEGER DEFAULT 0',
        'department_margin': 'INTEGER DEFAULT 0',
        'order_amount': 'INTEGER DEFAULT 0',
        'rebate_amount': 'INTEGER DEFAULT 0',
        'final_amount': 'INTEGER DEFAULT 0',
        'cost_total': 'INTEGER DEFAULT 0',
        'projected_margin': 'INTEGER DEFAULT 0',
        'lock_date': 'TEXT',
        'publish_date': 'TEXT',
        'is_published': 'INTEGER DEFAULT 0',
        'product_line': 'TEXT',
        'link': 'TEXT',
        'order_no': 'TEXT',
        'execution_status': 'TEXT',
        'original_id': 'TEXT',
        'crm_order_no': 'TEXT',
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

def row_execution_status(row):
    status = str(row.get('execution_status') or '').strip()
    if status in ('已完成', '完成', '结案', '执行完成'):
        return '已发布'
    if status:
        return status
    return '已发布' if int(row.get('is_published') or 0) else '未发布'

def is_one_price_profit(row):
    business_type = str(row.get('business_type') or row.get('category') or '').strip()
    if business_type:
        return '一口价' in business_type and '非一口价' not in business_type
    platform = str(row.get('platform') or '').strip()
    if '非一口价' in platform:
        return False
    return True

def split_profit_rows_by_price_mode(rows):
    one_price = []
    non_one_price = []
    for row in rows:
        if is_one_price_profit(row):
            one_price.append(row)
        else:
            non_one_price.append(row)
    return one_price, non_one_price

def profit_to_feishu_fields(row, available):
    fields = {}
    status = row_execution_status(row)
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
    put_field(fields, available, ['执行状态', '项目状态', '状态', '发布状态'], status)
    put_field(fields, available, ['是否发布'], '是' if status != '未发布' else '否')
    put_field(fields, available, ['原ID', '原id'], row.get('original_id') or '')
    put_field(fields, available, ['链接', '发布链接'], row.get('link') or '')
    put_field(fields, available, ['单号'], row.get('order_no') or '')
    put_field(fields, available, ['CRM单号', 'crm单号'], row.get('crm_order_no') or '')
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

SPREADSHEET_MAIN_HEADERS = [
    '太闽锁档日期',
    '锁定档期',
    '实际发布日期',
    '原ID',
    '产品',
    '游戏/非游',
    '单号',
    '平台',
    '部门',
    '账号',
    '投放产品',
    '链接',
    '下单金额',
    '返点金额',
    '最终合作价格',
    '说明',
    'CRM单号',
]

SPREADSHEET_SUMMARY_HEADERS = [
    '小组',
    '账号',
    '当月预估执行金额总计',
    '当月预估执行数量总计',
]

SPREADSHEET_EXTENSION_HEADERS = [
    '本地ID',
    '来源',
    '执行状态',
    '是否发布',
    '业务口径',
    '流水',
    '毛利',
    '成本合计',
    '毛利预估',
    '集团流水',
    '税后集团流水',
    '集团毛利',
    '部门毛利',
    '原组',
    '代做组',
    '原组比例',
    '代做比例',
    '内部分成',
]

SPREADSHEET_HEADERS = SPREADSHEET_MAIN_HEADERS + SPREADSHEET_SUMMARY_HEADERS + SPREADSHEET_EXTENSION_HEADERS
SPREADSHEET_MAIN_COLS = len(SPREADSHEET_MAIN_HEADERS)
SPREADSHEET_SUMMARY_COLS = len(SPREADSHEET_SUMMARY_HEADERS)
SPREADSHEET_EXTENSION_START_COL = SPREADSHEET_MAIN_COLS + SPREADSHEET_SUMMARY_COLS + 1

def active_profit_year():
    try:
        return int(os.environ.get('PROFIT_ACTIVE_YEAR') or DEFAULT_ACTIVE_PROFIT_YEAR)
    except Exception:
        return DEFAULT_ACTIVE_PROFIT_YEAR

def active_sheet_months():
    year = active_profit_year()
    return [(year, i) for i in range(1, 13)]

def historical_profit_years():
    return [year for year in [2025] if year != active_profit_year()]

def is_historical_sheet_title(title):
    text = str(title or '').strip()
    for year in historical_profit_years():
        if text.startswith(f'{str(year)[-2:]}.'):
            return True
    return False

def sheet_title(year, month):
    return f'{str(year)[-2:]}.{month}月'

def row_year_month(row):
    text = str(row.get('month') or row.get('publish_date') or row.get('lock_date') or '')
    import re
    match = re.search(r'(20\d{2})\D{0,3}(1[0-2]|0?[1-9])', text)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r'(1[0-2]|0?[1-9])\D*月', text)
    if match:
        created = int(row.get('created_at') or 0)
        year = time.localtime(created).tm_year if created else active_profit_year()
        return year, int(match.group(1))
    return active_profit_year(), 1

def money(value):
    try:
        text = str(value or '').replace(',', '').replace('￥', '').replace('¥', '').replace('元', '').strip()
        number = float(text or 0)
    except Exception:
        return 0
    if number.is_integer():
        return int(number)
    return round(number, 2)

def spreadsheet_main_values(row):
    final_amount = money(row.get('final_amount') or row.get('revenue'))
    status = row_execution_status(row)
    link = row.get('link') or ''
    if not link and status == '未发布':
        link = '未发'
    return [
        row.get('lock_date') or '',
        row.get('month') or '',
        row.get('publish_date') or '',
        row.get('original_id') or '',
        row.get('category') or row.get('business_type') or '',
        row.get('product_line') or '',
        row.get('order_no') or '',
        row.get('platform') or '',
        row.get('grp') or '',
        row.get('account') or '',
        row.get('project') or '',
        link,
        money(row.get('order_amount') or row.get('group_revenue') or row.get('revenue')),
        money(row.get('rebate_amount')),
        final_amount,
        row.get('remark') or '',
        row.get('crm_order_no') or '',
    ]

def spreadsheet_extension_values(row):
    projected_margin = money(row.get('projected_margin') or row.get('department_margin') or row.get('group_margin') or row.get('margin'))
    status = row_execution_status(row)
    return [
        row.get('id') or '',
        row.get('entry_source') or '',
        status,
        '是' if status != '未发布' else '否',
        row.get('business_type') or row.get('category') or '',
        money(row.get('revenue')),
        money(row.get('margin')),
        money(row.get('cost_total')),
        projected_margin,
        money(row.get('group_revenue')),
        money(row.get('tax_revenue')),
        money(row.get('group_margin')),
        money(row.get('department_margin')),
        row.get('origin_group') or '',
        row.get('producer_group') or '',
        money(row.get('origin_share')),
        money(row.get('producer_share')),
        '是' if int(row.get('split_enabled') or 0) else '否',
    ]

def build_month_summary_rows(rows):
    grouped = {}
    for row in rows:
        group = str(row.get('grp') or '').strip()
        account = str(row.get('account') or '').strip()
        if not group and not account:
            continue
        key = (group, account)
        item = grouped.setdefault(key, {'group': group, 'account': account, 'amount': 0, 'count': 0})
        item['amount'] += money(row.get('final_amount') or row.get('revenue'))
        item['count'] += 1
    return sorted(grouped.values(), key=lambda item: (item['group'], -item['amount'], item['account']))

def spreadsheet_row(row=None, summary=None):
    main_values = spreadsheet_main_values(row) if row else ['' for _ in SPREADSHEET_MAIN_HEADERS]
    summary_values = [
        summary.get('group') if summary else '',
        summary.get('account') if summary else '',
        money(summary.get('amount')) if summary else '',
        summary.get('count') if summary else '',
    ]
    extension_values = spreadsheet_extension_values(row) if row else ['' for _ in SPREADSHEET_EXTENSION_HEADERS]
    return main_values + summary_values + extension_values

def spreadsheet_meta(token, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    return api_get(f'/sheets/v2/spreadsheets/{spreadsheet_token}/metainfo', token)

def spreadsheet_sheet_map(token, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    result = spreadsheet_meta(token, spreadsheet_token)
    if result.get('code') != 0:
        raise RuntimeError(result.get('msg') or json.dumps(result, ensure_ascii=False))
    sheets = result.get('data', {}).get('sheets') or []
    return {item.get('title'): item.get('sheetId') for item in sheets if item.get('title') and item.get('sheetId')}

def ensure_spreadsheet_sheets(token, titles, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    sheet_map = spreadsheet_sheet_map(token, spreadsheet_token)
    missing = [title for title in titles if title not in sheet_map]
    for title in missing:
        result = api_post(
            f'/sheets/v2/spreadsheets/{spreadsheet_token}/sheets_batch_update',
            {'requests': [{'addSheet': {'properties': {'title': title}}}]},
            token
        )
        if result.get('code') != 0:
            raise RuntimeError(result.get('msg') or json.dumps(result, ensure_ascii=False))
    return spreadsheet_sheet_map(token, spreadsheet_token)

def column_name(index):
    name = ''
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name

def write_sheet_values(token, sheet_id, rows, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    max_rows = max(len(rows), 500)
    max_cols = len(SPREADSHEET_HEADERS)
    values = rows + [['' for _ in range(max_cols)] for _ in range(max_rows - len(rows))]
    end_col = column_name(max_cols - 1)
    result = api_put(
        f'/sheets/v2/spreadsheets/{spreadsheet_token}/values',
        {'valueRange': {'range': f'{sheet_id}!A1:{end_col}{max_rows}', 'values': values}},
        token
    )
    if result.get('code') != 0:
        raise RuntimeError(result.get('msg') or json.dumps(result, ensure_ascii=False))
    return result

def set_sheet_style(token, sheet_id, cell_range, style, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    return api_put(
        f'/sheets/v2/spreadsheets/{spreadsheet_token}/style',
        {'appendStyle': {'range': f'{sheet_id}!{cell_range}', 'style': style}},
        token
    )

def update_sheet_properties(token, sheet_id, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    return api_post(
        f'/sheets/v2/spreadsheets/{spreadsheet_token}/sheets_batch_update?user_id_type=open_id',
        {'requests': [{'updateSheet': {'properties': {'sheetId': sheet_id, 'frozenRowCount': 1}}}]},
        token
    )

def update_dimension(token, sheet_id, major_dimension, start_index, end_index, size, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    return api_put(
        f'/sheets/v2/spreadsheets/{spreadsheet_token}/dimension_range',
        {
            'dimension': {
                'sheetId': sheet_id,
                'majorDimension': major_dimension,
                'startIndex': start_index,
                'endIndex': end_index,
            },
            'dimensionProperties': {
                'visible': True,
                'fixedSize': size,
            }
        },
        token
    )

def apply_spreadsheet_style(token, sheet_id, row_count, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    errors = []

    def remember(result, label):
        if result.get('code') != 0 and len(errors) < 5:
            errors.append({'step': label, 'error': result.get('msg') or result.get('message') or json.dumps(result, ensure_ascii=False)})

    last_col = column_name(len(SPREADSHEET_HEADERS) - 1)
    summary_start_col = column_name(SPREADSHEET_MAIN_COLS)
    summary_end_col = column_name(SPREADSHEET_MAIN_COLS + SPREADSHEET_SUMMARY_COLS - 1)
    extension_start_col = column_name(SPREADSHEET_EXTENSION_START_COL - 1)
    money_cols = ['M', 'N', 'O', 'T', 'AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH']
    populated_rows = max(2, int(row_count or 0))

    remember(update_sheet_properties(token, sheet_id, spreadsheet_token), 'freeze_header')
    remember(set_sheet_style(token, sheet_id, f'A1:{last_col}1', {
        'font': {'bold': True, 'fontSize': '10pt/1.5', 'clean': False},
        'hAlign': 1,
        'vAlign': 1,
        'foreColor': '#FFFFFF',
        'backColor': '#1D4ED8',
        'borderType': 'FULL_BORDER',
        'borderColor': '#93C5FD',
        'clean': False,
    }, spreadsheet_token), 'header_base')
    remember(set_sheet_style(token, sheet_id, 'C1:C1', {
        'font': {'bold': True, 'fontSize': '10pt/1.5', 'clean': False},
        'hAlign': 1,
        'vAlign': 1,
        'foreColor': '#78350F',
        'backColor': '#FDE68A',
        'borderType': 'FULL_BORDER',
        'borderColor': '#F59E0B',
        'clean': False,
    }, spreadsheet_token), 'publish_header')
    remember(set_sheet_style(token, sheet_id, 'O1:O1', {
        'font': {'bold': True, 'fontSize': '10pt/1.5', 'clean': False},
        'hAlign': 1,
        'vAlign': 1,
        'foreColor': '#78350F',
        'backColor': '#FDE68A',
        'borderType': 'FULL_BORDER',
        'borderColor': '#F59E0B',
        'clean': False,
    }, spreadsheet_token), 'final_amount_header')
    remember(set_sheet_style(token, sheet_id, f'{summary_start_col}1:{summary_end_col}1', {
        'font': {'bold': True, 'fontSize': '10pt/1.5', 'clean': False},
        'hAlign': 1,
        'vAlign': 1,
        'foreColor': '#064E3B',
        'backColor': '#BBF7D0',
        'borderType': 'FULL_BORDER',
        'borderColor': '#86EFAC',
        'clean': False,
    }, spreadsheet_token), 'summary_header')
    remember(set_sheet_style(token, sheet_id, f'{extension_start_col}1:{last_col}1', {
        'font': {'bold': True, 'fontSize': '10pt/1.5', 'clean': False},
        'hAlign': 1,
        'vAlign': 1,
        'foreColor': '#334155',
        'backColor': '#E2E8F0',
        'borderType': 'FULL_BORDER',
        'borderColor': '#CBD5E1',
        'clean': False,
    }, spreadsheet_token), 'extension_header')
    remember(set_sheet_style(token, sheet_id, f'A2:{last_col}{populated_rows}', {
        'font': {'fontSize': '10pt/1.5', 'clean': False},
        'vAlign': 1,
        'foreColor': '#111827',
        'backColor': '#FFFFFF',
        'borderType': 'FULL_BORDER',
        'borderColor': '#E5E7EB',
        'clean': False,
    }, spreadsheet_token), 'body_border')
    remember(set_sheet_style(token, sheet_id, f'C2:C{populated_rows}', {
        'backColor': '#FFFBEB',
        'foreColor': '#78350F',
        'borderType': 'FULL_BORDER',
        'borderColor': '#FDE68A',
        'clean': False,
    }, spreadsheet_token), 'publish_body')
    remember(set_sheet_style(token, sheet_id, f'O2:O{populated_rows}', {
        'backColor': '#FFFBEB',
        'foreColor': '#78350F',
        'borderType': 'FULL_BORDER',
        'borderColor': '#FDE68A',
        'clean': False,
    }, spreadsheet_token), 'final_amount_body')
    remember(set_sheet_style(token, sheet_id, f'{summary_start_col}2:{summary_end_col}{populated_rows}', {
        'foreColor': '#064E3B',
        'backColor': '#F0FDF4',
        'borderType': 'FULL_BORDER',
        'borderColor': '#DCFCE7',
        'clean': False,
    }, spreadsheet_token), 'summary_body')
    remember(set_sheet_style(token, sheet_id, f'{extension_start_col}2:{last_col}{populated_rows}', {
        'foreColor': '#475569',
        'backColor': '#F8FAFC',
        'borderType': 'FULL_BORDER',
        'borderColor': '#E2E8F0',
        'clean': False,
    }, spreadsheet_token), 'extension_body')
    for col in money_cols:
        remember(set_sheet_style(token, sheet_id, f'{col}2:{col}{populated_rows}', {
            'formatter': '#,##0.00',
            'hAlign': 2,
            'vAlign': 1,
            'clean': False,
        }, spreadsheet_token), f'money_{col}')

    width_ranges = [
        (1, 3, 112),
        (4, 4, 76),
        (5, 5, 82),
        (6, 6, 92),
        (7, 7, 86),
        (8, 10, 96),
        (11, 11, 190),
        (12, 12, 260),
        (13, 15, 112),
        (16, 16, 170),
        (17, 17, 140),
        (18, 21, 136),
        (22, len(SPREADSHEET_HEADERS), 118),
    ]
    for start, end, size in width_ranges:
        remember(update_dimension(token, sheet_id, 'COLUMNS', start, end, size, spreadsheet_token), f'width_{start}_{end}')
    remember(update_dimension(token, sheet_id, 'ROWS', 1, 1, 34, spreadsheet_token), 'header_height')
    return {'ok': not errors, 'errors': errors}

def apply_spreadsheet_style_with_retry(token, sheet_id, row_count, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    result = apply_spreadsheet_style(token, sheet_id, row_count, spreadsheet_token)
    grid_pending = any('range exceeds grid limits' in str(err.get('error') or '') for err in result.get('errors', []))
    if not grid_pending:
        return result
    time.sleep(1)
    return apply_spreadsheet_style(token, sheet_id, row_count, spreadsheet_token)

def read_sheet_values(token, sheet_id, max_rows=5000, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    import urllib.parse
    max_cols = len(SPREADSHEET_HEADERS)
    end_col = column_name(max_cols - 1)
    range_text = f'{sheet_id}!A1:{end_col}{max_rows}'
    encoded_range = urllib.parse.quote(range_text, safe='')
    result = api_get(f'/sheets/v2/spreadsheets/{spreadsheet_token}/values/{encoded_range}', token)
    if result.get('code') != 0:
        raise RuntimeError(result.get('msg') or json.dumps(result, ensure_ascii=False))
    data = result.get('data') or {}
    value_range = data.get('valueRange') or data.get('value_range') or {}
    return value_range.get('values') or []

def normalize_header(value):
    return str(value or '').replace(' ', '').strip()

def header_index(headers, aliases):
    normalized = [normalize_header(item) for item in headers]
    for alias in aliases:
        key = normalize_header(alias)
        for idx, text in enumerate(normalized):
            if text == key:
                return idx
    for alias in aliases:
        key = normalize_header(alias)
        for idx, text in enumerate(normalized):
            if key and key in text:
                return idx
    return -1

def header_index_within(headers, aliases, start=0, end=None):
    end = len(headers) if end is None else min(len(headers), end)
    offset = header_index(headers[start:end], aliases)
    return start + offset if offset >= 0 else -1

def row_cell(row, index):
    if index < 0 or index >= len(row):
        return ''
    value = row[index]
    if value is None:
        return ''
    return str(value).strip()

def sheet_row_to_record(row, idx, sheet_title_text):
    def cell(name):
        return row_cell(row, idx.get(name, -1))

    project = cell('project')
    account = cell('account')
    group = cell('group')
    amount = money(cell('final_amount') or cell('order_amount') or cell('revenue'))
    if not (project or account or group or amount):
        return None

    status = cell('execution_status') or ('已发布' if cell('is_published') in ('是', '已发布', 'true', '1') else '')
    if status in ('已完成', '完成', '结案', '执行完成'):
        status = '已发布'
    publish_date = cell('publish_date')
    link = cell('link')
    if not status:
        status = '已发布' if publish_date or link else '未发布'

    return {
        'local_id': cell('local_id'),
        'grp': group,
        'account': account,
        'project': project,
        'platform': cell('platform'),
        'fee': amount,
        'revenue': amount,
        'margin': money(cell('projected_margin')),
        'schedule': cell('schedule') or sheet_title_text,
        'month': cell('schedule') or sheet_title_text,
        'note': cell('remark'),
        'category': cell('category'),
        'business_type': cell('business_type') or cell('category'),
        'entry_source': cell('entry_source') or 'feishu',
        'order_amount': money(cell('order_amount')),
        'rebate_amount': money(cell('rebate_amount')),
        'final_amount': money(cell('final_amount')) or amount,
        'cost_total': money(cell('cost_total')),
        'projected_margin': money(cell('projected_margin')),
        'lock_date': cell('lock_date'),
        'publish_date': publish_date,
        'execution_status': status,
        'is_published': 0 if status == '未发布' else 1,
        'original_id': cell('original_id'),
        'product_line': cell('product_line'),
        'link': link,
        'order_no': cell('order_no'),
        'crm_order_no': cell('crm_order_no'),
        'origin_group': cell('origin_group'),
        'producer_group': cell('producer_group'),
        'origin_share': money(cell('origin_share')) or 30,
        'producer_share': money(cell('producer_share')) or 70,
    }

def spreadsheet_rows_to_records(values, sheet_title_text):
    if not values:
        return []
    headers = values[0]
    idx = {
        'local_id': header_index_within(headers, ['本地ID', '本地id', 'ID'], SPREADSHEET_EXTENSION_START_COL - 1),
        'entry_source': header_index_within(headers, ['来源'], SPREADSHEET_EXTENSION_START_COL - 1),
        'lock_date': header_index_within(headers, ['太闽锁档日期', '锁档日期'], 0, SPREADSHEET_MAIN_COLS),
        'schedule': header_index_within(headers, ['锁定档期', '档期'], 0, SPREADSHEET_MAIN_COLS),
        'publish_date': header_index_within(headers, ['实际发布日期', '发布日期'], 0, SPREADSHEET_MAIN_COLS),
        'execution_status': header_index_within(headers, ['执行状态', '项目状态', '状态', '发布状态'], SPREADSHEET_EXTENSION_START_COL - 1),
        'is_published': header_index_within(headers, ['是否发布'], SPREADSHEET_EXTENSION_START_COL - 1),
        'original_id': header_index_within(headers, ['原ID', '原id'], 0, SPREADSHEET_MAIN_COLS),
        'category': header_index_within(headers, ['产品', '产品类型'], 0, SPREADSHEET_MAIN_COLS),
        'product_line': header_index_within(headers, ['游戏/非游', '产品线'], 0, SPREADSHEET_MAIN_COLS),
        'order_no': header_index_within(headers, ['单号'], 0, SPREADSHEET_MAIN_COLS),
        'platform': header_index_within(headers, ['平台'], 0, SPREADSHEET_MAIN_COLS),
        'group': header_index_within(headers, ['部门', '组别'], 0, SPREADSHEET_MAIN_COLS),
        'account': header_index_within(headers, ['账号', '账号名'], 0, SPREADSHEET_MAIN_COLS),
        'project': header_index_within(headers, ['投放产品', '项目', '产品/项目', '项目名称'], 0, SPREADSHEET_MAIN_COLS),
        'link': header_index_within(headers, ['链接', '发布链接'], 0, SPREADSHEET_MAIN_COLS),
        'order_amount': header_index_within(headers, ['下单金额'], 0, SPREADSHEET_MAIN_COLS),
        'rebate_amount': header_index_within(headers, ['返点金额'], 0, SPREADSHEET_MAIN_COLS),
        'final_amount': header_index_within(headers, ['最终合作价格', '最终合作价', '实际金额'], 0, SPREADSHEET_MAIN_COLS),
        'revenue': header_index_within(headers, ['流水', '费用'], SPREADSHEET_EXTENSION_START_COL - 1),
        'cost_total': header_index_within(headers, ['成本合计'], SPREADSHEET_EXTENSION_START_COL - 1),
        'projected_margin': header_index_within(headers, ['毛利预估', '预估毛利', '毛利'], SPREADSHEET_EXTENSION_START_COL - 1),
        'remark': header_index_within(headers, ['说明', '备注'], 0, SPREADSHEET_MAIN_COLS),
        'crm_order_no': header_index_within(headers, ['CRM单号', 'crm单号'], 0, SPREADSHEET_MAIN_COLS),
        'business_type': header_index_within(headers, ['业务口径', '类型'], SPREADSHEET_EXTENSION_START_COL - 1),
        'origin_group': header_index_within(headers, ['原组'], SPREADSHEET_EXTENSION_START_COL - 1),
        'producer_group': header_index_within(headers, ['代做组'], SPREADSHEET_EXTENSION_START_COL - 1),
        'origin_share': header_index_within(headers, ['原组比例'], SPREADSHEET_EXTENSION_START_COL - 1),
        'producer_share': header_index_within(headers, ['代做比例'], SPREADSHEET_EXTENSION_START_COL - 1),
    }
    records = []
    for row in values[1:]:
        record = sheet_row_to_record(row, idx, sheet_title_text)
        if record:
            records.append(record)
    return records

def group_rows_by_sheet(rows):
    active_year = active_profit_year()
    grouped = {}
    skipped = 0
    for year, month in active_sheet_months():
        grouped[sheet_title(year, month)] = []
    for row in rows:
        year, month = row_year_month(row)
        if int(year) != int(active_year):
            skipped += 1
            continue
        title = sheet_title(year, month)
        grouped.setdefault(title, []).append(row)
    return grouped, skipped

def hide_historical_spreadsheet_sheets(token, sheet_map, spreadsheet_token=PROFIT_SPREADSHEET_TOKEN):
    errors = []
    hidden = 0
    for title, sheet_id in sheet_map.items():
        if not is_historical_sheet_title(title):
            continue
        result = api_post(
            f'/sheets/v2/spreadsheets/{spreadsheet_token}/sheets_batch_update?user_id_type=open_id',
            {'requests': [{'updateSheet': {'properties': {'sheetId': sheet_id, 'hidden': True}}}]},
            token
        )
        if result.get('code') == 0:
            hidden += 1
        elif len(errors) < 5:
            errors.append({'sheet': title, 'error': result.get('msg') or result.get('message') or json.dumps(result, ensure_ascii=False)})
    return {'hidden': hidden, 'errors': errors}

def mark_rows_sheet_synced(rows, status='synced', error=''):
    conn = sqlite3.connect(PROFIT_DB_PATH)
    init_profit_db(conn)
    now = int(time.time())
    for row in rows:
        conn.execute(
            'UPDATE profits SET feishu_sync_status=?, feishu_synced_at=?, feishu_sync_error=? WHERE id=?',
            (status, now, error[:500], row.get('id'))
        )
    conn.commit()
    conn.close()

def sync_profit_spreadsheet_target(token, source_rows, spreadsheet_token, spreadsheet_url, target_name, active_year, only_row_id=None):
    grouped, skipped_historical = group_rows_by_sheet(source_rows)
    if only_row_id:
        target = next((row for row in source_rows if int(row.get('id') or 0) == int(only_row_id)), None)
        if not target:
            return {'code': 0, 'total': 0, 'created': 0, 'updated': 0, 'failed': 0, 'skipped_historical': 0, 'active_year': active_year, 'url': spreadsheet_url, 'target': target_name}
        target_year, target_month = row_year_month(target)
        if int(target_year) != int(active_year):
            return {'code': 0, 'total': 0, 'created': 0, 'updated': 0, 'failed': 0, 'skipped_historical': 1, 'active_year': active_year, 'url': spreadsheet_url, 'target': target_name}
        target_title = sheet_title(target_year, target_month)
        grouped = {target_title: grouped.get(target_title, [])}
    titles = list(grouped.keys())
    sheet_map = ensure_spreadsheet_sheets(token, titles, spreadsheet_token)
    archive_result = hide_historical_spreadsheet_sheets(token, sheet_map, spreadsheet_token)
    stats = {
        'code': 0,
        'total': 0,
        'created': 0,
        'updated': 0,
        'failed': 0,
        'sheets': len(titles),
        'active_year': active_year,
        'skipped_historical': skipped_historical,
        'hidden_historical_sheets': archive_result.get('hidden', 0),
        'url': spreadsheet_url,
        'target': target_name,
        'errors': [],
        'style_errors': [],
        'archive_errors': archive_result.get('errors', []),
    }
    for title in titles:
        rows = grouped.get(title, [])
        summary_rows = build_month_summary_rows(rows)
        detail_count = len(rows)
        summary_count = len(summary_rows)
        values = [SPREADSHEET_HEADERS]
        for index in range(max(detail_count, summary_count)):
            values.append(spreadsheet_row(
                rows[index] if index < detail_count else None,
                summary_rows[index] if index < summary_count else None
            ))
        try:
            write_sheet_values(token, sheet_map[title], values, spreadsheet_token)
            style_result = apply_spreadsheet_style_with_retry(token, sheet_map[title], len(values), spreadsheet_token)
            for err in style_result.get('errors', []):
                if len(stats['style_errors']) < 10:
                    stats['style_errors'].append({'sheet': title, **err})
            mark_rows_sheet_synced(rows, 'synced', '')
            stats['total'] += len(rows)
            stats['updated'] += len(rows)
        except Exception as e:
            message = str(e)
            mark_rows_sheet_synced(rows, 'failed', message)
            stats['failed'] += len(rows)
            if len(stats['errors']) < 5:
                stats['errors'].append({'sheet': title, 'error': message})
    return stats

def merge_profit_spreadsheet_stats(results, active_year):
    merged = {
        'code': 0,
        'total': 0,
        'created': 0,
        'updated': 0,
        'failed': 0,
        'sheets': 0,
        'active_year': active_year,
        'skipped_historical': 0,
        'hidden_historical_sheets': 0,
        'url': PROFIT_SPREADSHEET_URL,
        'urls': {
            'one_price': PROFIT_SPREADSHEET_URL,
            'non_one_price': NON_ONE_PRICE_SPREADSHEET_URL,
        },
        'targets': [],
        'errors': [],
        'style_errors': [],
        'archive_errors': [],
    }
    for result in results:
        if result.get('code'):
            merged['code'] = result.get('code')
        for key in ['total', 'created', 'updated', 'failed', 'sheets', 'skipped_historical', 'hidden_historical_sheets']:
            merged[key] += int(result.get(key) or 0)
        merged['targets'].append({
            'name': result.get('target') or '',
            'total': int(result.get('total') or 0),
            'failed': int(result.get('failed') or 0),
            'url': result.get('url') or '',
        })
        for key in ['errors', 'style_errors', 'archive_errors']:
            merged[key].extend(result.get(key) or [])
    merged['errors'] = merged['errors'][:10]
    merged['style_errors'] = merged['style_errors'][:10]
    merged['archive_errors'] = merged['archive_errors'][:10]
    return merged

def sync_profit_spreadsheet(limit=0, only_row_id=None):
    token = get_token()
    if not token:
        return {'code': 1, 'msg': '获取飞书 token 失败，请检查 appId/appSecret 和应用权限'}
    active_year = active_profit_year()
    source_rows = list_profit_rows(limit)
    if only_row_id:
        target = next((row for row in source_rows if int(row.get('id') or 0) == int(only_row_id)), None)
        if not target:
            return {'code': 2, 'msg': '本地流水记录不存在'}
        source_rows = [target]

    one_price_rows, non_one_price_rows = split_profit_rows_by_price_mode(source_rows)
    results = []
    if one_price_rows or not only_row_id:
        results.append(sync_profit_spreadsheet_target(
            token,
            one_price_rows,
            PROFIT_SPREADSHEET_TOKEN,
            PROFIT_SPREADSHEET_URL,
            '一口价',
            active_year,
            only_row_id
        ))
    if non_one_price_rows or not only_row_id:
        results.append(sync_profit_spreadsheet_target(
            token,
            non_one_price_rows,
            NON_ONE_PRICE_SPREADSHEET_TOKEN,
            NON_ONE_PRICE_SPREADSHEET_URL,
            '非一口价',
            active_year,
            only_row_id
        ))
    return merge_profit_spreadsheet_stats(results, active_year)

def read_profit_spreadsheet(year=0, month=0):
    token = get_token()
    if not token:
        return {'code': 1, 'msg': '获取飞书 token 失败，请检查 appId/appSecret 和应用权限'}
    active_year = active_profit_year()
    if year and int(year) != int(active_year):
        return {
            'code': 0,
            'records': [],
            'total': 0,
            'sheets': [],
            'errors': [],
            'active_year': active_year,
            'msg': f'当前执行表只读取 {active_year} 年数据，{year} 年请走历史归档表',
            'url': PROFIT_SPREADSHEET_URL
        }
    sheet_map = spreadsheet_sheet_map(token)
    titles = []
    if year and month:
        title = sheet_title(int(year), int(month))
        if title in sheet_map:
            titles = [title]
    elif month:
        title = sheet_title(active_year, int(month))
        if title in sheet_map:
            titles = [title]
    else:
        active_titles = [sheet_title(y, m) for y, m in active_sheet_months()]
        titles = [title for title in active_titles if title in sheet_map]
    records = []
    errors = []
    for title in titles:
        try:
            values = read_sheet_values(token, sheet_map[title])
            records.extend(spreadsheet_rows_to_records(values, title))
        except Exception as e:
            if len(errors) < 5:
                errors.append({'sheet': title, 'error': str(e)})
    return {
        'code': 0 if not errors else 2,
        'records': records,
        'total': len(records),
        'sheets': titles,
        'errors': errors,
        'active_year': active_year,
        'url': PROFIT_SPREADSHEET_URL
    }

def parse_text_with_ai(text, sf_key):
    """用AI把文本解析成结构化记录"""
    import urllib.request
    prompt = """你是一个财务记录解析助手。请从文本中提取毛利记录，输出纯JSON数组，不要任何其他文字。

支持的账号：天机妹、花蛮楼、麦小雯、夏天丶Cat、夏天Cat、有事找学姐、小张同学、呼叫网管、王者代做、代做

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
        row_id = p.get('id')
        return sync_profit_spreadsheet(0, row_id)

    elif action == 'sync_all_profit':
        return sync_profit_spreadsheet(int(p.get('limit') or 0))

    elif action == 'read_profit_spreadsheet':
        return read_profit_spreadsheet(int(p.get('year') or 0), int(p.get('month') or 0))

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
