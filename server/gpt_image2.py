# -*- coding: utf-8 -*-
import base64
import http.client
import json
import mimetypes
import os
import ssl
import subprocess
import sys
import time
import tempfile
import urllib.error
import urllib.request

from env import load_env

load_env()

ctx = ssl.create_default_context()
if hasattr(ssl, "OP_IGNORE_UNEXPECTED_EOF"):
    ctx.options |= ssl.OP_IGNORE_UNEXPECTED_EOF
BASE_URL = (
    os.environ.get("SUB2API_BASE_URL")
    or os.environ.get("GPT_IMAGE2_BASE_URL")
    or "https://geekai.live/v1"
).rstrip("/")
MODEL = os.environ.get("GPT_IMAGE2_MODEL") or os.environ.get("IMAGE_MODEL") or "gpt-image-2"
REQUEST_TIMEOUT = int(os.environ.get("GPT_IMAGE2_TIMEOUT_SEC") or "240")
MAX_RETRIES = int(os.environ.get("GPT_IMAGE2_MAX_RETRIES") or "3")
RETRY_HTTP_CODES = {429, 502, 503, 504}


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
        return str(message)[:800]
    except Exception:
        try:
            return error.read().decode("utf-8", errors="replace")[:800]
        except Exception:
            return str(error)


def multipart_field(boundary, name, value):
    return (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
        f"{value}\r\n"
    ).encode("utf-8")


def multipart_file(boundary, name, filename, content_type, data):
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode("utf-8")
    return header + data + b"\r\n"


def build_edit_request(base_url, prompt, images, size, headers, quality, background=None, output_format=None):
    boundary = "----UsagiImageBoundary" + os.urandom(16).hex()
    chunks = [
        multipart_field(boundary, "model", MODEL),
        multipart_field(boundary, "prompt", prompt),
        multipart_field(boundary, "size", size),
        multipart_field(boundary, "quality", quality),
        multipart_field(boundary, "response_format", "b64_json"),
    ]
    if background:
        chunks.append(multipart_field(boundary, "background", background))
    if output_format:
        chunks.append(multipart_field(boundary, "output_format", output_format))
    for image in images:
        img_data = base64.b64decode(image["base64"], validate=False)
        chunks.append(multipart_file(boundary, "image", image["name"], image["mime"], img_data))
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(chunks)
    return urllib.request.Request(
        base_url + "/images/edits",
        data=body,
        headers={
            **headers,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Content-Length": str(len(body)),
            "User-Agent": "UsagiWorkspace/1.0",
        },
    )


def build_generation_request(base_url, prompt, size, headers, quality, background=None, output_format=None):
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "size": size,
        "quality": quality,
        "n": 1,
        "response_format": "b64_json",
    }
    if background:
        payload["background"] = background
    if output_format:
        payload["output_format"] = output_format
    data = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    return urllib.request.Request(
        base_url + "/images/generations",
        data=data,
        headers={
            **headers,
            "Content-Type": "application/json",
            "Content-Length": str(len(data)),
            "User-Agent": "UsagiWorkspace/1.0",
        },
    )


def parse_image_response(raw, base_url, proxy, ssl_verify):
    result = json.loads(raw)
    images_out = [item.get("b64_json", "") for item in result.get("data", []) if item.get("b64_json")]
    if images_out:
        return {
            "url": "data:image/png;base64," + images_out[0],
            "count": len(images_out),
            "created": result.get("created"),
            "usage": result.get("usage"),
            "revised_prompt": (result.get("data") or [{}])[0].get("revised_prompt", ""),
            "provider_base_url": base_url,
            "provider_proxy": bool(proxy),
            "ssl_verify": ssl_verify,
        }
    urls = [item.get("url", "") for item in result.get("data", []) if item.get("url")]
    if urls:
        return {
            "url": urls[0],
            "count": len(urls),
            "created": result.get("created"),
            "usage": result.get("usage"),
            "provider_base_url": base_url,
            "provider_proxy": bool(proxy),
            "ssl_verify": ssl_verify,
        }
    return {"error": "no image in response", "raw": raw[:800]}


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


