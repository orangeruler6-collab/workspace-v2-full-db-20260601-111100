# -*- coding: utf-8 -*-
"""利润数据库 CRUD — 支持 runPython(argv[1]=json文件) 调用方式"""
import sys, json, os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'profit.db')

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
    # 创建索引加速分组查询
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_grp ON profits(grp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_month ON profits(month)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_profits_created ON profits(created_at)')
    conn.commit()
    conn.close()

def list_by_group(grp=None):
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
    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO profits (grp,project,platform,account,revenue,margin,month,remark,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)''', (
        data.get('grp',''),
        data.get('project',''),
        data.get('platform',''),
        data.get('account',''),
        int(data.get('revenue',0) or 0),
        int(data.get('margin',0) or 0),
        data.get('month',''),
        data.get('remark',''),
        int(datetime.now().timestamp())
    ))
    new_id = c.lastrowid
    conn.commit()
    conn.close()
    return {'id': new_id}

def update(id, data):
    conn = get_db()
    c = conn.cursor()
    c.execute('''UPDATE profits SET grp=?,project=?,platform=?,account=?,revenue=?,margin=?,month=?,remark=?
        WHERE id=?''', (
        data.get('grp',''),
        data.get('project',''),
        data.get('platform',''),
        data.get('account',''),
        int(data.get('revenue',0) or 0),
        int(data.get('margin',0) or 0),
        data.get('month',''),
        data.get('remark',''),
        id
    ))
    conn.commit()
    conn.close()
    return {'success': True}

def delete(id):
    conn = get_db()
    c = conn.cursor()
    c.execute('DELETE FROM profits WHERE id=?', (id,))
    conn.commit()
    conn.close()
    return {'success': True}

def stats(grp=None):
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
