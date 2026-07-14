# -*- coding: utf-8 -*-
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from env import load_env
from volcengine_asr import transcribe_audio_file as transcribe_audio_file_with_volcengine

load_env()

API_KEY = os.environ.get("SILICONFLOW_API_KEY") or os.environ.get("SF_KEY") or ""
SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
DY_BRIDGE = SERVER_DIR / "douyin_downloader_bridge.py"
FFMPEG_BIN = ROOT_DIR / ".runtime" / "ffmpeg" / "ffmpeg-8.1.1-essentials_build" / "bin"
SILICONFLOW_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
SENSEVOICE_MODEL = "FunAudioLLM/SenseVoiceSmall"

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


def extract_douyin_url(value):
    text = str(value or "").strip()
    if not text:
        return ""
    pattern = r"(?:https?://)?(?:[a-z0-9-]+\.)?(?:douyin|iesdouyin)\.com/[^\s\"'<>，。！？；、]+"
    for match in re.findall(pattern, text, flags=re.IGNORECASE):
        url = re.sub(r"[)\]}）】》\"'，。！？；、,.!?;:]+$", "", match)
        if not re.match(r"^https?://", url, flags=re.IGNORECASE):
            url = "https://" + url
        return url
    return ""


def extract_aweme_ids(*values):
    ids = []
    seen = set()
    for value in values:
        for match in re.findall(r"(?<!\d)(\d{15,20})(?!\d)", str(value or "")):
            if match in seen:
                continue
            seen.add(match)
            ids.append(match)
    return ids


def multipart_body(fields, file_field, file_path):
    boundary = "----usagi-douyin-" + uuid.uuid4().hex
    chunks = []
    for key, value in fields.items():
        chunks.append(("--" + boundary + "\r\n").encode("utf-8"))
        chunks.append(('Content-Disposition: form-data; name="%s"\r\n\r\n' % key).encode("utf-8"))
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    filename = os.path.basename(file_path)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    chunks.append(("--" + boundary + "\r\n").encode("utf-8"))
    chunks.append((
        'Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
        "Content-Type: %s\r\n\r\n"
    ) % (file_field, filename, content_type))
    chunks[-1] = chunks[-1].encode("utf-8")
    with open(file_path, "rb") as f:
        chunks.append(f.read())
    chunks.append(b"\r\n")
    chunks.append(("--" + boundary + "--\r\n").encode("utf-8"))
    return boundary, b"".join(chunks)


def transcribe_audio_file(file_path):
    if not API_KEY:
        return "", "未配置 SILICONFLOW_API_KEY 或 SF_KEY"
    if not file_path or not Path(file_path).exists():
        return "", "未找到已提取音频"
    boundary, body = multipart_body(
        {"model": SENSEVOICE_MODEL, "language": "zh", "response_format": "json"},
        "file",
        str(file_path),
    )
    req = urllib.request.Request(
        SILICONFLOW_URL,
        data=body,
        headers={
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Content-Length": str(len(body)),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return "", "硅基流动转写失败 HTTP %s：%s" % (exc.code, raw[:240])
    except Exception as exc:
        return "", "硅基流动转写请求失败：" + str(exc)

    try:
        data = json.loads(raw)
    except Exception:
        return "", "硅基流动返回异常：" + raw[:240]

    text = str(data.get("text") or data.get("result") or "").strip()
    if text:
        return text, ""
    return "", "硅基流动未返回转写文本：" + raw[:240]


def transcribe_audio_file_preferred(file_path):
    text, error = transcribe_audio_file_with_volcengine(file_path)
    if text:
        return text, "", "volcengine"
    fallback_text, fallback_error = transcribe_audio_file(file_path)
    if fallback_text:
        return fallback_text, "", "siliconflow"
    return "", "火山转写失败：" + str(error) + "；硅基流动兜底失败：" + str(fallback_error), ""


def find_extracted_audio(result, url):
    log = str(result.get("log") or "")
    for line in log.splitlines():
        if "Audio extracted:" not in line:
            continue
        candidate = line.split("Audio extracted:", 1)[1].strip().strip('"')
        path = Path(candidate)
        if path.exists() and path.suffix.lower() in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"}:
            return path

    output_dir = Path(result.get("output_dir") or ROOT_DIR / "public" / "uploads" / "douyin")
    ids = extract_aweme_ids(url, log, result.get("stderr"))
    candidates = []
    if output_dir.exists():
        for aweme_id in ids:
            candidates.extend(output_dir.rglob("*" + aweme_id + "*.mp3"))
            candidates.extend(output_dir.rglob("*" + aweme_id + "*.wav"))
        if not candidates:
            candidates.extend(output_dir.rglob("*.mp3"))
    candidates = [path for path in candidates if path.is_file() and path.stat().st_size > 0]
    if not candidates:
        return None
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)[0]


def transcribe_douyin(url):
    clean_url = extract_douyin_url(url)
    if not clean_url:
        return {"error": "invalid_url"}

    tmp_file = tempfile.mktemp(prefix="douyin_bridge_", suffix=".json")
    payload = json.dumps(
        {
            "action": "download",
            "params": {
                "url": clean_url,
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

    audio_path = find_extracted_audio(result, clean_url)
    fallback_text, fallback_error, fallback_source = transcribe_audio_file_preferred(audio_path)
    if fallback_text:
        return {
            "text": fallback_text,
            "title": result.get("title", ""),
            "author": author,
            "platform": "douyin",
            "source": "local_audio_fallback:" + (fallback_source or "asr"),
        }

    if code != 0:
        detail = (
            result.get("message")
            or result.get("error")
            or result.get("stderr")
            or err
            or out
            or "执行失败"
        )
        if fallback_error:
            detail = str(detail) + "；本地音频兜底也失败：" + fallback_error
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
    if fallback_error:
        detail = str(detail) + "；本地音频兜底也失败：" + fallback_error
    return {"error": "no_transcript: " + str(detail)[:300]}


tmp = sys.argv[1] if len(sys.argv) > 1 else ""
body = {}
url = ""
if tmp and os.path.exists(tmp):
    try:
        with open(tmp, encoding="utf-8-sig") as f:
            body = json.loads(f.read())
        url = (body.get("params", body) or {}).get("url", "")
    except Exception:
        url = ""

sys.stdout.write(json.dumps(transcribe_douyin(url), ensure_ascii=False))
