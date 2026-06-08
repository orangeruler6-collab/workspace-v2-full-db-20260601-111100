# -*- coding: utf-8 -*-
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from env import load_env

load_env()

API_KEY = os.environ.get("SILICONFLOW_API_KEY") or os.environ.get("SF_KEY") or ""
SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
DY_BRIDGE = SERVER_DIR / "douyin_downloader_bridge.py"
FFMPEG_BIN = ROOT_DIR / ".runtime" / "ffmpeg" / "ffmpeg-8.1.1-essentials_build" / "bin"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def build_env(extra=None):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    if FFMPEG_BIN.exists():
        env["PATH"] = str(FFMPEG_BIN) + os.pathsep + env.get("PATH", "")
    if extra:
        env.update(extra)
    return env


def transcribe_douyin(url):
    if not url or ("douyin.com" not in url and "v.douyin" not in url):
        return {"error": "invalid_url"}

    tmp_file = tempfile.mktemp(prefix="douyin_bridge_", suffix=".json")
    payload = json.dumps(
        {
            "action": "download",
            "params": {
                "url": url,
                "autoTranscript": True,
                "fetchAuthor": True,
                "downloadAssets": False,
                "downloadType": "transcript",
            },
        },
        ensure_ascii=False,
    )
    with open(tmp_file, "w", encoding="utf-8") as f:
        f.write(payload)

    cmd = [sys.executable, str(DY_BRIDGE), tmp_file]
    env = build_env({"API_KEY": API_KEY})
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=180,
            env=env,
        )
        code = proc.returncode
        out = proc.stdout.decode("utf-8", errors="replace")
        err = proc.stderr.decode("utf-8", errors="replace")
    except subprocess.TimeoutExpired:
        return {"error": "timeout"}
    except Exception as e:
        return {"error": "error: " + str(e)[:200]}
    finally:
        try:
            os.unlink(tmp_file)
        except OSError:
            pass

    try:
        result = json.loads(out)
    except Exception:
        if code == 0:
            return {"error": "parse_failed: " + out[:200]}
        detail = err or out or "执行失败"
        return {"error": "download_failed: " + detail[:400]}

    text = result.get("transcript_text", "")
    author = result.get("author", "")
    if text:
        return {"text": text, "title": result.get("title", ""), "author": author, "platform": "douyin"}

    if code != 0:
        detail = (
            result.get("message")
            or result.get("error")
            or result.get("stderr")
            or err
            or out
            or "执行失败"
        )
        return {"error": "download_failed: " + str(detail)[:400]}

    for item in result.get("files", []):
        if item.get("type") == "transcript" and item.get("name", "").endswith(".txt"):
            return {
                "text": "transcript_exists:" + item.get("path", ""),
                "title": result.get("title", ""),
                "author": author,
                "platform": "douyin",
            }

    detail = (
        result.get("message")
        or result.get("error")
        or result.get("stderr")
        or result.get("log")
        or "未生成文案"
    )
    return {"error": "no_transcript: " + str(detail)[:300]}


tmp = sys.argv[1] if len(sys.argv) > 1 else ""
body = {}
url = ""
if tmp and os.path.exists(tmp):
    try:
        with open(tmp, encoding="utf-8") as f:
            body = json.loads(f.read())
        url = (body.get("params", body) or {}).get("url", "")
    except Exception:
        url = ""

sys.stdout.write(json.dumps(transcribe_douyin(url), ensure_ascii=False))
