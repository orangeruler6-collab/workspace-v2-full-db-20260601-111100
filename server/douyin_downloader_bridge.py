#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

LEGACY_DOWNLOADER_ROOT = "/Users/xjx/Documents/New project/douyin-downloader"
MAX_LOG_CHARS = 6000
PUBLIC_EXTENSIONS = {
    ".mp4": "video",
    ".mov": "video",
    ".webm": "video",
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".gif": "image",
    ".json": "json",
    ".jsonl": "jsonl",
    ".txt": "text",
    ".srt": "subtitle",
    ".mp3": "audio",
    ".m4a": "audio",
    ".wav": "audio",
    ".flv": "video",
}
SENSITIVE_KEYS = [
    "__ac_nonce",
    "__ac_signature",
    "bd_ticket_guard_client_data",
    "d_ticket",
    "msToken",
    "odin_tt",
    "passport_csrf_token",
    "sessionid",
    "sid_guard",
    "sid_tt",
    "ttwid",
    "UIFID",
    "UIFID_TEMP",
]
SILICONFLOW_TRANSCRIPT_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
SILICONFLOW_TRANSCRIPT_MODEL = "FunAudioLLM/SenseVoiceSmall"
AWEME_ID_RE = re.compile(r"(?<!\d)(\d{15,20})(?!\d)")


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False))


def load_payload():
    if len(sys.argv) < 2:
        return {}
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        return json.load(f)


def as_int(value, default, minimum=0, maximum=None):
    try:
        num = int(value)
    except (TypeError, ValueError):
        return default
    if num < minimum:
        return default
    if maximum is not None and num > maximum:
        return maximum
    return num


def as_bool(value, default=False):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def requested_download_type(params):
    value = str(
        params.get("downloadType")
        or params.get("download_type")
        or "mp4"
    ).strip().lower()
    if value not in {"mp4", "mp3", "cover", "all"}:
        return "mp4"
    return value


def requested_quality(params):
    value = str(
        params.get("quality")
        or params.get("downloadQuality")
        or params.get("download_quality")
        or "best"
    ).strip().lower()
    if value in {"1080p", "1080"}:
        return "1080"
    if value in {"720p", "720"}:
        return "720"
    return "best"


def download_assets_requested(params):
    return as_bool(
        params.get("downloadAssets", params.get("download_assets")),
        default=False,
    )


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


def redact(text):
    if not text:
        return ""
    clean = text
    for key in SENSITIVE_KEYS:
        pattern = r"(" + re.escape(key) + r"\s*[:=]\s*)([^,\s\n]+)"
        clean = re.sub(pattern, r"\1***", clean, flags=re.IGNORECASE)
    return strip_ansi(clean)[-MAX_LOG_CHARS:]


def strip_ansi(text):
    return re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text or "")


def workspace_root():
    return Path(__file__).resolve().parents[1]


def ffmpeg_bin_dir():
    return workspace_root() / ".runtime" / "ffmpeg" / "ffmpeg-8.1.1-essentials_build" / "bin"


def load_workspace_env():
    env_path = workspace_root() / ".env"
    if not env_path.exists():
        return
    try:
        lines = env_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def pick_downloader_root():
    load_workspace_env()
    env_root = os.environ.get("DOUYIN_DOWNLOADER_ROOT")
    candidates = []
    if env_root:
        candidates.append(Path(env_root))
    candidates.extend([
        workspace_root() / "tools" / "douyin-downloader",
        Path(LEGACY_DOWNLOADER_ROOT),
    ])
    for root in candidates:
        resolved = root.expanduser().resolve()
        if resolved.exists():
            return resolved
    return candidates[0].expanduser().resolve()


