# -*- coding: utf-8 -*-
import csv
import json
import os
import re
import subprocess
import sys
import time
try:
    import winreg
except Exception:
    winreg = None

DEFAULT_WECOM_PROFIT_SHEET_URL = 'https://doc.weixin.qq.com/sheet/e3_AZAA8QaHAAg6TaNa0YvQVyENOHn13?scode=ABQA4wclAAskZYzJMdAXEAIQYbADc&tab=o6yo32'
DEFAULT_WECOM_NON_ONE_PRICE_PROFIT_SHEET_URL = 'https://doc.weixin.qq.com/sheet/e3_APEApAb0AFYCNC11mIQroQaiXr8ow?scode=ABQA4wclAAsEoD3cCjAXEAIQYbADc&tab=BB08J2'

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_WECOM_PRO_EXE = os.path.join(ROOT_DIR, 'node_modules', '@liangdi', 'wecom-pro-win32-x64', 'bin', 'wecom-pro.exe')
DEFAULT_WECOM_PRO_BIN = os.path.join(ROOT_DIR, 'node_modules', '.bin', 'wecom-pro.cmd')


def money(value):
    text = str(value or '').strip()
    if not text:
        return 0
    text = text.replace(',', '').replace('，', '').replace('￥', '').replace('¥', '').replace('元', '')
    match = re.search(r'-?\d+(?:\.\d+)?', text)
    if not match:
        return 0
    return int(round(float(match.group(0))))


def normalize_header(value):
    return re.sub(r'\s+', '', str(value or '').strip()).lower()


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


def duplicate_header_indexes(headers, alias):
    key = normalize_header(alias)
    return [
        idx for idx, text in enumerate([normalize_header(item) for item in headers])
        if text == key
    ]


def row_cell(row, index):
    if index < 0 or index >= len(row):
        return ''
    value = row[index]
    if value is None:
        return ''
    return str(value).strip()


def sheet_title(year, month):
    return f'{int(year) % 100}.{int(month)}月'


def canonical_month_label(year, month):
    return f'{int(year or active_profit_year())}年{int(month)}月'


def active_profit_year():
    return int(os.environ.get('PROFIT_ACTIVE_YEAR') or os.environ.get('ACTIVE_PROFIT_YEAR') or 2026)


def selected_sheet_label(year, month):
    if year and month:
        return sheet_title(year, month)
    if month:
        return sheet_title(active_profit_year(), month)
    return ''


def month_label_candidates(year, month):
    if not month:
        return []
    active_year = int(year or active_profit_year())
    month_num = int(month)
    return [
        f'{active_year % 100}.{month_num}月',
        f'{active_year % 100}.{month_num:02d}月',
        f'{active_year}年{month_num}月',
        f'{active_year}-{month_num:02d}',
        f'{month_num}月',
        f'{month_num:02d}月',
    ]


def is_target_sheet_line(line, year, month):
    if not month:
        return False
    text = re.sub(r'\s+', '', str(line or '')).lower()
    candidates = [re.sub(r'\s+', '', item).lower() for item in month_label_candidates(year, month)]
    return any(candidate and candidate in text for candidate in candidates)


def is_sheet_title_line(line):
    text = re.sub(r'\s+', '', str(line or '')).lower()
    return bool(
        re.fullmatch(r'\d{2}\.\d{1,2}月', text) or
        re.fullmatch(r'20\d{2}年\d{1,2}月', text) or
        re.fullmatch(r'20\d{2}-\d{1,2}', text)
    )


def is_target_sheet_title_line(line, year, month):
    if not month:
        return False
    text = re.sub(r'\s+', '', str(line or '')).lower()
    candidates = [re.sub(r'\s+', '', item).lower() for item in month_label_candidates(year, month)]
    return is_sheet_title_line(line) and any(candidate == text for candidate in candidates)


def parse_wecom_output(stdout):
    text = str(stdout or '').strip()
    if not text:
        return None
    try:
        outer = json.loads(text)
    except Exception:
        return text
    content = outer.get('content') if isinstance(outer, dict) else None
    if isinstance(content, list):
        for item in content:
            if isinstance(item, dict) and str(item.get('text') or '').strip():
                inner_text = str(item.get('text') or '').strip()
                try:
                    return json.loads(inner_text)
                except Exception:
                    return inner_text
    return outer


