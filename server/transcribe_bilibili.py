# -*- coding: utf-8 -*-
"""B站视频转写：优先用项目内 bilibili-cli 字幕，必要时下载音频走硅基流动。"""
import json
import mimetypes
import os
import shutil
import sys
import tempfile
import urllib.error
import urllib.request
import uuid

from env import load_env
from volcengine_asr import transcribe_audio_file as transcribe_audio_file_with_volcengine
from bilibili_cli_bridge import (
    error_message,
    extract_bvid,
    parse_json_output,
    run_bili,
    setup_hint,
)


load_env()
API_KEY = os.environ.get('SILICONFLOW_API_KEY') or os.environ.get('SF_KEY') or ''
SILICONFLOW_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions'
SENSEVOICE_MODEL = 'FunAudioLLM/SenseVoiceSmall'


def _clean_text(text):
    return '\n'.join(line.strip() for line in str(text or '').splitlines() if line.strip()).strip()


def _is_setup_error(message):
    message = str(message or '')
    return (
        'tools/bilibili-cli' in message
        or 'Submodule' in setup_hint()
        and '首次使用' in message
        or 'No module named' in message
        or 'ModuleNotFoundError' in message
    )


def _video_payload(bvid, include_subtitle):
    args = ['video', bvid, '--json']
    if include_subtitle:
        args.insert(2, '--subtitle')
    result = run_bili(args, timeout=60)
    if not result.get('ok'):
        return None, error_message(result)
    payload = parse_json_output(result.get('stdout', ''))
    if payload.get('ok') is False:
        return None, error_message(result)
    return payload.get('data') or {}, ''


def _video_meta(data):
    video = data.get('video') or {}
    metadata = video.get('metadata') if isinstance(video.get('metadata'), dict) else {}
    author = ''
    for value in (video.get('author'), video.get('owner'), video.get('up'), video.get('uname'), metadata.get('author')):
        if isinstance(value, dict):
            author = value.get('name') or value.get('nickname') or value.get('uname') or value.get('author') or ''
        else:
            author = value or ''
        if author:
            break
    author = str(author).replace('\n', ' ').strip()
    return {
        'title': video.get('title') or '',
        'bvid': video.get('bvid') or video.get('id') or '',
        'url': video.get('url') or '',
        'author': author,
    }


def parse_bilibili(url):
    bvid = extract_bvid(url)
    if not bvid:
        return {'error': '无法识别 BV 号，请输入 B站链接、b23.tv 短链或 BV 号'}
    data, err = _video_payload(bvid, include_subtitle=False)
    if err:
        return {'error': err, 'bvid': bvid, 'platform': 'bilibili'}
    meta = _video_meta(data)
    return {'title': meta['title'] or bvid, 'description': '', 'platform': 'bilibili', 'bvid': bvid, 'author': meta.get('author') or ''}


def _find_audio_file(directory):
    candidates = []
    for root, _, files in os.walk(directory):
        for name in files:
            lower = name.lower()
            if lower.endswith(('.m4a', '.m4s', '.mp3', '.wav', '.aac', '.flac', '.ogg', '.mp4')):
                path = os.path.join(root, name)
                candidates.append((os.path.getmtime(path), path))
    if not candidates:
        return ''
    candidates.sort(reverse=True)
    return candidates[0][1]


def _multipart_body(fields, file_field, file_path):
    boundary = '----usagi-bili-' + uuid.uuid4().hex
    chunks = []
    for key, value in fields.items():
        chunks.append(('--' + boundary + '\r\n').encode('utf-8'))
        chunks.append(('Content-Disposition: form-data; name="%s"\r\n\r\n' % key).encode('utf-8'))
        chunks.append(str(value).encode('utf-8'))
        chunks.append(b'\r\n')

    filename = os.path.basename(file_path)
    content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
    chunks.append(('--' + boundary + '\r\n').encode('utf-8'))
    chunks.append((
        'Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
        'Content-Type: %s\r\n\r\n'
    ) % (file_field, filename, content_type))
    chunks[-1] = chunks[-1].encode('utf-8')
    with open(file_path, 'rb') as f:
        chunks.append(f.read())
    chunks.append(b'\r\n')
    chunks.append(('--' + boundary + '--\r\n').encode('utf-8'))
    return boundary, b''.join(chunks)