def request_with_curl(base_url, key, prompt, images, size, quality, background, output_format, timeout, proxy, ssl_verify):
    temp_files = []
    out_file = None
    try:
        args = [
            "curl.exe",
            "-sS",
            "--connect-timeout",
            "30",
            "--max-time",
            str(max(60, int(timeout))),
            "-X",
            "POST",
            base_url + ("/images/edits" if images else "/images/generations"),
            "-H",
            "Authorization: Bearer " + key,
        ]
        if proxy:
            args.extend(["-x", proxy])
        if not ssl_verify:
            args.append("-k")
        out_fd, out_file = tempfile.mkstemp(prefix="gpt_image2_curl_", suffix=".json")
        os.close(out_fd)
        args.extend(["-o", out_file])

        if images:
            args.extend([
                "-F", "model=" + MODEL,
                "-F", "prompt=" + prompt,
                "-F", "size=" + size,
                "-F", "quality=" + quality,
                "-F", "response_format=b64_json",
            ])
            if background:
                args.extend(["-F", "background=" + str(background)])
            if output_format:
                args.extend(["-F", "output_format=" + str(output_format)])
            for index, image in enumerate(images):
                suffix = mimetypes.guess_extension(image.get("mime") or "image/png") or ".png"
                fd, image_path = tempfile.mkstemp(prefix="gpt_image2_ref_", suffix=suffix)
                os.close(fd)
                with open(image_path, "wb") as f:
                    f.write(base64.b64decode(image["base64"], validate=False))
                temp_files.append(image_path)
                args.extend(["-F", f"image=@{image_path};type={image.get('mime') or 'image/png'}"])
        else:
            payload = {
                "model": MODEL,
                "prompt": prompt,
                "size": size,
                "quality": quality,
                "n": 1,
                "response_format": "b64_json",
            }
            if background:
                payload["background"] = background
            if output_format:
                payload["output_format"] = output_format
            args.extend(["-H", "Content-Type: application/json", "-d", json.dumps(payload, ensure_ascii=True)])

        completed = subprocess.run(args, capture_output=True, text=True, timeout=max(90, int(timeout) + 20))
        raw = ""
        if out_file and os.path.exists(out_file):
            with open(out_file, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read()
        parsed = parse_image_response(raw, base_url, proxy, ssl_verify) if raw else {"error": ""}
        if completed.returncode != 0 and not parsed.get("url"):
            detail = (completed.stderr or completed.stdout or raw or "").strip()
            return {"error": detail[:800] or ("curl exited with code " + str(completed.returncode))}
        return parsed
    finally:
        for file_path in temp_files:
            try:
                os.unlink(file_path)
            except Exception:
                pass
        if out_file:
            try:
                os.unlink(out_file)
            except Exception:
                pass


def generate(prompt, image_base64=None, size="1024x1024", api_key=None, max_retries=None, options=None):
    key = api_key or os.environ.get("GPT_IMAGE2_KEY") or os.environ.get("IMAGE_API_KEY") or ""
    if not key:
        emit({"error": "GPT_IMAGE2_KEY not configured"})
        return

    options = options or {}
    headers = {"Authorization": "Bearer " + key}
    base_url = str(options.get("base_url") or BASE_URL).rstrip("/")
    if "proxy" in options and options.get("proxy") is not None:
        proxy = str(options.get("proxy") or "").strip()
    else:
        proxy = str(os.environ.get("GPT_IMAGE2_PROXY") or "").strip()
    ssl_verify = str(options.get("ssl_verify") if options.get("ssl_verify") is not None else os.environ.get("GPT_IMAGE2_SSL_VERIFY", "true")).lower() not in {"0", "false", "no", "off"}
    quality = str(options.get("quality") or os.environ.get("GPT_IMAGE2_QUALITY") or "auto")
    background = options.get("background") or ""
    output_format = options.get("output_format") or ""
    images = normalize_image_inputs(image_base64)

    if max_retries is None:
        max_retries = MAX_RETRIES
    last_error = ""

    for attempt in range(max_retries):
        try:
            if images:
                if proxy:
                    result = request_with_curl(base_url, key, prompt, images, size, quality, background, output_format, REQUEST_TIMEOUT, proxy, ssl_verify)
                    if result.get("error"):
                        raise RuntimeError(result.get("error"))
                    emit(result)
                    return
                req = build_edit_request(base_url, prompt, images, size, headers, quality, background, output_format)
            else:
                req = build_generation_request(base_url, prompt, size, headers, quality, background, output_format)

            with open_request(req, REQUEST_TIMEOUT, proxy, ssl_verify) as resp:
                raw = resp.read().decode("utf-8")
                emit(parse_image_response(raw, base_url, proxy, ssl_verify))
                return

        except urllib.error.HTTPError as error:
            detail = parse_error_body(error)
            last_error = f"HTTP {error.code}: {detail}"
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if error.code in RETRY_HTTP_CODES and attempt < max_retries - 1:
                time.sleep(min(8, 2**attempt))
                continue
            break
        except (http.client.RemoteDisconnected, ConnectionResetError, TimeoutError, urllib.error.URLError) as error:
            reason = getattr(error, "reason", None)
            last_error = str(reason or error)
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if attempt < max_retries - 1:
                time.sleep(min(8, 2**attempt))
                continue
            break
        except Exception as error:
            last_error = str(error)
            print(f"attempt {attempt + 1}/{max_retries} failed: {last_error}", file=sys.stderr, flush=True)
            if attempt < max_retries - 1:
                time.sleep(min(8, 2**attempt))
                continue
            break

    emit({"error": last_error or "GPT-Image2 request failed"})


if __name__ == "__main__":
    if len(sys.argv) < 2:
        emit({"error": "no params file"})
        sys.exit(0)
    try:
        with open(sys.argv[1], "r", encoding="utf-8-sig") as f:
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
                "background": params.get("background"),
                "output_format": params.get("output_format"),
                "base_url": params.get("base_url"),
                "proxy": params.get("proxy"),
                "ssl_verify": params.get("ssl_verify"),
            },
        )
    except Exception as e:
        emit({"error": str(e)})