def wecom_env():
    env = os.environ.copy()
    appdata = env.get('APPDATA') or os.path.join(os.path.expanduser('~'), 'AppData', 'Roaming')
    existing_config_dir = os.path.join(appdata, 'account-style-library', 'wecom')
    fallback_config_dir = os.path.join(appdata, 'workspace-v2', 'wecom-profit')
    env['WECOM_CLI_CONFIG_DIR'] = env.get('WECOM_CLI_CONFIG_DIR') or (
        existing_config_dir if os.path.exists(os.path.join(existing_config_dir, 'bots', 'default.enc')) else fallback_config_dir
    )
    access_id = env.get('WECOM_PROFIT_SHEET_ACCESS_ID') or env.get('WECOM_ACCESS_ID')
    access_secret = env.get('WECOM_PROFIT_SHEET_ACCESS_SECRET') or env.get('WECOM_ACCESS_SECRET')
    if access_id:
        env.setdefault('WECOM_ACCESS_ID', access_id)
        env.setdefault('WECOM_APP_ID', access_id)
    if access_secret:
        env.setdefault('WECOM_ACCESS_SECRET', access_secret)
        env.setdefault('WECOM_APP_SECRET', access_secret)
    proxy = env.get('WECOM_PROXY_URL') or env.get('HTTPS_PROXY') or env.get('HTTP_PROXY') or windows_system_proxy_url()
    if proxy:
        env.setdefault('HTTPS_PROXY', proxy)
        env.setdefault('HTTP_PROXY', proxy)
        env.setdefault('https_proxy', proxy)
        env.setdefault('http_proxy', proxy)
    return env


def windows_system_proxy_url():
    if os.name != 'nt' or winreg is None:
        return ''
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
            enabled, _ = winreg.QueryValueEx(key, 'ProxyEnable')
            if not enabled:
                return ''
            value, _ = winreg.QueryValueEx(key, 'ProxyServer')
        text = str(value or '').strip()
        if '=' in text:
            for part in text.split(';'):
                name, _, val = part.partition('=')
                if name.strip().lower() in ('http', 'https') and val.strip():
                    text = val.strip()
                    break
        if text and not re.match(r'^https?://', text, re.I):
            text = 'http://' + text
        return text
    except Exception:
        return ''


def wecom_bin():
    configured = os.environ.get('WECOM_PRO_BIN') or os.environ.get('WECOM_CLI_BIN')
    if configured:
        return configured
    if os.path.exists(DEFAULT_WECOM_PRO_EXE):
        return DEFAULT_WECOM_PRO_EXE
    if os.path.exists(DEFAULT_WECOM_PRO_BIN):
        return DEFAULT_WECOM_PRO_BIN
    return 'wecom-pro.cmd' if os.name == 'nt' else 'wecom-pro'


def run_wecom_doc_content(url, task_id=''):
    args = ['doc', 'get_doc_content', json.dumps({'url': url, 'type': 2, **({'task_id': task_id} if task_id else {})}, ensure_ascii=False)]
    completed = subprocess.run(
        [wecom_bin()] + args,
        capture_output=True,
        text=True,
        encoding='utf-8',
        errors='replace',
        env=wecom_env(),
        timeout=180,
        shell=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or 'wecom-pro failed').strip()[:500])
    return parse_wecom_output(completed.stdout)


