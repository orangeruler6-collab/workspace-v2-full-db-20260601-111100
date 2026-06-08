# -*- coding: utf-8 -*-
import base64
import http.client
import json
import mimetypes
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

from env import load_env

load_env()

ctx = ssl.create_default_context()
BASE_URL = (
    os.environ.get("SUB2API_BASE_URL")
    or os.environ.get("GPT_IMAGE2_BASE_URL")
    or "https://geekai.live/v1"
).rstrip("/")
IMAGE_MODEL = os.environ.get("GPT_IMAGE2_MODEL") or os.environ.get("IMAGE_MODEL") or "gpt-image-2"
TEXT_MODEL = os.environ.get("GPT_IMAGE2_TEXT_MODEL") or os.environ.get("FHL_DEFAULT_MODEL") or "gpt-5.5"
REQUEST_TIMEOUT = int(os.environ.get("GPT_IMAGE2_TIMEOUT_SEC") or "240")
MAX_RETRIES = int(os.environ.get("GPT_IMAGE2_MAX_RETRIES") or "3")
RETRY_HTTP_CODES = {429, 502, 503, 504}
NO_PROMPT_REVISION = "You are a tool runner. Pass the user prompt to image_generation VERBATIM. DO NOT rewrite, expand, polish, or revise it in any way. Use the exact text the user gave."


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def clean_base64_image(value):
    text = value.decode("utf-8", errors="ignore") if isinstance(value, bytes) else str(value or "")
    text = text.strip()
    if "," in text and text.lower().startswith("data:"):
        text = text.split(",", 1)[1]
    return text.strip()


def normalize_image_inputs(value):
    if not value:
        return []
    raw_items = value if isinstance(value, list) else [value]
    images = []
    for index, item in enumerate(raw_items):
        mime = "image/png"
        name = "reference_%s.png" % (index + 1)
        data = item
        if isinstance(item, dict):
            data = (
                item.get("base64")
                or item.get("image_base64")
                or item.get("image")
                or item.get("data")
                or ""
            )
            mime = item.get("mime") or item.get("mime_type") or item.get("type") or mime
            name = item.get("name") or item.get("filename") or name
        cleaned = clean_base64_image(data)
        if not cleaned:
            continue
        if not str(mime).startswith("image/"):
            guessed = mimetypes.guess_type(str(name))[0]
            mime = guessed if guessed and guessed.startswith("image/") else "image/png"
        images.append({"base64": cleaned, "mime": mime, "name": name})
    return images[:8]


def parse_error_body(error):
    try:
        raw = error.read().decode("utf-8", errors="replace")
        data = json.loads(raw)
        message = data.get("error") or data.get("message") or data
        if isinstance(message, dict):
            message = message.get("message") or json.dumps(message, ensure_ascii=False)
        return str(message)[:1200]
    except Exception:
        try:
            return error.read().decode("utf-8", errors="replace")[:1200]
        except Exception:
            return str(error)


def open_request(req, timeout, proxy="", ssl_verify=True):
    proxy = str(proxy or "").strip()
    context = ctx if ssl_verify else ssl._create_unverified_context()
    https_handler = urllib.request.HTTPSHandler(context=context)
    if proxy:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": proxy, "https": proxy}),
            https_handler,
        )
    else:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), https_handler)
    return opener.open(req, timeout=timeout)


def data_url(image):
    return "data:%s;base64,%s" % (image.get("mime") or "image/png", image["base64"])


def build_responses_request(base_url, prompt, images, headers, quality="auto", size="1024x1024", output_format="png"):
    content = [{"type": "input_text", "text": str(prompt or "").strip()}]
    for image in images:
        content.append({"type": "input_image", "image_url": data_url(image)})
    payload = {
        "model": TEXT_MODEL,
        "instructions": NO_PROMPT_REVISION,
        "input": [{"role": "user", "content": content}],
        "tools": [{
            "type": "image_generation",
            "model": IMAGE_MODEL,
            "action": "edit" if images else "generate",
            "size": size,
            "quality": quality or "auto",
            "output_format": output_format or "png",
            "moderation": "low",
            "partial_images": 1,
        }],
        "tool_choice": {"type": "image_generation"},
        "reasoning": {"effort": "xhigh"},
        "store": False,
        "stream": True,
    }
    data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    return urllib.request.Request(
        base_url + "/responses",
        data=data,
        headers={
            **headers,
            "Content-Type": "application/json",
            "Accept": "text/event-stream, application/json",
            "Content-Length": str(len(data)),
            "User-Agent": "UsagiWorkspace/1.0",
        },
    )


def find_result(payload):
    if isinstance(payload, dict):
        item = payload.get("item")
        if isinstance(item, dict):
            result = item.get("result")
            if result:
                return result, item.get("revised_prompt", "")
        for value in payload.values():
            found = find_result(value)
            if found:
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = find_result(value)
            if found:
                return found
    return None


