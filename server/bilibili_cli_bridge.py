# -*- coding: utf-8 -*-
"""Shared helpers for project-managed bilibili-cli integration."""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import urllib.request


SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(SERVER_DIR, '..'))
DEFAULT_CLI_ROOT = os.path.join(ROOT_DIR, 'tools', 'bilibili-cli')
BVID_RE = re.compile(r'\bBV[0-9A-Za-z]{10}\b')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/133 Safari/537.36'


def setup_hint():
    return (
        'B站工具已按 Submodule 放在 tools/bilibili-cli；首次使用请执行：'
        'cd tools/bilibili-cli && uv sync --extra audio'
    )


def pick_cli_root():
    return os.environ.get('BILIBILI_CLI_ROOT') or DEFAULT_CLI_ROOT


def extract_bvid(value):
    value = str(value or '').strip()
    if not value:
        return ''
    match = BVID_RE.search(value)
    if match:
        return match.group(0)

    if 'b23.tv' in value or 'bili2233.cn' in value:
        resolved = resolve_url(value)
        match = BVID_RE.search(resolved)
        if match:
            return match.group(0)
    return ''


def resolve_url(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=12) as resp:
            return resp.geturl()
    except Exception:
        return url


def _with_source_env(root):
    env = os.environ.copy()
    env['PYTHONIOENCODING'] = 'utf-8'
    env['OUTPUT'] = 'json'
    old_path = env.get('PYTHONPATH', '')
    env['PYTHONPATH'] = root + (os.pathsep + old_path if old_path else '')
    return env


def _candidate_pythons(root):
    candidates = [
        os.environ.get('BILIBILI_CLI_PYTHON'),
        os.path.join(root, '.venv', 'bin', 'python'),
        os.path.join(root, '.venv', 'Scripts', 'python.exe'),
        sys.executable,
        shutil.which('python3'),
        shutil.which('python'),
    ]
    seen = set()
    for item in candidates:
        if item and item not in seen:
            seen.add(item)
            yield item


def _source_deps_available(python, root):
    if not python:
        return False
    code = 'import bilibili_api, click, rich, aiohttp, browser_cookie3, yaml, qrcode'
    try:
        result = subprocess.run(
            [python, '-c', code],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            env=_with_source_env(root),
        )
        return result.returncode == 0
    except Exception:
        return False


def _venv_bili_bins(root):
    return [
        os.path.join(root, '.venv', 'bin', 'bili'),
        os.path.join(root, '.venv', 'Scripts', 'bili.exe'),
    ]


def command_candidates():
    root = pick_cli_root()

    env_bin = os.environ.get('BILIBILI_CLI_BIN')
    if env_bin:
        yield {
            'cmd': shlex.split(env_bin),
            'env': os.environ.copy(),
            'label': env_bin,
        }

    for bili_bin in _venv_bili_bins(root):
        if os.path.exists(bili_bin):
            yield {
                'cmd': [bili_bin],
                'env': os.environ.copy(),
                'label': bili_bin,
            }

    global_bili = shutil.which('bili')
    if global_bili:
        yield {
            'cmd': [global_bili],
            'env': os.environ.copy(),
            'label': global_bili,
        }

    if os.path.exists(os.path.join(root, 'bili_cli')):
        for python in _candidate_pythons(root):
            if _source_deps_available(python, root):
                yield {
                    'cmd': [python, '-m', 'bili_cli.cli'],
                    'env': _with_source_env(root),
                    'label': python + ' -m bili_cli.cli',
                }
                break


def run_bili(args, timeout=60):
    candidates = list(command_candidates())
    if not candidates:
        root = pick_cli_root()
        if not os.path.exists(root):
            message = '未找到 tools/bilibili-cli 子模块，请先执行：git submodule update --init --recursive'
        else:
            message = setup_hint()
        return {
            'ok': False,
            'returncode': 127,
            'stdout': '',
            'stderr': message,
            'label': '',
            'cmd': '',
            'setup_required': True,
        }

    last = None
    for candidate in candidates:
        cmd = candidate['cmd'] + args
        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout,
                cwd=ROOT_DIR,
                env=dict(candidate['env'], PYTHONIOENCODING='utf-8', OUTPUT='json'),
            )
            payload = {
                'ok': result.returncode == 0,
                'returncode': result.returncode,
                'stdout': result.stdout.decode('utf-8', errors='replace'),
                'stderr': result.stderr.decode('utf-8', errors='replace'),
                'label': candidate['label'],
                'cmd': ' '.join(shlex.quote(part) for part in cmd),
            }
            if result.returncode == 0:
                return payload
            last = payload
            if 'No module named' not in payload['stderr'] and 'ModuleNotFoundError' not in payload['stderr']:
                return payload
        except subprocess.TimeoutExpired:
            return {
                'ok': False,
                'returncode': 124,
                'stdout': '',
                'stderr': 'bilibili-cli 执行超时',
                'label': candidate['label'],
                'cmd': ' '.join(shlex.quote(part) for part in cmd),
            }
        except Exception as exc:
            last = {
                'ok': False,
                'returncode': -1,
                'stdout': '',
                'stderr': str(exc),
                'label': candidate['label'],
                'cmd': ' '.join(shlex.quote(part) for part in cmd),
            }
    if last:
        if 'No module named' in last.get('stderr', '') or 'ModuleNotFoundError' in last.get('stderr', ''):
            last['stderr'] = setup_hint() + '；当前错误：' + last.get('stderr', '').strip()
            last['setup_required'] = True
        return last
    return {'ok': False, 'returncode': 1, 'stdout': '', 'stderr': 'bilibili-cli 不可用'}


def parse_json_output(output):
    output = (output or '').strip()
    if not output:
        return {}
    try:
        return json.loads(output)
    except Exception:
        start = output.find('{')
        end = output.rfind('}')
        if start >= 0 and end > start:
            try:
                return json.loads(output[start:end + 1])
            except Exception:
                return {}
    return {}


def error_message(result):
    parsed = parse_json_output(result.get('stdout', ''))
    if parsed.get('ok') is False:
        error = parsed.get('error') or {}
        message = error.get('message') or error.get('code') or ''
        if message:
            return str(message)
    stderr = (result.get('stderr') or '').strip()
    stdout = (result.get('stdout') or '').strip()
    message = stderr or stdout or 'bilibili-cli 执行失败'
    message = re.sub(r'\s+', ' ', message)
    return message[:500]

