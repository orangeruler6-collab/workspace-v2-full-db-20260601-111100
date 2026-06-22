# -*- coding: utf-8 -*-
"""
4月内容预估提报 Excel 导入脚本

【字段映射】
- 项目: 投放产品（为空时用产品类型）
- 平台: 抖音/B站/快手
- 项目类型: 游戏/非游
- 账号: 账号
- 档期: 4月
- 流水: 税后执行金额
- 毛利: 部门毛利

【账号别名】
薛定谔的机- → 薛定谔的机
最翁Damnnn → 最翁Damnnn
小张同学ztx → 小张同学
王路飞CP → 王路飞CP（保留原名）
"""

import sys
import os
import json
import sqlite3
from datetime import datetime

# ===== 配置 =====
# Excel 文件路径
EXCEL_FILE = r'F:\WXWork\1688851319137765\Cache\File\2026-04\4月内容预估提报.xlsx'
# 数据库路径
DB_PATH = 'D:/workspace-v2/data/profit.db'
# 目标月份
TARGET_MONTH = '4月'

# ===== 账号别名映射 =====
ACCOUNT_ALIAS = {
    '薛定谔的机-': '薛定谔的机',
    '最翁Damnnn': '最翁Damnnn',
    '小张同学ztx': '小张同学',
    '王路飞CP': '王路飞CP',
}

# ===== 辅助函数 =====

def to_int(val):
    """安全转换为整数"""
    try:
        return int(round(float(val)))
    except:
        return 0

def is_april_settlement(sched, pub, product):
    """
    判断记录是否应归属4月结算

    判定规则：
    1. 实际发布日期在4月 → 归属4月
    2. 锁定档期是4月的datetime → 归属4月
    3. 锁定档期是包含"4月"的字符串 → 归属4月
    4. 一口价 + 锁定档期在3月29/30/31日 → 归属4月（倒数第3天规则）
    5. 非一口价 + 锁定档期字符串含"3月"但不含"29/30/31" → 不归属4月（已过结算期）
    6. 无日期但产品类型为流量激励等非一口价 → 归属4月（报表本身是4月的）
    7. 无日期且产品为一口气 → 待定（需人工确认）
    """
    # 实际发布日期在4月
    if isinstance(pub, datetime) and pub.year == 2026 and pub.month == 4:
        return True

    # 锁定档期是4月的datetime
    if isinstance(sched, datetime) and sched.year == 2026 and sched.month == 4:
        return True

    # 锁定档期是包含"4月"的字符串
    if isinstance(sched, str) and '4月' in sched:
        return True

    # 一口价：锁定档期在3月29-31日 → 4月结算（倒数第3天）
    if isinstance(sched, datetime) and sched.year == 2026 and sched.month == 3 and sched.day >= 29:
        return True

    # 一口价：锁定档期字符串包含3月下旬 (3月23日至3月27日)
    if isinstance(sched, str) and '3月' in sched and ('29' in sched or '30' in sched or '31' in sched):
        return True

    # 无日期记录：产品类型非一口价 → 归属4月（4月报表中的数据）
    if sched is None and pub is None and product and product != '一口价':
        return True

    # 无日期且为一口气 → 默认归属4月（报表是4月的）
    if sched is None and pub is None:
        return True

    return False

# ===== 组名白名单（用于校验账号=组名的错误）=====
VALID_GROUPS = {'内容一组', '内容二组', '内容三组', '内容四组', '内容五组', '内容六组'}

# ===== AI 分析 =====

