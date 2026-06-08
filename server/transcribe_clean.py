# -*- coding: utf-8 -*-
import sys, os, json
from env import load_env
from bilibili_cli_bridge import extract_bvid, parse_json_output, run_bili

load_env()
SF_KEY = os.environ.get('SILICONFLOW_API_KEY') or os.environ.get('SF_KEY') or ''
SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SERVER_DIR, '..'))
DOUYIN_ROOT = os.environ.get('DOUYIN_DOWNLOADER_ROOT') or os.path.join(ROOT_DIR, 'tools', 'douyin-downloader')
DOWNLOAD_DIR = os.environ.get('DOUYIN_DOWNLOAD_DIR') or os.path.join(DOUYIN_ROOT, 'downloads')

def is_bilibili(url):
    return 'bilibili.com' in url or url.startswith('BV') or url.startswith('bv')

def is_douyin(url):
    return 'douyin.com' in url or 'v.douyin.com' in url

def run_cmd(cmd, timeout=120):
    import subprocess
    try:
        env = dict(os.environ)
        env['PYTHONIOENCODING'] = 'utf-8'
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout, shell=False, env=env)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, '', 'timeout'
    except Exception as e:
        return -1, '', str(e)

def bili(bv):
    target = extract_bvid(bv) or bv
    result = run_bili(['video', target, '--subtitle', '--json'], timeout=60)
    if not result.get('ok'):
        return None, 'bili failed: ' + str(result.get('stderr') or result.get('stdout') or result.get('cmd') or '')
    try:
        data = parse_json_output(result.get('stdout', ''))
        if not data.get('ok'):
            return None, 'bili not ok'
        sub = data.get('data', {}).get('subtitle', {})
        if not sub.get('available'):
            return None, 'no subtitle'
        text = sub.get('text', '')
        if text:
            return text, None
        items = sub.get('items', [])
        if items:
            return '\n'.join([item.get('content', '') for item in items]), None
        return None, 'empty'
    except Exception as e:
        return None, 'parse error: ' + str(e)

def douyin(url):
    import builtins
    _orig = builtins.print
    def _n(*a, **k): pass
    builtins.print = _n
    try:
        sys.path.insert(0, DOUYIN_ROOT)
        from douyin_downloader import DouyinProcessor
        p = DouyinProcessor(api_key=SF_KEY)
        info = p.parse_share_url(url)
        vid = info['video_id']
        out_dir = os.path.join(DOWNLOAD_DIR, vid)
        os.makedirs(out_dir, exist_ok=True)
        vp = p.download_video(info, output_dir=out_dir, show_progress=False)
        ap = p.extract_audio(vp, show_progress=False)
        text = p.extract_text_from_audio(ap, show_progress=False)
        try:
            os.remove(vp)
            os.remove(ap)
        except:
            pass
        builtins.print = _orig
        return text, None
    except Exception as e:
        builtins.print = _orig
        return None, 'douyin error: ' + str(e).encode('ascii', errors='replace').decode('ascii')

def transcribe_sensevoice(ap):
    import urllib.request
    url = 'https://api.siliconflow.cn/v1/audio/transcriptions'
    boundary = '----VB'
    with open(ap, 'rb') as f:
        aud = f.read()
    body = (
        '--' + boundary + '\r\n'
        'Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n'
        'Content-Type: audio/mpeg\r\n\r\n'
    ).encode('utf-8') + aud + (
        '\r\n--' + boundary + '\r\n'
        'Content-Disposition: form-data; name="model"\r\n\r\n'
        'FunAudioLLM/SenseVoiceSmall\r\n'
        '--' + boundary + '\r\n'
        'Content-Disposition: form-data; name="language"\r\n\r\n'
        'auto\r\n--' + boundary + '--\r\n'
    ).encode('utf-8')
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Authorization', 'Bearer ' + SF_KEY)
    req.add_header('Content-Type', 'multipart/form-data; boundary=' + boundary)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            return result.get('text', ''), None
    except Exception as e:
        return None, str(e)

def generic(url):
    import subprocess
    out_dir = os.path.join(DOWNLOAD_DIR, 'tr_' + str(os.getpid()))
    os.makedirs(out_dir, exist_ok=True)
    vp = os.path.join(out_dir, 'video.mp4')
    ap = os.path.join(out_dir, 'audio.mp3')
    code, out, err = run_cmd(['yt-dlp', '-f', 'bv[height<=720]+ba/bv[height<=720]/best',
        '-o', vp, '--no-playlist', '--quiet', '--no-warnings', url], 300)
    if code != 0:
        return None, 'dl failed: ' + str(err or out)
    if not os.path.exists(vp):
        return None, 'no file'
    code, out, err = run_cmd(['ffmpeg', '-y', '-i', vp, '-vn', '-acodec', 'mp3', '-q:a', '2', ap], 120)
    if code != 0:
        return None, 'ffmpeg failed: ' + str(err)
    result = transcribe_sensevoice(ap)
    for p in [vp, ap]:
        try: os.remove(p)
        except: pass
    return result

def main():
    tmp_in = sys.argv[1] if len(sys.argv) > 1 else None
    tmp_out = sys.argv[2] if len(sys.argv) > 2 else None

    payload = {}
    if tmp_in and os.path.exists(tmp_in):
        try:
            with open(tmp_in, encoding='utf-8') as f:
                payload = json.load(f)
        except:
            pass

    action = payload.get('action', '')
    params = payload.get('params', {})

    if action == 'transcribe':
        url = params.get('url', '')
        account = params.get('account', 'common')
        if not url:
            result = {'error': 'url required'}
        elif is_bilibili(url):
            text, err = bili(url)
            result = {'text': text, 'account': account, 'source': 'bilibili'} if text else {'error': 'B: ' + ''.join(c if ord(c) < 128 else '?' for c in str(err))}
        elif is_douyin(url):
            text, err = douyin(url)
            result = {'text': text, 'account': account, 'source': 'douyin'} if text else {'error': 'D: ' + ''.join(c if ord(c) < 128 else '?' for c in str(err))}
        else:
            text, err = generic(url)
            result = {'text': text, 'account': account, 'source': 'generic'} if text else {'error': ''.join(c if ord(c) < 128 else '?' for c in str(err))}
        result_str = json.dumps(result, ensure_ascii=False)
    else:
        result_str = json.dumps({'error': 'unknown action: ' + action})

    if tmp_out:
        try:
            with open(tmp_out, 'w', encoding='utf-8') as f:
                f.write(result_str)
        except:
            pass

    sys.stdout.buffer.write(result_str.encode('utf-8'))

if __name__ == '__main__':
    main()
