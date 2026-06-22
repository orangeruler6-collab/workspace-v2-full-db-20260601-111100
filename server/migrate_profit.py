# -*- coding: utf-8 -*-
"""迁移飞书利润数据到本地 profit.db — 全部进内容四组"""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(__file__))

from profit_db import init_db, add

# 内容四组账号
G4_ACCOUNTS = {
    '天机妹', '麦小雯', '花蛮楼', '有事找学姐', '夏天丶cat', '素材'
}

def calc_margin(revenue, platform, account):
    rev = int(float(revenue or 0))
    p = (platform or '抖音').strip()
    a = (account or '').strip()
    if 'B站' in p or 'B站' in a:
        return int(rev * 0.6)
    elif '代做' in p or '代做' in a:
        return rev
    else:
        return int(rev * 0.5)

def fetch_via_api():
    import urllib.request
    url = 'http://localhost:5555/api/feishu/profit'
    req = urllib.request.Request(url, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode('utf-8')
    data = json.loads(raw)
    return data.get('items', [])

def migrate():
    init_db()
    items = fetch_via_api()
    print(f'从 API 读取到 {len(items)} 条记录')

    count = 0
    for it in items:
        # 通过索引取值，避免字段名乱码问题
        # 顺序: id, 月份, 项目, 平台, 账号, 费用, 档期, 备注
        vals = list(it.values())
        if len(vals) < 6:
            continue
        account = (vals[4] or '').strip()
        if not account or account == '外部账号':
            continue
        revenue = int(float(vals[5] or 0))
        platform = (vals[3] or '抖音').strip()
        month = (vals[1] or '4月').strip()
        project = (vals[2] or '').strip()
        remark = (vals[7] or '').strip() if len(vals) > 7 else ''

        margin = calc_margin(revenue, platform, account)

        record = {
            'grp': '内容四组',         # 全部进四组
            'project': project,
            'platform': platform,
            'account': account,
            'revenue': revenue,
            'margin': margin,
            'month': month,
            'remark': remark,
        }
        add(record)
        count += 1
        print(f'  [{count}] 四组 | {account} | 流水{revenue} | 毛利{margin} | {project}')

    print(f'迁移完成，共 {count} 条进入内容四组')

if __name__ == '__main__':
    migrate()
