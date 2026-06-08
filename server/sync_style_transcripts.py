# -*- coding: utf-8 -*-
import json
import os
import sys

from vector_store import add_item, delete_item, write_json


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
STYLE_ROOT = os.path.abspath(os.environ.get('STYLE_LIBRARY_DIR') or os.path.join(ROOT, 'data', 'style-library'))


def read_json(path):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return json.load(f)
    except Exception:
        return None


def read_text(path):
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            return f.read().strip()
    except Exception:
        return ''


def load_payload(path):
    with open(path, 'r', encoding='utf-8-sig') as f:
        return json.load(f)


def vector_id(platform, account_slug, video_id):
    return 'style:{}:{}:{}'.format(platform, account_slug, video_id)


def video_link(platform, video):
    raw = video.get('raw') if isinstance(video.get('raw'), dict) else {}
    for key in ('url', 'share_url', 'original_url', 'page_url'):
        value = video.get(key) or raw.get(key)
        if value:
            return str(value)
    if platform == 'bilibili' and str(video.get('id') or '').startswith('BV'):
        return 'https://www.bilibili.com/video/' + str(video.get('id'))
    aweme = raw.get('aweme_id') or video.get('id')
    if platform == 'douyin' and aweme:
        return 'https://www.douyin.com/video/' + str(aweme)
    return ''


def build_text(platform, account, video, transcript):
    parts = [
        '账号：' + str(account.get('name') or account.get('slug') or ''),
        '平台：' + platform,
        '标题：' + str(video.get('title') or ''),
        '发布时间：' + str(video.get('publishedAt') or ''),
        '热度：' + str(video.get('hotScore') or ''),
        '',
        '转写原文：',
        transcript,
    ]
    return '\n'.join([part for part in parts if part is not None]).strip()


def sync_one(params):
    platform = str(params.get('platform') or '').strip()
    account_slug = str(params.get('accountSlug') or params.get('account_id') or params.get('accountId') or '').strip()
    video_id = str(params.get('videoId') or params.get('video_id') or '').strip()
    transcript = str(params.get('transcript') or params.get('text') or '').strip()
    collection = str(params.get('collection') or 'wenan').strip() or 'wenan'

    if not platform or not account_slug or not video_id:
        return {'success': False, 'error': 'platform/accountSlug/videoId required'}

    account_dir = os.path.join(STYLE_ROOT, platform, account_slug)
    account = read_json(os.path.join(account_dir, 'account.json')) or {}
    video = read_json(os.path.join(account_dir, 'videos', video_id + '.json')) or {'id': video_id}
    if not transcript:
        transcript = read_text(os.path.join(account_dir, 'transcripts', video_id + '.txt'))
    if not transcript:
        return {'success': False, 'error': 'transcript required'}

    record = {
        'id': vector_id(platform, account_slug, video_id),
        'text': build_text(platform, account, video, transcript),
        'account': str(account.get('name') or account_slug),
        'scene': '账号库转写',
        'type': 'style-transcript',
        'hook': str(video.get('title') or '').strip(),
        'golden_line': '',
        'progression': '',
        'source': 'account-style-library',
        'marketing_target': platform,
        'content_direction': str(video.get('title') or '').strip(),
        'case_tags': '账号库,转写,{}'.format(platform),
        'link': video_link(platform, video),
    }
    result = add_item(collection, record)
    result.update({
        'vector_id': record['id'],
        'videoId': video_id,
        'account': record['account'],
        'title': record['hook'],
    })
    return result


def delete_one(params):
    platform = str(params.get('platform') or '').strip()
    account_slug = str(params.get('accountSlug') or params.get('account_id') or params.get('accountId') or '').strip()
    video_id = str(params.get('videoId') or params.get('video_id') or '').strip()
    collection = str(params.get('collection') or 'wenan').strip() or 'wenan'
    if not platform or not account_slug or not video_id:
        return {'success': False, 'error': 'platform/accountSlug/videoId required'}
    return delete_item(collection, vector_id(platform, account_slug, video_id))


def sync_all(params):
    collection = str(params.get('collection') or 'wenan').strip() or 'wenan'
    platforms = params.get('platforms') if isinstance(params.get('platforms'), list) else ['bilibili', 'douyin']
    limit = int(params.get('limit') or 0)
    synced = 0
    failed = []
    skipped = 0

    for platform in platforms:
        platform_dir = os.path.join(STYLE_ROOT, str(platform))
        if not os.path.isdir(platform_dir):
            continue
        for account_slug in os.listdir(platform_dir):
            account_dir = os.path.join(platform_dir, account_slug)
            transcript_dir = os.path.join(account_dir, 'transcripts')
            if not os.path.isdir(transcript_dir):
                continue
            for file_name in os.listdir(transcript_dir):
                if not file_name.endswith('.txt'):
                    continue
                if limit and synced >= limit:
                    return {'success': True, 'synced': synced, 'skipped': skipped, 'failed': failed, 'root': STYLE_ROOT}
                video_id = file_name[:-4]
                transcript = read_text(os.path.join(transcript_dir, file_name))
                if not transcript:
                    skipped += 1
                    continue
                result = sync_one({
                    'platform': platform,
                    'accountSlug': account_slug,
                    'videoId': video_id,
                    'transcript': transcript,
                    'collection': collection,
                })
                if result.get('success'):
                    synced += 1
                else:
                    failed.append({'platform': platform, 'accountSlug': account_slug, 'videoId': video_id, 'error': result.get('error')})

    return {'success': True, 'synced': synced, 'skipped': skipped, 'failed': failed, 'root': STYLE_ROOT}


def main():
    payload = load_payload(sys.argv[1]) if len(sys.argv) > 1 else {}
    action = payload.get('action') or 'sync-all'
    params = payload.get('params') or payload
    if action == 'sync-one':
        return sync_one(params)
    if action == 'delete-one':
        return delete_one(params)
    if action == 'sync-all':
        return sync_all(params)
    return {'success': False, 'error': 'unknown action: ' + str(action)}


if __name__ == '__main__':
    try:
        write_json(main())
    except Exception as e:
        print(json.dumps({'success': False, 'error': str(e)}, ensure_ascii=False))