def analyze_excel_with_ai(rows):
    """
    调用 GPT-5.5 分析 Excel 表格结构
    返回 AI 分析结果，包含列映射和异常检测
    """
    import urllib.request
    import urllib.error

    # 准备数据样本（最多10行数据）
    headers = rows[0] if rows else []
    sample_rows = rows[1:11]  # 前10行数据
    sample_data = []
    for i, row in enumerate(sample_rows, start=2):
        # 转为字符串，每列最多20字符
        row_str = [str(v)[:20] if v is not None else '' for v in row]
        sample_data.append(f"行{i}: {row_str}")

    prompt = f"""【任务】分析以下Excel表格数据，返回结构化JSON分析结果。

【表头】（索引0-20对应各列）
{headers}

【数据样本】（前10行）
{sample_data}

【列对应参考】
索引0: 太闽锁档日期, 1: 锁定档期, 2: 实际发布日期, 3: 原ID, 4: 产品类型(一口气/流量激励/星广联投非保底/短视频生态/直播一口气/内部代做/素材代运营), 5: 游戏/非游, 6: 单号, 7: 平台(抖音/B站/快手), 8: 部门(内容一组~内容六组), 9: 账号, 10: 投放产品/项目名, 11: 链接, 12: 下单金额, 13: 返点金额, 14: 最终合作价格, 15: 说明, 16: CRM单号, 17: 部门(重复), 18: 是否执行, 19: 税后执行金额, 20: 部门毛利

【业务规则】
1. 一口价业务：结算截止为每月倒数第3天（3月锁档29-31日→4月结算）
2. 其他项目（流量激励、CPM、星广联投非保底等）：全月结算
3. 账号字段不能等于组名（如"内容四组"），否则为异常数据
4. 项目名为空的非流量激励项目需标记
5. 金额为0或负数的记录需复核

请输出JSON格式分析结果（不要输出其他内容）：
{{
  "column_map": {{
    "group": "部门所在列索引，没有则null",
    "account": "账号所在列索引，没有则null",
    "project": "投放产品/项目名所在列索引，没有则null",
    "platform": "平台所在列索引，没有则null",
    "revenue": "税后执行金额所在列索引，没有则null",
    "margin": "部门毛利所在列索引，没有则null",
    "schedule": "锁定档期所在列索引，没有则null",
    "pub_date": "实际发布日期所在列索引，没有则null",
    "product_type": "产品类型所在列索引，没有则null"
  }},
  "anomalies": [
    {{
      "row": 行号(从2开始),
      "col": "异常列名或索引",
      "issue": "问题描述",
      "severity": "high/medium/low"
    }}
  ],
  "data_quality": {{
    "total_rows": 数字,
    "valid_rows": 数字,
    "empty_project_count": 数字,
    "zero_amount_count": 数字,
    "account_equals_group_count": 数字,
    "score": "数据质量评分0-100"
  }},
  "summary": "整体描述和建议（50字以内）"
}}"""

    # 构建消息
    messages = [
        {"role": "system", "content": "你是财务数据分析助手，擅长分析Excel表格结构并检测数据异常。严格按要求输出JSON，不要输出其他内容。"},
        {"role": "user", "content": prompt}
    ]

    payload = json.dumps({
        "model": "gpt-5.5",
        "messages": messages,
        "max_tokens": 3000,
        "temperature": 0.3
    }).encode('utf-8')

    req = urllib.request.Request(
        f"https://{AI_API_HOST}/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AI_API_KEY}",
        },
        method="POST"
    )

    # 使用代理
    proxy_handler = urllib.request.ProxyHandler({'https': AI_PROXY})
    opener = urllib.request.build_opener(proxy_handler)

    try:
        with opener.open(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            reply = data.get('choices', [{}])[0].get('message', {}).get('content', '')
            # 提取JSON
            import re
            match = re.search(r'\{[\s\S]*\}', reply)
            if match:
                return json.loads(match.group())
            else:
                return {"error": "无法解析AI返回", "raw": reply[:500]}
    except Exception as e:
        return {"error": str(e)}


# ===== 主逻辑 =====

def main():
    try:
        import openpyxl
    except ImportError:
        print(json.dumps({'error': '需要 openpyxl: pip install openpyxl'}))
        sys.exit(1)

    # 读取Excel
    if not os.path.exists(EXCEL_FILE):
        print(json.dumps({'error': f'文件不存在: {EXCEL_FILE}'}))
        sys.exit(1)

    wb = openpyxl.load_workbook(EXCEL_FILE, data_only=True)
    ws = wb.active

    print("=" * 50)
    print("📊 4月流水数据导入工具")
    print("=" * 50)

    # 连接数据库
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    # 清空4月数据（重新导入）
    cur.execute("DELETE FROM profits WHERE month=?", (TARGET_MONTH,))
    print(f"\n🗑️ 已清空 {TARGET_MONTH} 旧数据")

    # 遍历数据行
    records = []
    skipped = 0

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        # 提取字段
        # 列索引: 0=太闽锁档日期, 1=锁定档期, 2=实际发布日期, 3=原ID,
        # 4=产品类型, 5=游戏/非游, 6=单号, 7=平台, 8=部门, 9=账号,
        # 10=投放产品, 11=链接, 12=下单金额, 13=返点金额, 14=最终合作价格,
        # 15=说明, 16=CRM单号, 17=部门.1, 18=是否执行, 19=税后执行金额, 20=部门毛利

        product_type = row[4]    # 产品类型（一口价/流量激励/短视频生态等）
        category = row[4]        # 项目类型（用产品类型）
        platform = row[7]        # 平台
        group = row[8]          # 部门
        account = row[9]         # 账号
        project = row[10]        # 投放产品
        revenue = row[19]        # 税后执行金额
        margin = row[20]         # 部门毛利

        # 跳过无账号行
        if not account:
            skipped += 1
            continue

        # 跳过账号=组名的异常数据
        if account and account.strip() in VALID_GROUPS:
            skipped += 1
            continue

        # 映射账号别名
        account_str = str(account).strip()
        account_str = ACCOUNT_ALIAS.get(account_str, account_str)

        # 确定项目名（优先用投放产品，为空用产品类型）
        if project and str(project).strip():
            final_project = str(project).strip()
        elif product_type and str(product_type).strip():
            final_project = str(product_type).strip()
        else:
            final_project = '未知'

        # 清理数据
        platform_str = str(platform).strip() if platform else ''
        category_str = str(category).strip() if category else ''
        group_str = str(group).strip() if group else ''

        # 修正组名错字
        if group_str == '内用二组':
            group_str = '内容二组'

        # 金额处理（保留小数）
        try:
            revenue_float = round(float(revenue), 2) if revenue else 0
            margin_float = round(float(margin), 2) if margin else 0
        except:
            revenue_float = 0
            margin_float = 0

        records.append({
            'grp': group_str,
            'project': final_project,
            'platform': platform_str,
            'category': category_str,
            'account': account_str,
            'revenue': revenue_float,
            'margin': margin_float,
            'month': TARGET_MONTH,
            'created_at': int(datetime.now().timestamp()),
        })

    # 批量插入
    cur.executemany("""
        INSERT INTO profits (grp, project, platform, category, account, revenue, margin, month, created_at)
        VALUES (:grp, :project, :platform, :category, :account, :revenue, :margin, :month, :created_at)
    """, records)

    conn.commit()

    # 汇总结果
    total = cur.execute('SELECT COUNT(*), SUM(revenue), SUM(margin) FROM profits WHERE month=?', (TARGET_MONTH,)).fetchone()
    by_group = cur.execute('SELECT grp, COUNT(*), SUM(revenue), SUM(margin) FROM profits WHERE month=? GROUP BY grp ORDER BY grp', (TARGET_MONTH,)).fetchall()

    conn.close()

    print(f"\n✅ 成功导入 {len(records)} 条数据")
    print(f"⏭️  跳过 {skipped} 条（无账号或账号=组名）")
    print(f"\n📈 总计:")
    print(f"   流水: ¥{total[1]:,.2f}")
    print(f"   毛利: ¥{total[2]:,.2f}")

    print(f"\n按组汇总:")
    for g in by_group:
        print(f"   {g[0]}: {g[1]}条, 毛利 ¥{g[3]:,.2f}")

if __name__ == '__main__':
    main()