def _transcribe_audio(file_path):
    if not API_KEY:
        return '', '未配置 SILICONFLOW_API_KEY 或 SF_KEY；视频没有可用字幕时无法自动语音转写'

    boundary, body = _multipart_body(
        {'model': SENSEVOICE_MODEL, 'language': 'zh', 'response_format': 'json'},
        'file',
        file_path,
    )
    req = urllib.request.Request(
        SILICONFLOW_URL,
        data=body,
        headers={
            'Authorization': 'Bearer ' + API_KEY,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
            'Content-Length': str(len(body)),
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            raw = resp.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode('utf-8', errors='replace')
        return '', '硅基流动转写失败 HTTP %s：%s' % (exc.code, raw[:240])
    except Exception as exc:
        return '', '硅基流动转写请求失败：' + str(exc)

    try:
        data = json.loads(raw)
    except Exception:
        return '', '硅基流动返回异常：' + raw[:240]

    text = _clean_text(data.get('text') or data.get('result') or '')
    if text:
        return text, ''
    return '', '硅基流动未返回转写文本：' + raw[:240]


def _transcribe_audio_preferred(file_path):
    text, error = transcribe_audio_file_with_volcengine(file_path)
    if text:
        return text, '', 'volcengine'
    fallback_text, fallback_error = _transcribe_audio(file_path)
    if fallback_text:
        return fallback_text, '', 'siliconflow'
    return '', '火山转写失败：' + str(error) + '；硅基流动兜底失败：' + str(fallback_error), ''


def _download_audio(bvid):
    tmp_dir = tempfile.mkdtemp(prefix='usagi_bili_audio_')
    result = run_bili(['audio', bvid, '--no-split', '-o', tmp_dir], timeout=240)
    if not result.get('ok'):
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return '', '', 'B站字幕不可用，音频下载失败：' + error_message(result)
    audio_path = _find_audio_file(tmp_dir)
    if not audio_path:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        return '', '', 'B站字幕不可用，bilibili-cli 未生成音频文件'
    return tmp_dir, audio_path, ''


def _transcribe_audio_fallback(bvid, meta, subtitle_error=''):
    tmp_dir = ''
    try:
        tmp_dir, audio_path, audio_err = _download_audio(bvid)
        if audio_err:
            detail = audio_err
            if subtitle_error:
                detail += '；字幕读取失败原因：' + subtitle_error[:200]
            return {'error': detail, 'title': meta.get('title') or '', 'bvid': bvid, 'source': 'bilibili-cli:audio'}
        text, asr_err, asr_source = _transcribe_audio_preferred(audio_path)
        if asr_err:
            detail = asr_err
            if subtitle_error:
                detail += '；字幕读取失败原因：' + subtitle_error[:200]
            return {'error': detail, 'title': meta.get('title') or '', 'bvid': bvid, 'source': 'volcengine'}
        return {
            'text': text,
            'title': meta.get('title') or '',
            'bvid': bvid,
            'author': meta.get('author') or '',
            'source': asr_source or 'volcengine',
            'subtitle_error': subtitle_error or '',
        }
    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)


def transcribe_bilibili(url):
    if not url:
        return {'error': '请输入 B站链接或 BV 号'}

    bvid = extract_bvid(url)
    if not bvid:
        return {'error': '无法识别 BV 号，请输入 B站链接、b23.tv 短链或 BV 号'}

    data, err = _video_payload(bvid, include_subtitle=True)
    subtitle_error = ''
    if err:
        if _is_setup_error(err):
            return {'error': err, 'bvid': bvid, 'source': 'bilibili-cli'}
        subtitle_error = err
        data, meta_err = _video_payload(bvid, include_subtitle=False)
        if meta_err:
            return {'error': 'B站信息获取失败：' + meta_err, 'bvid': bvid, 'source': 'bilibili-cli'}

    meta = _video_meta(data)
    subtitle = data.get('subtitle') or {}
    subtitle_text = _clean_text(subtitle.get('text') or '')
    if subtitle_text:
        return {
            'text': subtitle_text,
            'title': meta['title'],
            'bvid': bvid,
            'author': meta.get('author') or '',
            'source': 'bilibili-cli:subtitle',
        }

    warnings = data.get('warnings') if isinstance(data.get('warnings'), list) else []
    if not subtitle_error:
        for item in warnings:
            if isinstance(item, dict) and item.get('code') == 'subtitle_unavailable':
                subtitle_error = item.get('message') or '字幕不可用'
                break
    return _transcribe_audio_fallback(bvid, meta, subtitle_error)


def main():
    tmp_file = sys.argv[1] if len(sys.argv) > 1 else ''
    try:
        with open(tmp_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        data = {}

    params = data.get('params', data) or {}
    action = data.get('action') or 'transcribe'
    url = params.get('url', '')
    result = parse_bilibili(url) if action == 'parse' else transcribe_bilibili(url)
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))


if __name__ == '__main__':
    main()
