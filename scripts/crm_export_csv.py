import argparse
import asyncio
import json
from datetime import datetime
from pathlib import Path

from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from playwright.async_api import async_playwright


DEFAULT_URL = (
    "https://erp.changwankeji.com:8188/dist/index.html?v=1779969316"
    "#/crmexection/list?atype=one&ptype=0&menuid=670&path=crmexection/list"
)


async def visible_texts(page):
    texts = []
    for frame in page.frames:
        try:
            items = await frame.locator("button, a, [role=button], .el-button").evaluate_all(
                """els => els.slice(0, 160).map(e => ({
                    text: (e.innerText || e.textContent || '').trim(),
                    title: e.getAttribute('title') || '',
                    cls: String(e.className || '')
                })).filter(x => x.text || x.title)"""
            )
            texts.extend(items)
        except Exception:
            continue
    return texts[:80]


async def first_visible(frame, selectors):
    for selector in selectors:
        locator = frame.locator(selector).first
        try:
            if await locator.count() and await locator.is_visible(timeout=1000):
                return locator
        except Exception:
            continue
    return None


async def click_and_wait_download(page, locator, timeout):
    wait_timeout = min(timeout, 10000)
    try:
        async with page.expect_download(timeout=wait_timeout) as download_info:
            await locator.click(timeout=wait_timeout)
        return await download_info.value
    except PlaywrightTimeoutError:
        return None


async def try_export(page, timeout):
    export_selectors = [
        "button:has-text('导出')",
        "a:has-text('导出')",
        "[role=button]:has-text('导出')",
        ".el-button:has-text('导出')",
        ".vxe-button:has-text('导出')",
        "[class*=vxe-button]:has-text('导出')",
        "button:has-text('下载')",
        "a:has-text('下载')",
        ".vxe-button:has-text('下载')",
    ]
    confirm_selectors = [
        ".vxe-button:has-text('导出前2000条')",
        ".vxe-button:has-text('导出前1000条')",
        ".vxe-button:has-text('导出前500条')",
        ".vxe-button:has-text('导出当前页')",
        "[class*=vxe-button]:has-text('导出前2000条')",
        "[class*=vxe-button]:has-text('导出前1000条')",
        "[class*=vxe-button]:has-text('导出前500条')",
        "[class*=vxe-button]:has-text('导出当前页')",
        "button:has-text('确定')",
        "button:has-text('确认')",
        "button:has-text('开始导出')",
        ".el-button:has-text('确定')",
        ".el-button:has-text('确认')",
        ".vxe-button:has-text('确定')",
        ".vxe-button:has-text('确认')",
    ]
    for frame in page.frames:
        button = await first_visible(frame, export_selectors)
        if not button:
            continue
        download = await click_and_wait_download(page, button, timeout)
        if download:
            return download
        await page.wait_for_timeout(1200)
        for confirm_frame in page.frames:
            confirm = await first_visible(confirm_frame, confirm_selectors)
            if not confirm:
                continue
            download = await click_and_wait_download(page, confirm, timeout)
            if download:
                return download
    return None


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--download-dir", required=True)
    parser.add_argument("--chrome", default="C:/Program Files/Google/Chrome/Application/chrome.exe")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--timeout", type=int, default=60000)
    args = parser.parse_args()

    profile_dir = Path(args.profile).resolve()
    download_dir = Path(args.download_dir).resolve()
    profile_dir.mkdir(parents=True, exist_ok=True)
    download_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        try:
            context = await p.chromium.launch_persistent_context(
                str(profile_dir),
                headless=not args.headed,
                accept_downloads=True,
                executable_path=args.chrome,
                downloads_path=str(download_dir),
                args=["--disable-gpu", "--no-first-run"],
            )
        except Exception as exc:
            print(json.dumps({
                "ok": False,
                "profileBusy": True,
                "error": "CRM 自动化 Profile 正在被浏览器窗口占用；登录完成后请关闭该畅玩ERP窗口，再重新刷新数据",
                "detail": str(exc).splitlines()[0],
            }, ensure_ascii=True))
            return
        page = context.pages[0] if context.pages else await context.new_page()
        try:
            await page.goto(args.url, wait_until="domcontentloaded", timeout=args.timeout)
            await page.wait_for_timeout(6000)
            body = await page.locator("body").inner_text(timeout=10000)
            if "登录" in body and ("欢迎使用畅玩ERP" in body or "login" in page.url.lower()):
                print(json.dumps({
                    "ok": False,
                    "needLogin": True,
                    "error": "CRM 需要登录：请用投流看板的“CRM登录”打开的二维码完成登录，登录后等页面跳到达人执行效果列表，再点“登录后刷新数据”。",
                    "profile": str(profile_dir),
                    "url": page.url,
                    "title": await page.title(),
                }, ensure_ascii=True))
                return
            download = await try_export(page, args.timeout)
            if not download:
                print(json.dumps({
                    "ok": False,
                    "error": "没有在 CRM 页面找到可触发下载的导出按钮",
                    "url": page.url,
                    "title": await page.title(),
                    "buttons": await visible_texts(page),
                }, ensure_ascii=True))
                return
            suggested = download.suggested_filename or "达人执行效果列表.csv"
            suffix = Path(suggested).suffix or ".csv"
            filename = "达人执行效果列表-" + datetime.now().strftime("%Y%m%d-%H%M%S") + suffix
            target = download_dir / filename
            await download.save_as(str(target))
            print(json.dumps({
                "ok": True,
                "path": str(target),
                "name": target.name,
                "url": page.url,
                "title": await page.title(),
            }, ensure_ascii=True))
        finally:
            await context.close()


if __name__ == "__main__":
    asyncio.run(main())
