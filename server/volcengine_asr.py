# -*- coding: utf-8 -*-
import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path


def _header(headers, name):
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() == target:
            return str(value or "")
    return ""


def _post_json(url, headers, payload, timeout):
    data = payload.encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={**headers, "Content-Length": str(len(data))},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return {
                "status": resp.status,
                "headers": dict(resp.headers.items()),
                "body": resp.read().decode("utf-8", errors="replace"),
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": exc.code,
            "headers": dict(exc.headers.items()),
            "body": exc.read().decode("utf-8", errors="replace"),
        }
    except Exception as exc:
        return {
            "status": 0,
            "headers": {},
            "body": str(exc),
        }


def _extract_text(payload):
    parts = []

    def visit(value):
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if not isinstance(value, dict):
            return
        for key in ("text", "utterance_text", "result_text"):
            text = value.get(key)
            if isinstance(text, str) and text.strip():
                parts.append(text.strip())
        for item in value.values():
            visit(item)

    visit(payload)
    seen = set()
    cleaned = []
    for part in parts:
        if part in seen:
            continue
        seen.add(part)
        cleaned.append(part)
    return "\n".join(cleaned).strip()


def transcribe_audio_file(file_path):
    api_key = os.environ.get("VOLCENGINE_ASR_API_KEY") or os.environ.get("VOLCENGINE_API_KEY") or ""
    app_key = os.environ.get("VOLCENGINE_ASR_APP_KEY") or ""
    access_key = os.environ.get("VOLCENGINE_ASR_ACCESS_KEY") or ""
    if not api_key and not (app_key and access_key):
        return "", "未配置 VOLCENGINE_ASR_API_KEY"
    path = Path(file_path or "")
    if not path.exists():
        return "", "未找到已提取音频"

    submit_url = os.environ.get("VOLCENGINE_ASR_SUBMIT_URL") or "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit"
    query_url = os.environ.get("VOLCENGINE_ASR_QUERY_URL") or "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query"
    resource_id = os.environ.get("VOLCENGINE_ASR_RESOURCE_ID") or "volc.seedasr.auc"
    audio_format = os.environ.get("VOLCENGINE_ASR_AUDIO_FORMAT") or path.suffix.lower().lstrip(".") or "mp3"
    timeout = int(os.environ.get("VOLCENGINE_ASR_REQUEST_TIMEOUT_MS") or "30000") / 1000
    poll_interval = int(os.environ.get("VOLCENGINE_ASR_POLL_INTERVAL_MS") or "1000") / 1000
    max_attempts = int(os.environ.get("VOLCENGINE_ASR_MAX_POLL_ATTEMPTS") or "120")

    headers = {
        "Content-Type": "application/json",
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": str(uuid.uuid4()),
        "X-Api-Sequence": "-1",
    }
    if api_key:
        headers["X-Api-Key"] = api_key
    else:
        headers["X-Api-App-Key"] = app_key
        headers["X-Api-Access-Key"] = access_key

    body = json.dumps(
        {
            "user": {"uid": os.environ.get("VOLCENGINE_ASR_UID") or "content-board"},
            "audio": {
                "format": audio_format,
                "data": base64.b64encode(path.read_bytes()).decode("ascii"),
            },
            "request": {
                "model_name": "bigmodel",
                "enable_itn": True,
                "enable_punc": True,
                "show_utterances": False,
            },
        },
        ensure_ascii=False,
    )
    submit = _post_json(submit_url, headers, body, timeout)
    submit_code = _header(submit["headers"], "X-Api-Status-Code")
    if submit_code != "20000000":
        return "", "火山提交失败 %s %s：%s" % (
            submit.get("status", ""),
            submit_code,
            (_header(submit["headers"], "X-Api-Message") or submit.get("body", ""))[:240],
        )

    for attempt in range(max_attempts):
        if attempt:
            time.sleep(poll_interval)
        query = _post_json(query_url, headers, "{}", timeout)
        query_code = _header(query["headers"], "X-Api-Status-Code")
        if query_code in ("20000001", "20000002"):
            continue
        if query_code != "20000000":
            return "", "火山查询失败 %s %s：%s" % (
                query.get("status", ""),
                query_code,
                (_header(query["headers"], "X-Api-Message") or query.get("body", ""))[:240],
            )
        try:
            payload = json.loads(query.get("body") or "{}")
        except Exception:
            return "", "火山返回异常：" + (query.get("body") or "")[:240]
        text = _extract_text(payload)
        if text:
            return text, ""
        return "", "火山没有返回转写文本"

    return "", "火山转写任务查询超时"