def describe_sse_error(payload):
    if not isinstance(payload, dict):
        return ""
    if payload.get("error"):
        return json.dumps(payload.get("error"), ensure_ascii=False)[:1200]
    response = payload.get("response")
    if isinstance(response, dict) and response.get("error"):
        return json.dumps(response.get("error"), ensure_ascii=False)[:1200]
    return ""


def generate(prompt, image_base64=None, size="1024x1024", api_key=None, max_retries=None, options=None):
    key = api_key or os.environ.get("GPT_IMAGE2_KEY") or os.environ.get("IMAGE_API_KEY") or ""
    if not key:
        emit({"error": "GPT_IMAGE2_KEY not configured"})
        return

    options = options or {}
    headers = {"Authorization": "Bearer " + key}
    base_url = str(options.get("base_url") or BASE_URL).rstrip("/")
    proxy = str(options.get("proxy") or os.environ.get("GPT_IMAGE2_PROXY") or "").strip()
    ssl_verify = str(options.get("ssl_verify") if options.get("ssl_verify") is not None else os.environ.get("GPT_IMAGE2_SSL_VERIFY", "true")).lower() not in {"0", "false", "no", "off"}
    quality = str(options.get("quality") or os.environ.get("GPT_IMAGE2_QUALITY") or "auto")
    output_format = str(options.get("output_format") or "png")
    images = normalize_image_inputs(image_base64)

    if max_retries is None:
        max_retries = MAX_RETRIES
    last_error = ""

    for attempt in range(max_retries):
        try:
            req = build_responses_request(base_url, prompt, images, headers, quality=quality, size=size, output_format=output_format)
            with open_request(req, REQUEST_TIMEOUT, proxy, ssl_verify) as resp:
                revised_prompt = ""
                with_result = ""
                raw_preview = []
                while True:
                    line = resp.readline()
                    if not line:
                        break
                    text = line.decode("utf-8", errors="replace").strip()
                    if not text or not text.startswith("data:"):
                        continue
                    payload_text = text[5:].strip()
                    if not payload_text or payload_text == "[DONE]":
                        continue
                    if len(raw_preview) < 30:
                        raw_preview.append(payload_text[:240])
                    try:
                        payload = json.loads(payload_text)
                    except Exception:
                        continue
                    maybe_error = describe_sse_error(payload)
                    if maybe_error:
                        last_error = maybe_error
                    found = find_result(payload)
                    if found:
                        with_result, revised_prompt = found
                        break
                if with_result:
                    emit({
                        "url": "data:image/png;base64," + with_result,
                        "count": 1,
                        "created": int(time.time()),
                        "usage": None,
                        "revised_prompt": revised_prompt or "",
                        "provider_base_url": base_url,
                        "provider_proxy": bool(proxy),
                        "ssl_verify": ssl_verify,
                        "transport": "responses",
                    })
                    return
                emit({"error": last_error or "responses stream finished without image result", "raw": "\n".join(raw_preview[:10])[:1200]})
                return
        except urllib.error.HTTPError as error:
            detail = parse_error_body(error)
            last_error = f"HTTP {error.code}: {detail}"
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if error.code in RETRY_HTTP_CODES and attempt < max_retries - 1:
                time.sleep(min(8, 2 ** attempt))
                continue
            break
        except (http.client.RemoteDisconnected, ConnectionResetError, TimeoutError, urllib.error.URLError) as error:
            reason = getattr(error, "reason", None)
            last_error = str(reason or error)
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if attempt < max_retries - 1:
                time.sleep(min(8, 2 ** attempt))
                continue
            break
        except Exception as error:
            last_error = str(error)
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if attempt < max_retries - 1:
                time.sleep(min(8, 2 ** attempt))
                continue
            break

    emit({"error": last_error or "GPT-Image2 responses request failed"})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        emit({"error": "no params file"})
        sys.exit(0)
    try:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            wrapper = json.load(f)
        params = wrapper.get("params", wrapper)
        prompt = params.get("prompt", "")
        image_input = (
            params.get("image_base64_list")
            or params.get("images")
            or params.get("reference_images")
            or params.get("image_base64")
            or params.get("image")
            or ""
        )
        size = params.get("size", "1024x1024")
        key = params.get("key", "")
        max_retries_raw = params.get("max_retries")
        try:
            max_retries = int(max_retries_raw) if max_retries_raw not in (None, "") else None
        except Exception:
            max_retries = None
        generate(
            prompt,
            image_input,
            size,
            key,
            max_retries=max_retries,
            options={
                "quality": params.get("quality"),
                "output_format": params.get("output_format"),
                "base_url": params.get("base_url"),
                "proxy": params.get("proxy"),
                "ssl_verify": params.get("ssl_verify"),
            },
        )
    except Exception as e:
        emit({"error": str(e)})
