import argparse
import asyncio
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

from playwright.async_api import async_playwright


DEFAULT_URL = (
    "https://erp.changwankeji.com:8188/dist/index.html?v=1779969316"
    "#/crmexection/list?atype=one&ptype=0&menuid=670&path=crmexection/list"
)


def wait_for_cdp(port, timeout=12):
    deadline = time.time() + timeout
    url = f"http://127.0.0.1:{port}/json/version"
    while time.time() < deadline:
        try:
            with urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.35)
    return False


async def capture(args):
    profile_dir = Path(args.profile).resolve()
    screenshot_path = Path(args.screenshot).resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)

    chrome_args = [
        args.chrome,
        f"--remote-debugging-port={args.port}",
        f"--user-data-dir={profile_dir}",
        "--profile-directory=Default",
        "--no-first-run",
        "--disable-default-apps",
        "--disable-gpu",
        args.url,
    ]
    creationflags = 0
    if hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        creationflags |= subprocess.CREATE_NEW_PROCESS_GROUP
    if hasattr(subprocess, "DETACHED_PROCESS"):
        creationflags |= subprocess.DETACHED_PROCESS
    try:
        subprocess.Popen(
            chrome_args,
            cwd=str(Path.cwd()),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=creationflags,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    if not wait_for_cdp(args.port, args.timeout):
        return {"ok": False, "error": "Chrome remote debugging endpoint did not start"}

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(f"http://127.0.0.1:{args.port}")
        context = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = context.pages[0] if context.pages else await context.new_page()
        await page.set_viewport_size({"width": args.width, "height": args.height})
        try:
            if args.url not in page.url:
                await page.goto(args.url, wait_until="domcontentloaded", timeout=args.nav_timeout)
            await page.wait_for_timeout(args.wait_ms)
            await page.screenshot(path=str(screenshot_path), full_page=False)
            body = ""
            try:
                body = await page.locator("body").inner_text(timeout=3000)
            except Exception:
                body = ""
            need_login = any(token in body for token in ["登录", "扫码", "验证码"]) or "login" in page.url.lower()
            result = {
                "ok": True,
                "path": str(screenshot_path),
                "url": page.url,
                "title": await page.title(),
                "needLogin": need_login,
                "port": args.port,
            }
            # Do not close the Chrome process. The QR session must stay alive while the user scans it.
            return result
        finally:
            # Intentionally do not call browser.close(); for CDP this can close Chrome.
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--screenshot", required=True)
    parser.add_argument("--chrome", default="C:/Program Files/Google/Chrome/Application/chrome.exe")
    parser.add_argument("--port", type=int, default=9223)
    parser.add_argument("--width", type=int, default=1365)
    parser.add_argument("--height", type=int, default=900)
    parser.add_argument("--timeout", type=int, default=12)
    parser.add_argument("--nav-timeout", type=int, default=60000)
    parser.add_argument("--wait-ms", type=int, default=3500)
    args = parser.parse_args()
    print(json.dumps(asyncio.run(capture(args)), ensure_ascii=True))


if __name__ == "__main__":
    main()