def ensure_wecom_config():
    access_id = os.environ.get('WECOM_PROFIT_SHEET_ACCESS_ID') or os.environ.get('WECOM_ACCESS_ID')
    access_secret = os.environ.get('WECOM_PROFIT_SHEET_ACCESS_SECRET') or os.environ.get('WECOM_ACCESS_SECRET')
    if not access_id or not access_secret:
        return
    config_dir = wecom_env().get('WECOM_CLI_CONFIG_DIR') or ''
    marker = os.path.join(config_dir, '.profit_init_attempted')
    if marker and os.path.exists(marker):
        return
    completed = None
    try:
        completed = subprocess.run(
            [wecom_bin(), 'init', '--bot', 'default', '--method', 'manual', '--bot-id', access_id, '--secret', access_secret, '--output', 'json'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='replace',
            env=wecom_env(),
            timeout=60,
            shell=False,
        )
    finally:
        if config_dir and completed is not None and completed.returncode == 0:
            os.makedirs(config_dir, exist_ok=True)
            with open(marker, 'w', encoding='utf-8') as f:
                f.write(str(int(time.time())))


def read_wecom_document(url):
    parsed = run_wecom_doc_content(url)
    task_id = ''
    if isinstance(parsed, dict):
        task_id = str(parsed.get('task_id') or '').strip()
    if task_id and isinstance(parsed, dict) and parsed.get('task_done') is False:
        last = parsed
        # Large sheets are handled asynchronously by wecom-pro and regularly need
        # longer than the former 38-second polling window.
        max_attempts = max(20, min(90, int(os.environ.get('WECOM_DOC_TASK_POLL_ATTEMPTS') or 90)))
        for attempt in range(max_attempts):
            time.sleep(1 if attempt < 2 else 2)
            last = run_wecom_doc_content(url, task_id)
            if not (isinstance(last, dict) and last.get('task_done') is False):
                parsed = last
                break
        else:
            raise RuntimeError('企业微信表读取任务超时，请稍后重试')
    if isinstance(parsed, dict):
        errcode = parsed.get('errcode')
        if isinstance(errcode, int) and errcode != 0:
            raise RuntimeError(str(parsed.get('errmsg') or f'企业微信接口返回错误：{errcode}'))
        content = str(parsed.get('content') or '').strip()
        if content:
            return content
        data = parsed.get('data')
        if isinstance(data, dict):
            content = str(data.get('content') or data.get('text') or '').strip()
            if content:
                return content
    if isinstance(parsed, str) and parsed.strip():
        return parsed.strip()
    raise RuntimeError('企业微信表读取为空，请确认访问码和表格权限')


def split_text_rows(text):
    lines = [line.rstrip('\r') for line in str(text or '').splitlines() if line.strip()]
    if not lines:
        return []
    delimiter = '\t' if any('\t' in line for line in lines[:10]) else ','
    rows = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('|') and stripped.endswith('|') and stripped.count('|') >= 2:
            parsed = stripped.strip('|').split('|')
        elif delimiter == ',':
            parsed = next(csv.reader([line]))
        else:
            parsed = line.split('\t')
        rows.append([str(cell or '').strip() for cell in parsed])
    return rows


def is_markdown_separator_row(row):
    cells = [str(cell or '').strip() for cell in (row or [])]
    meaningful = [cell for cell in cells if cell]
    if not meaningful:
        return True
    return all(re.fullmatch(r':?-{3,}:?', cell) for cell in meaningful)


def clean_link_value(value):
    text = str(value or '').strip()
    if not text:
        return ''
    if re.search(r'https?://|www\.|v\.douyin\.com|bilibili\.com', text, re.I):
        return text
    return ''


def status_from_text(value):
    text = str(value or '').strip()
    if not text:
        return ''
    if any(item in text for item in ['撤单', '撤销', '取消']):
        return '撤单'
    if any(item in text for item in ['未发', '待发', '待发布']):
        return '未发布'
    if any(item in text for item in ['延期', '延后']):
        return '延期'
    if any(item in text for item in ['已完成', '完成', '结案', '执行完成', '已发布']):
        return '已发布'
    return ''


def find_header_row(rows):
    best = None
    best_score = 0
    for idx, row in enumerate(rows[:80]):
        score = 0
        joined = ''.join(row)
        for key in ['账号', '项目', '投放产品', '平台', '最终合作', '下单金额', '链接', '执行状态']:
            if key in joined:
                score += 1
        if score > best_score:
            best = idx
            best_score = score
    if best is None or best_score < 2:
        return None
    return best


def row_to_record(row, idx, fallback_sheet):
    def cell(name):
        return row_cell(row, idx.get(name, -1))

    project = cell('project')
    account = cell('account')
    group = cell('group')
    platform = cell('platform')
    amount = money(cell('final_amount') or cell('order_amount') or cell('revenue'))
    if not (project or account or group or platform):
        return None

    publish_date = cell('publish_date')
    raw_link = cell('link')
    link = clean_link_value(raw_link)
    status = status_from_text(cell('execution_status')) or status_from_text(raw_link)
    if status in ('已完成', '完成', '结案', '执行完成'):
        status = '已发布'
    if not status:
        status = '已发布' if publish_date or link else '未发布'

    return {
        'grp': group,
        'account': account,
        'project': project,
        'platform': platform,
        'fee': amount,
        'revenue': amount,
        'margin': money(cell('projected_margin')),
        'schedule': cell('schedule') or fallback_sheet,
        'month': fallback_sheet,
        'note': cell('remark'),
        'category': cell('category') or '一口价',
        'business_type': cell('business_type') or cell('category') or '一口价',
        'entry_source': 'wecom',
        'order_amount': money(cell('order_amount')),
        'rebate_amount': money(cell('rebate_amount')),
        'final_amount': money(cell('final_amount')) or amount,
        'cost_total': money(cell('cost_total')),
        'projected_margin': money(cell('projected_margin')),
        'lock_date': cell('lock_date'),
        'publish_date': publish_date,
        'execution_status': status,
        'is_published': 1 if status == '已发布' else 0,
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


def rows_to_records(rows, sheet_label):
    header_idx = find_header_row(rows)
    if header_idx is None:
        return []
    headers = rows[header_idx]
    idx = {
        'lock_date': header_index(headers, ['太闽锁档日期', '锁档日期']),
        'schedule': header_index(headers, ['锁定档期', '档期', '月份']),
        'publish_date': header_index(headers, ['实际发布日期', '发布日期']),
        'execution_status': header_index(headers, ['执行状态', '项目状态', '状态', '发布状态']),
        'original_id': header_index(headers, ['原ID', '原id']),
        'category': header_index(headers, ['产品', '产品类型', '业务口径', '类型']),
        'product_line': header_index(headers, ['游戏/非游', '产品线']),
        'order_no': header_index(headers, ['单号']),
        'platform': header_index(headers, ['平台']),
        'group': header_index(headers, ['部门', '组别', '归属组', '小组']),
        'account': header_index(headers, ['账号', '账号名']),
        'project': header_index(headers, ['投放产品', '项目', '产品/项目', '项目名称']),
        'link': header_index(headers, ['链接', '发布链接']),
        'order_amount': header_index(headers, ['下单金额']),
        'rebate_amount': header_index(headers, ['返点金额']),
        'final_amount': header_index(headers, ['最终合作价格', '最终合作价', '实际金额', '流水', '费用']),
        'revenue': header_index(headers, ['流水', '费用']),
        'cost_total': header_index(headers, ['成本合计']),
        'projected_margin': header_index(headers, ['毛利预估', '预估毛利', '毛利']),
        'remark': header_index(headers, ['说明', '备注']),
        'crm_order_no': header_index(headers, ['CRM单号', 'crm单号']),
        'business_type': header_index(headers, ['业务口径', '类型']),
        'origin_group': header_index(headers, ['原组']),
        'producer_group': header_index(headers, ['代做组']),
        'origin_share': header_index(headers, ['原组比例']),
        'producer_share': header_index(headers, ['代做比例']),
    }
    duplicate_order_amount = duplicate_header_indexes(headers, '下单金额')
    if idx['link'] < 0 and len(duplicate_order_amount) >= 2:
        idx['link'] = duplicate_order_amount[0]
        idx['order_amount'] = duplicate_order_amount[1]
    records = []
    for row in rows[header_idx + 1:]:
        if is_markdown_separator_row(row):
            continue
        record = row_to_record(row, idx, sheet_label)
        if record:
            records.append(record)
    return records


def filter_month_rows(rows, year, month):
    if not month:
        return rows
    header_idx = find_header_row(rows)
    if header_idx is None:
        return rows
    start = 0
    for idx, row in enumerate(rows):
        line = ' '.join(row)
        if is_target_sheet_title_line(line, year, month):
            start = idx
            break
    if start:
        end = len(rows)
        for idx in range(start + 1, len(rows)):
            line = ' '.join(rows[idx])
            if is_sheet_title_line(line):
                end = idx
                break
        selected = rows[start:end]
        if find_header_row(selected) is None:
            selected = rows[header_idx:]
        return selected
    return []


def sheet_url_for_mode(mode):
    if mode == 'non_one_price':
        return os.environ.get('WECOM_NON_ONE_PRICE_PROFIT_SHEET_URL') or os.environ.get('WECOM_NON_ONE_PRICE_SHEET_URL') or DEFAULT_WECOM_NON_ONE_PRICE_PROFIT_SHEET_URL
    return os.environ.get('WECOM_PROFIT_SHEET_URL') or DEFAULT_WECOM_PROFIT_SHEET_URL


def business_type_for_mode(mode):
    return '非一口价' if mode == 'non_one_price' else '一口价'


def read_single_profit_spreadsheet(year=0, month=0, mode='one_price'):
    url = sheet_url_for_mode(mode)
    label = selected_sheet_label(year, month) or f'{active_profit_year()}'
    record_month_label = canonical_month_label(year or active_profit_year(), month) if month else label
    ensure_wecom_config()
    text = read_wecom_document(url)
    rows = split_text_rows(text)
    if not rows:
        return {'code': 0, 'records': [], 'total': 0, 'sheets': [], 'errors': [], 'url': url, 'mode': mode}
    rows = filter_month_rows(rows, int(year or 0), int(month or 0))
    records = rows_to_records(rows, record_month_label)
    business_type = business_type_for_mode(mode)
    for record in records:
        record['business_type'] = business_type
        record['category'] = business_type
        record['entry_source'] = 'wecom:' + mode
    return {
        'code': 0,
        'records': records,
        'total': len(records),
        'sheets': [label],
        'errors': [],
        'active_year': active_profit_year(),
        'url': url,
        'source': 'wecom',
        'mode': mode
    }


def read_profit_spreadsheet(year=0, month=0, mode='one_price'):
    mode = str(mode or 'one_price').strip()
    if mode in ('nonOnePrice', 'non-one-price', 'non_one_price', '非一口价'):
        return read_single_profit_spreadsheet(year, month, 'non_one_price')
    if mode in ('all', 'both', '全部'):
        results = [
            read_single_profit_spreadsheet(year, month, 'one_price'),
            read_single_profit_spreadsheet(year, month, 'non_one_price')
        ]
        records = []
        errors = []
        sheets = []
        urls = {}
        for result in results:
            records.extend(result.get('records') or [])
            errors.extend(result.get('errors') or [])
            sheets.extend([str(result.get('mode') or '') + ':' + str(sheet) for sheet in (result.get('sheets') or [])])
            urls[result.get('mode') or ''] = result.get('url') or ''
        return {
            'code': 0,
            'records': records,
            'total': len(records),
            'sheets': sheets,
            'errors': errors,
            'active_year': active_profit_year(),
            'url': urls.get('one_price', ''),
            'urls': urls,
            'source': 'wecom',
            'mode': 'all',
            'sources': [
                {'mode': result.get('mode'), 'total': len(result.get('records') or []), 'url': result.get('url') or ''}
                for result in results
            ]
        }
    return read_single_profit_spreadsheet(year, month, 'one_price')


def main(payload):
    action = payload.get('action')
    params = payload.get('params') or {}
    if action == 'read_profit_spreadsheet':
        return read_profit_spreadsheet(int(params.get('year') or 0), int(params.get('month') or 0), params.get('mode') or 'one_price')
    return {'code': -1, 'msg': 'unknown action'}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'code': -1, 'msg': 'Usage: wecom_profit.py <json_params_file>'}, ensure_ascii=True))
    else:
        try:
            with open(sys.argv[1], 'r', encoding='utf-8-sig') as f:
                args = json.load(f)
            print(json.dumps(main(args), ensure_ascii=True))
        except Exception as e:
            print(json.dumps({'code': -1, 'msg': str(e)}, ensure_ascii=True))
