# -*- coding: utf-8 -*-
"""利润数据库 CRUD — 支持 runPython(argv[1]=json文件) 调用方式"""
import sys, json, os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'profit.db')

EXTRA_COLUMNS = {
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
    'execution_status': 'TEXT',
    'is_published': 'INTEGER DEFAULT 0',
    'original_id': 'TEXT',
    'product_line': 'TEXT',
    'link': 'TEXT',
    'order_no': 'TEXT',
    'crm_order_no': 'TEXT',
    'feishu_record_id': 'TEXT',
    'feishu_sync_status': 'TEXT',
    'feishu_synced_at': 'INTEGER DEFAULT 0',
    'feishu_sync_error': 'TEXT',
}

TEXT_COLUMNS = {
    'category', 'business_type', 'entry_source', 'origin_group', 'producer_group',
    'lock_date', 'publish_date', 'execution_status', 'original_id', 'product_line',
    'link', 'order_no', 'crm_order_no', 'feishu_record_id', 'feishu_sync_status',
    'feishu_sync_error'
}

def text_value(data, name, default=''):
    value = data.get(name, default)
    return '' if value is None else str(value)

def int_value(data, name, default=0):
    try:
        return int(float(data.get(name, default) or 0))
    except Exception:
        return default

def extra_value(data, name):
    if name in TEXT_COLUMNS:
        if name == 'business_type':
            return text_value(data, name, data.get('category') or '')
        if name == 'category':
            return text_value(data, name, data.get('business_type') or '')
        return text_value(data, name)
    if name == 'origin_share':
        return int_value(data, name, 30)
    if name == 'producer_share':
        return int_value(data, name, 70)
    if name == 'final_amount':
        return int_value(data, name, int_value(data, 'revenue'))
    if name == 'projected_margin':
        return int_value(data, name, int_value(data, 'margin'))
    return int_value(data, name)

def get_db():
    import sqlite3
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS profits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        grp TEXT NOT NULL,
        project TEXT,
        platform TEXT,
        account TEXT,
        revenue INTEGER DEFAULT 0,
        margin INTEGER DEFAULT 0,
        month TEXT,
        remark TEXT,
        created_at INTEGER
    )''')
    existing = {row[1] for row in c.execute('PRAGMA table_info(profits)').fetchall()}
    for name, ddl in EXTRA_COLUMNS.items():
        if name not in existing:
            c.execute(f'ALTER TABLE profits ADD COLUMN {name} {ddl}')
    # 创建索引加速分组查询
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_grp ON profits(grp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_month ON profits(month)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_grp_month ON profits(grp, month)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_created ON profits(created_at)')
    conn.commit()
    conn.close()

def list_by_group(grp=None):
    init_db()
    conn = get_db()
    c = conn.cursor()
    if grp and grp != '全部':
        c.execute('SELECT * FROM profits WHERE grp=? ORDER BY id DESC', (grp,))
    else:
        c.execute('SELECT * FROM profits ORDER BY id DESC')
    rows = c.fetchall()
    conn.close()
    return {'data': [dict(r) for r in rows]}

def add(data):
    init_db()
    conn = get_db()
    c = conn.cursor()
    base_columns = ['grp', 'project', 'platform', 'account', 'revenue', 'margin', 'month', 'remark', 'created_at']
    extra_columns = list(EXTRA_COLUMNS.keys())
    columns = base_columns + extra_columns
    values = [
        data.get('grp',''),
        data.get('project',''),
        data.get('platform',''),
        data.get('account',''),
        int(data.get('revenue',0) or 0),
        int(data.get('margin',0) or 0),
        data.get('month',''),
        data.get('remark',''),
        int(datetime.now().timestamp())
    ] + [extra_value(data, name) for name in extra_columns]
    placeholders = ','.join(['?'] * len(columns))
    c.execute(f'''INSERT INTO profits ({','.join(columns)}) VALUES ({placeholders})''', values)
    new_id = c.lastrowid
    conn.commit()
    conn.close()
    return {'id': new_id}

def update(id, data):
    init_db()
    conn = get_db()
    c = conn.cursor()
    columns = ['grp', 'project', 'platform', 'account', 'revenue', 'margin', 'month', 'remark'] + list(EXTRA_COLUMNS.keys())
    values = [
        data.get('grp',''),
        data.get('project',''),
        data.get('platform',''),
        data.get('account',''),
        int(data.get('revenue',0) or 0),
        int(data.get('margin',0) or 0),
        data.get('month',''),
        data.get('remark',''),
    ] + [extra_value(data, name) for name in EXTRA_COLUMNS.keys()] + [id]
    assignments = ','.join([name + '=?' for name in columns])
    c.execute(f'''UPDATE profits SET {assignments} WHERE id=?''', values)
    conn.commit()
    conn.close()
    return {'success': True}

def delete(id):
    init_db()
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM profits WHERE id=?', (id,))
    conn.commit()
    conn.close()
    return {'success': True}

def stats(grp=None):
    init_db()
    conn = get_db()
    c = conn.cursor()
    if grp and grp != '全部':
        c.execute('SELECT SUM(revenue) as total_rev, SUM(margin) as total_margin, COUNT(*) as cnt FROM profits WHERE grp=?', (grp,))
    else:
        c.execute('SELECT SUM(revenue) as total_rev, SUM(margin) as total_margin, COUNT(*) as cnt FROM profits')
    row = c.fetchone()
    conn.close()
    return {
        'total_revenue': row['total_rev'] or 0,
        'total_margin': row['total_margin'] or 0,
        'count': row['cnt'] or 0
    }

# runPython 入口：读取 tmp json 文件，执行对应 action
if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('{}')
        sys.exit(0)
    try:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            payload = json.load(f)
        action = payload.get('action', '')
        params = payload.get('params', {})
        result = {}
        if action == 'init_db':
            init_db()
            result = {'ok': True}
        elif action == 'list_by_group':
            result = list_by_group(params.get('grp'))
        elif action == 'add':
            result = add(params)
        elif action == 'update':
            result = update(params.get('id'), params)
        elif action == 'delete':
            result = delete(params.get('id'))
        elif action == 'stats':
            result = stats(params.get('grp'))
        else:
            result = {'error': 'unknown action: ' + action}
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