def pick_python(root):
    legacy_root = Path(LEGACY_DOWNLOADER_ROOT)
    candidates = [
        os.environ.get("DOUYIN_DOWNLOADER_PYTHON"),
        root / ".venv314" / "bin" / "python",
        root / ".venv" / "bin" / "python",
        root / ".venv" / "Scripts" / "python.exe",
        workspace_root() / ".venv" / "bin" / "python",
        legacy_root / ".venv314" / "bin" / "python",
        legacy_root / ".venv" / "bin" / "python",
        "python3",
        "python",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        if isinstance(candidate, Path):
            if candidate.exists():
                return str(candidate)
        else:
            return str(candidate)
    return "python3"


def output_dir():
    out = workspace_root() / "public" / "uploads" / "douyin"
    out.mkdir(parents=True, exist_ok=True)
    return out


def file_to_public_entry(path, base_dir):
    stat = path.stat()
    if stat.st_size <= 0:
        return None
    rel = path.relative_to(base_dir)
    rel_posix = rel.as_posix()
    encoded = urllib.parse.quote(rel_posix)
    lower_name = path.name.lower()
    file_type = PUBLIC_EXTENSIONS.get(path.suffix.lower(), "file")
    if lower_name.endswith("_comments.json"):
        file_type = "comments"
    elif ".transcript." in lower_name:
        file_type = "transcript"
    elif lower_name.endswith("_data.json"):
        file_type = "metadata"
    return {
        "name": path.name,
        "path": rel_posix,
        "url": "/uploads/douyin/" + encoded,
        "download_url": "/uploads/douyin/" + encoded + "?v=" + str(int(stat.st_mtime)),
        "type": file_type,
        "size": stat.st_size,
        "mtime": int(stat.st_mtime),
    }


def file_matches_download_type(item, download_type):
    file_type = item.get("type") or ""
    name = str(item.get("name") or "").lower()
    if download_type == "all":
        return file_type in {"video", "audio", "image"}
    if download_type == "mp4":
        return file_type == "video"
    if download_type == "mp3":
        return file_type == "audio"
    if download_type == "cover":
        return file_type == "image" and "_cover" in name
    return False


def filter_public_files(files, params):
    if not download_assets_requested(params):
        return []
    download_type = requested_download_type(params)
    return [item for item in files if file_matches_download_type(item, download_type)]


def read_transcript(files, base_dir):
    candidates = []
    for item in files:
        rel = item.get("path") or ""
        name = str(item.get("name") or "").lower()
        if item.get("type") == "transcript" and name.endswith(".txt"):
            candidates.append(base_dir / rel)
    if not candidates:
        return "", None
    path = sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)[0]
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        text = ""
    return text, file_to_public_entry(path, base_dir)


