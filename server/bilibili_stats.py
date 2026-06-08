# -*- coding: utf-8 -*-
"""Bilibili video stats bridge for traffic-plan monitoring."""
import json
import sys
import urllib.request

from bilibili_cli_bridge import error_message, extract_bvid, parse_json_output, run_bili

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/133 Safari/537.36'


def to_number(*values):
    for value in values:
        if value is None:
            continue
        if isinstance(value, (int, float)):
            if value > 0:
                return int(value)
            continue
        text = str(value).strip().replace(',', '')
        if not text:
            continue
        multiplier = 1
        if text.endswith(('万', 'w', 'W')):
            multiplier = 10000
            text = text[:-1]
        try:
            number = float(text) * multiplier
            if number > 0:
                return int(round(number))
        except Exception:
            continue
    return 0


def pick_object(payload):
    if isinstance(payload, list):
        return payload[0] if payload and isinstance(payload[0], dict) else {}
    if not isinstance(payload, dict):
        return {}
    for key in ('data', 'result', 'raw', 'video', 'item', 'info'):
        value = payload.get(key)
        if isinstance(value, dict):
            nested = pick_object(value)
            return nested or value
    return payload


def stats_from_object(obj):
    stat = obj.get('stat') if isinstance(obj.get('stat'), dict) else {}
    if not stat and isinstance(obj.get('stats'), dict):
        stat = obj.get('stats')
    owner = obj.get('owner') if isinstance(obj.get('owner'), dict) else {}
    return {
        'title': str(obj.get('title') or obj.get('name') or ''),
        'bvid': str(obj.get('bvid') or obj.get('bv') or obj.get('id') or ''),
        'author': str(owner.get('name') or obj.get('author') or obj.get('up') or ''),
        'stats': {
            'play': to_number(obj.get('view'), obj.get('views'), obj.get('play'), stat.get('view'), stat.get('views')),
            'danmaku': to_number(obj.get('danmaku'), obj.get('dm'), stat.get('danmaku'), stat.get('dm')),
            'comment': to_number(obj.get('reply'), obj.get('comment'), obj.get('comments'), stat.get('reply'), stat.get('comment')),
            'like': to_number(obj.get('like'), obj.get('likes'), stat.get('like')),
            'favorite': to_number(obj.get('favorite'), obj.get('favorites'), stat.get('favorite'), stat.get('fav')),
            'coin': to_number(obj.get('coin'), obj.get('coins'), stat.get('coin')),
            'share': to_number(obj.get('share'), obj.get('shares'), stat.get('share')),
        },
        'raw': obj,
    }


def fetch_public_view(bvid):
    try:
        req = urllib.request.Request(
            'https://api.bilibili.com/x/web-interface/view?bvid=' + bvid,
            headers={'User-Agent': UA, 'Referer': 'https://www.bilibili.com/'}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.load(resp)
        data = payload.get('data') if isinstance(payload, dict) else {}
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def merge_public_stats(data, public_obj):
    if not public_obj:
        return data
    public = stats_from_object(public_obj)
    data['title'] = data.get('title') or public.get('title') or ''
    data['author'] = data.get('author') or public.get('author') or ''
    stats = data.get('stats') or {}
    public_stats = public.get('stats') or {}
    for key in ('play', 'danmaku', 'comment', 'like', 'favorite', 'coin', 'share'):
        stats[key] = max(to_number(stats.get(key)), to_number(public_stats.get(key)))
    data['stats'] = stats
    return data


def fetch_bilibili_stats(value):
    bvid = extract_bvid(value)
    if not bvid:
        return {'ok': False, 'error': '无法识别 B站 BV 号，请填写 B站视频链接或 BV 号'}
    result = run_bili(['video', bvid, '--json'], timeout=45)
    if not result.get('ok'):
        return {'ok': False, 'bvid': bvid, 'error': error_message(result)}
    payload = parse_json_output(result.get('stdout', ''))
    data = stats_from_object(pick_object(payload))
    public_obj = fetch_public_view(bvid)
    data = merge_public_stats(data, public_obj)
    data['ok'] = True
    data['bvid'] = data.get('bvid') or bvid
    data['url'] = 'https://www.bilibili.com/video/' + bvid
    data['source'] = 'bilibili-cli'
    data['source_method'] = 'B站视频链接/BV -> bili video <BV> --json；评论等缺字段时补 api.bilibili.com/x/web-interface/view；回填播放、弹幕、评论、点赞、收藏、投币、分享'
    if public_obj:
        data['public_api_fallback'] = True
    return data


def main():
    try:
        with open(sys.argv[1], 'r', encoding='utf-8') as f:
            payload = json.load(f)
        params = payload.get('params') or {}
        action = payload.get('action')
        if action == 'stats':
            print(json.dumps(fetch_bilibili_stats(params.get('url') or params.get('bvid') or ''), ensure_ascii=False))
            return
        print(json.dumps({'ok': False, 'error': 'unknown action'}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