def _pick_text(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _author_from_object(data):
    if not isinstance(data, dict):
        return ""

    aweme = data.get("aweme_info") if isinstance(data.get("aweme_info"), dict) else {}
    candidates = [
        data.get("author"),
        aweme.get("author") if isinstance(aweme, dict) else None,
        data.get("user"),
        data.get("owner"),
    ]
    for author in candidates:
        if isinstance(author, dict):
            name = _pick_text(
                author.get("nickname"),
                author.get("name"),
                author.get("unique_id"),
                author.get("short_id"),
            )
            if name:
                return name
        elif author:
            return str(author).strip()

    return _pick_text(
        data.get("nickname"),
        data.get("author_name"),
        data.get("authorName"),
        aweme.get("nickname") if isinstance(aweme, dict) else "",
    )


def read_author(files, base_dir):
    paths = []
    for item in files:
        rel = item.get("path") or ""
        name = str(item.get("name") or "").lower()
        if item.get("type") == "metadata" or name.endswith("_data.json"):
            paths.append(base_dir / rel)
    paths = sorted([p for p in paths if p.exists()], key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        name = _author_from_object(data)
        if name:
            return name
    return ""


def _caption_from_object(data):
    if not isinstance(data, dict):
        return ""
    aweme = data.get("aweme_info") if isinstance(data.get("aweme_info"), dict) else {}
    return _pick_text(
        data.get("desc"),
        data.get("description"),
        data.get("title"),
        data.get("caption"),
        aweme.get("desc") if isinstance(aweme, dict) else "",
        aweme.get("title") if isinstance(aweme, dict) else "",
    )


def read_caption(files, base_dir):
    paths = []
    for item in files:
        rel = item.get("path") or ""
        name = str(item.get("name") or "").lower()
        if item.get("type") == "metadata" or name.endswith("_data.json"):
            paths.append(base_dir / rel)
    paths = sorted([p for p in paths if p.exists()], key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        caption = _caption_from_object(data)
        if caption:
            return caption[:500]
    return ""


def collect_files(base_dir, since_ts, limit=80):
    if not base_dir.exists():
        return []
    all_files = [
        p for p in base_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in PUBLIC_EXTENSIONS
    ]
    chosen = [p for p in all_files if p.stat().st_mtime >= since_ts]
    chosen = sorted(chosen, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    return [item for item in (file_to_public_entry(p, base_dir) for p in chosen) if item]


def extract_aweme_ids(*values):
    ids = []
    seen = set()
    for value in values:
        for match in AWEME_ID_RE.findall(str(value or "")):
            if match in seen:
                continue
            seen.add(match)
            ids.append(match)
    return ids


def collect_existing_aweme_files(base_dir, aweme_ids, limit=120):
    if not aweme_ids or not base_dir.exists():
        return []

    paths = []
    seen_paths = set()
    for aweme_id in aweme_ids:
        matched_dirs = set()
        for match in base_dir.rglob(f"*{aweme_id}*"):
            if match.is_dir():
                matched_dirs.add(match)
            elif match.is_file():
                if aweme_id in match.parent.name:
                    matched_dirs.add(match.parent)
                if match.suffix.lower() in PUBLIC_EXTENSIONS:
                    resolved = match.resolve()
                    if resolved not in seen_paths:
                        seen_paths.add(resolved)
                        paths.append(match)

        for folder in matched_dirs:
            for child in folder.rglob("*"):
                if not child.is_file() or child.suffix.lower() not in PUBLIC_EXTENSIONS:
                    continue
                resolved = child.resolve()
                if resolved in seen_paths:
                    continue
                seen_paths.add(resolved)
                paths.append(child)

    paths = sorted(paths, key=lambda p: p.stat().st_mtime, reverse=True)[:limit]
    return [item for item in (file_to_public_entry(path, base_dir) for path in paths) if item]


def merge_file_entries(*groups):
    merged = []
    seen = set()
    for group in groups:
        for item in group or []:
            key = item.get("path")
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def latest_jsonl(files, base_dir, folder_name):
    paths = []
    for item in files:
        rel = item.get("path") or ""
        if rel.startswith(folder_name + "/") and rel.endswith(".jsonl"):
            paths.append(base_dir / rel)
    if not paths:
        search_dir = base_dir / folder_name
        if search_dir.exists():
            paths = list(search_dir.glob("*.jsonl"))
    if not paths:
        return None
    return sorted(paths, key=lambda p: p.stat().st_mtime, reverse=True)[0]


def simplify_discovery_item(item):
    if not isinstance(item, dict):
        return {"title": str(item)}
    aweme = item.get("aweme_info") if isinstance(item.get("aweme_info"), dict) else {}
    author = item.get("author") if isinstance(item.get("author"), dict) else aweme.get("author")
    if not isinstance(author, dict):
        author = {}
    statistics = item.get("statistics") if isinstance(item.get("statistics"), dict) else aweme.get("statistics")
    if not isinstance(statistics, dict):
        statistics = {}
    title = (
        item.get("word")
        or item.get("sentence")
        or item.get("title")
        or item.get("desc")
        or aweme.get("desc")
        or item.get("aweme_id")
        or aweme.get("aweme_id")
        or ""
    )
    url = (
        item.get("share_url")
        or item.get("url")
        or aweme.get("share_url")
        or ""
    )
    aweme_id = str(item.get("aweme_id") or aweme.get("aweme_id") or "")
    if not url and aweme_id:
        url = "https://www.douyin.com/video/" + aweme_id
    hot = item.get("hot_value") or item.get("view_count") or statistics.get("digg_count") or ""
    return {
        "id": aweme_id,
        "title": str(title)[:180],
        "url": str(url),
        "author": str(author.get("nickname") or ""),
        "hot": str(hot),
    }


def read_jsonl_items(path, limit=100):
    if not path or not path.exists():
        return []
    items = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if len(items) >= limit:
                break
            line = line.strip()
            if not line:
                continue
            try:
                items.append(simplify_discovery_item(json.loads(line)))
            except json.JSONDecodeError:
                continue
    return items


def base_config_path(root):
    env_config = os.environ.get("DOUYIN_DOWNLOADER_CONFIG")
    if env_config:
        return Path(env_config).expanduser()
    for name in ("config.local.yml", "config.yml", "config.example.yml"):
        candidate = root / name
        if candidate.exists():
            return candidate
    return root / "config.local.yml"


def build_runtime_overrides(action, params, out_dir):
    if action != "download":
        return {}

    collect_comments = as_bool(
        params.get("collectComments", params.get("collect_comments")),
        default=False,
    )
    include_replies = as_bool(
        params.get("includeReplies", params.get("include_replies")),
        default=False,
    )
    auto_transcript = as_bool(
        params.get("autoTranscript", params.get("auto_transcript")),
        default=False,
    )
    download_assets = download_assets_requested(params)
    download_type = requested_download_type(params)
    fetch_author = as_bool(
        params.get("fetchAuthor", params.get("fetch_author")),
        default=False,
    )

    transcript_model = str(
        params.get("transcriptModel")
        or params.get("transcript_model")
        or SILICONFLOW_TRANSCRIPT_MODEL
    ).strip()
    if transcript_model in {"gpt-4o-mini-transcribe", "gpt-4o-transcribe", ""}:
        transcript_model = SILICONFLOW_TRANSCRIPT_MODEL
    api_key_env = "SILICONFLOW_API_KEY" if os.environ.get("SILICONFLOW_API_KEY", "").strip() else "SF_KEY"

    return {
        "path": str(out_dir),
        "music": download_assets and download_type in {"mp3", "all"},
        "cover": download_assets and download_type in {"cover", "all"},
        "avatar": False,
        "json": fetch_author,
        "comments": {
            "enabled": collect_comments,
            "include_replies": include_replies,
            "max_comments": as_int(params.get("commentLimit", params.get("comment_limit")), 50, minimum=0, maximum=1000),
            "page_size": 20,
        },
        "transcript": {
            "enabled": auto_transcript,
            "model": transcript_model,
            "api_url": SILICONFLOW_TRANSCRIPT_URL,
            "api_key_env": api_key_env,
            "output_dir": "",
            "response_formats": ["txt", "json"],
            "language_hint": "zh",
        },
    }


def auto_transcript_requested(action, params):
    return action == "download" and as_bool(
        params.get("autoTranscript", params.get("auto_transcript")),
        default=False,
    )


def transcript_api_key_available(config_path, python_bin):
    env_keys = ["SILICONFLOW_API_KEY", "SF_KEY"]

    if Path(config_path).exists():
        script = r"""
import json
import sys
import yaml

with open(sys.argv[1], "r", encoding="utf-8") as f:
    config = yaml.safe_load(f) or {}
transcript = config.get("transcript", {}) or {}
print(json.dumps({
    "api_key_env": str(transcript.get("api_key_env", "OPENAI_API_KEY") or "").strip(),
    "api_key_present": bool(str(transcript.get("api_key", "") or "").strip()),
}, ensure_ascii=False))
"""
        result = subprocess.run(
            [python_bin, "-c", script, str(config_path)],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=30,
        )
        if result.returncode == 0:
            try:
                payload = json.loads(result.stdout or "{}")
                api_key_env = str(payload.get("api_key_env") or "").strip()
                if api_key_env and api_key_env not in {"OPENAI_API_KEY"}:
                    env_keys.insert(0, api_key_env)
                if payload.get("api_key_present"):
                    return True
            except json.JSONDecodeError:
                pass

    return any(os.environ.get(key, "").strip() for key in env_keys if key)


def prepare_runtime_config(action, params, root, out_dir, python_bin):
    config_path = base_config_path(root)
    if not config_path.exists():
        raise RuntimeError("douyin-downloader config.yml not found")

    overrides = build_runtime_overrides(action, params, out_dir)
    if not overrides:
        return config_path, None

    fd, tmp_name = tempfile.mkstemp(prefix="douyin_runtime_", suffix=".yml")
    os.close(fd)
    tmp_path = Path(tmp_name)
    script = r"""
import json
import sys
import yaml

base_path, out_path, patch_json = sys.argv[1], sys.argv[2], sys.argv[3]
with open(base_path, "r", encoding="utf-8") as f:
    config = yaml.safe_load(f) or {}
patch = json.loads(patch_json)

def merge(target, source):
    for key, value in source.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            merge(target[key], value)
        else:
            target[key] = value
    return target

merge(config, patch)
with open(out_path, "w", encoding="utf-8") as f:
    yaml.safe_dump(config, f, allow_unicode=True, sort_keys=False)
"""
    result = subprocess.run(
        [python_bin, "-c", script, str(config_path), str(tmp_path), json.dumps(overrides, ensure_ascii=False)],
        cwd=str(root),
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
        timeout=30,
    )
    if result.returncode != 0:
        try:
            tmp_path.unlink()
        except OSError:
            pass
        raise RuntimeError("failed to build runtime config: " + redact(result.stderr or result.stdout))
    return tmp_path, tmp_path


def validate_action(action, params):
    if action == "download":
        if not extract_douyin_url(params.get("url")):
            raise RuntimeError("未识别到抖音链接，请粘贴分享口令或链接")
    elif action == "search":
        if not str(params.get("keyword") or "").strip():
            raise RuntimeError("keyword required")
    elif action != "hot":
        raise RuntimeError("unsupported action: " + str(action))


def build_command(action, params, root, out_dir, config_path, python_bin):
    if action == "download":
        url = extract_douyin_url(params.get("url"))
        if not url:
            raise RuntimeError("未识别到抖音链接，请粘贴分享口令或链接")
        thread = as_int(params.get("thread"), 5, minimum=1, maximum=16)
    elif action == "hot":
        limit = as_int(params.get("limit"), 20, minimum=0, maximum=200)
    elif action == "search":
        keyword = str(params.get("keyword") or "").strip()
        if not keyword:
            raise RuntimeError("keyword required")
        limit = as_int(params.get("limit"), 20, minimum=1, maximum=200)
    else:
        raise RuntimeError("unsupported action: " + str(action))

    config_path = Path(config_path)
    if not config_path.exists():
        raise RuntimeError("douyin-downloader config.yml not found")

    if action == "download":
        cmd = [
            python_bin,
            str(root / "run.py"),
            "-c", str(config_path),
            "--link", url,
            "--output", str(out_dir),
            "--quality", requested_quality(params),
        ]
    elif action == "hot":
        cmd = [
            python_bin,
            str(root / "run.py"),
            "-c", str(config_path),
            "--link", url,
            "--output", str(out_dir),
        ]
    elif action == "search":
        cmd = [
            python_bin,
            str(root / "run.py"),
            "-c", str(config_path),
            "--link", url,
            "--output", str(out_dir),
        ]

    if action == "download":
        cmd.extend(["--action", "download"])
    elif action == "hot":
        cmd.extend(["--action", "info"])
    elif action == "search":
        cmd.extend(["--action", "info"])

    return cmd


def main():
    payload = load_payload()
    action = payload.get("action") or "download"
    params = payload.get("params") or {}
    if isinstance(params.get("action"), str):
        action = params["action"]
    action = "hot" if action in ("hot_board", "hot-board") else action

    root = pick_downloader_root()
    out_dir = output_dir()
    start_ts = time.time() - 2
    tmp_config = None

    try:
        if not root.exists():
            raise RuntimeError("douyin-downloader root not found: " + str(root))
        validate_action(action, params)
        python_bin = pick_python(root)
        if auto_transcript_requested(action, params):
            source_config_path = base_config_path(root)
            if not transcript_api_key_available(source_config_path, python_bin):
                raise RuntimeError("自动转写需要配置 SILICONFLOW_API_KEY 或 SF_KEY；请在 .env 里添加后重启本地服务")
        config_path, tmp_config = prepare_runtime_config(action, params, root, out_dir, python_bin)
        cmd = build_command(action, params, root, out_dir, config_path, python_bin)
        timeout = as_int(params.get("timeout"), 1800 if action == "download" else 300, minimum=30, maximum=3600)
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONPATH"] = str(root)
        ffmpeg_dir = ffmpeg_bin_dir()
        if ffmpeg_dir.exists():
            env["PATH"] = str(ffmpeg_dir) + os.pathsep + env.get("PATH", "")

        proc = subprocess.run(
            cmd,
            cwd=str(root),
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
        )
        log = redact(proc.stdout)
        stderr = redact(proc.stderr)
        aweme_ids = extract_aweme_ids(params.get("url"), log, stderr)
        if action == "download" and aweme_ids:
            all_files = collect_existing_aweme_files(out_dir, aweme_ids)
        else:
            all_files = collect_files(out_dir, start_ts)
        transcript_text, transcript_file = read_transcript(all_files, out_dir)
        author = read_author(all_files, out_dir)
        caption = read_caption(all_files, out_dir)
        files = filter_public_files(all_files, params) if action == "download" else all_files
        items = []
        if action == "hot":
            items = read_jsonl_items(latest_jsonl(all_files, out_dir, "hot_board"))
        elif action == "search":
            items = read_jsonl_items(latest_jsonl(all_files, out_dir, "search"))

        parse_failed = action == "download" and (
            "Failed to parse URL" in log or "Unsupported URL type" in stderr
        )
        ok = proc.returncode == 0 and not (parse_failed and not files)
        message = "执行完成" if ok else "执行失败"
        if parse_failed and not files:
            message = "链接解析失败，请确认粘贴的是抖音视频/图文/合集/主页链接"
        elif ok and action == "download" and transcript_text:
            message = "转写完成"
        elif ok and action == "download" and auto_transcript_requested(action, params):
            message = "执行完成，但未生成文案，请查看日志"
        elif ok and action == "download" and not download_assets_requested(params):
            message = "执行完成，未选择下载文件"
        elif ok and action == "download" and not files:
            message = "执行完成，但没有发现可下载文件"

        emit({
            "success": ok,
            "action": action,
            "message": message,
            "return_code": proc.returncode,
            "files": files,
            "items": items,
            "author": author,
            "title": caption,
            "caption": caption,
            "transcript_text": transcript_text,
            "transcript_file": transcript_file,
            "log": log,
            "stderr": stderr,
            "output_dir": str(out_dir),
            "downloader_root": str(root),
        })
    except subprocess.TimeoutExpired as exc:
        emit({
            "ok": False,
            "error": "douyin-downloader timeout",
            "log": redact(exc.stdout if isinstance(exc.stdout, str) else ""),
            "stderr": redact(exc.stderr if isinstance(exc.stderr, str) else ""),
            "output_dir": str(out_dir),
            "downloader_root": str(root),
        })
    except Exception as exc:
        emit({
            "ok": False,
            "error": str(exc),
            "output_dir": str(out_dir),
            "downloader_root": str(root),
        })
    finally:
        if tmp_config is not None:
            try:
                Path(tmp_config).unlink()
            except OSError:
                pass


if __name__ == "__main__":
    main()
