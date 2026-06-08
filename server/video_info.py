# -*- coding: utf-8 -*-
"""创意看板用：轻量获取视频标题（Playwright渲染 + 复用现有工具）"""
import sys, os, json, subprocess

from bilibili_cli_bridge import error_message, extract_bvid, parse_json_output, run_bili

# 强制 UTF-8 输出
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BILI_CLI_CRED = os.path.expanduser('~/.bilibili-cli/credential.json')

def run_cmd(cmd, timeout=30):
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONLEGACYWINDOWSSTDIO": "utf-8"}
    try:
        r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=timeout, env=env)
        return r.returncode, r.stdout.decode("utf-8", errors="replace"), r.stderr.decode("utf-8", errors="replace")
    except Exception as e:
        return -1, "", str(e)

def get_douyin_title(url):
    """用 Playwright 渲染页面后提取标题（处理客户端渲染）"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {"error": "未安装 playwright，请运行: pip install playwright && playwright install chromium"}

    try:
        with sync_playwright() as p:
            executable = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE")
            launch_options = {"headless": True}
            if executable and os.path.exists(executable):
                launch_options["executable_path"] = executable
            browser = p.chromium.launch(**launch_options)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
            )
            page = context.new_page()
            page.goto(url, timeout=15000, wait_until="domcontentloaded")
            page.wait_for_timeout(3000)  # 等待JS渲染

            title = page.title()

            # 尝试从 og:title 获取更完整标题
            og_title = page.evaluate('''() => {
                const el = document.querySelector('meta[property="og:title"]');
                return el ? el.content : '';
            }''')

            desc = page.evaluate('''() => {
                const el = document.querySelector('meta[property="og:description"]');
                return el ? el.content : '';
            }''')

            browser.close()

            final_title = og_title.strip() if og_title.strip() else title.strip()
            if not final_title or final_title == "抖音":
                final_title = "抖音视频"

            return {"title": final_title, "description": desc.strip()[:200], "platform": "douyin"}
    except Exception as e:
        return {"error": "Playwright解析失败: " + str(e)[:80], "platform": "douyin"}

def get_bilibili_info(url):
    """用项目内 bilibili-cli 拿标题，fallback yt-dlp"""
    bvid = extract_bvid(url)

    # 方法1: bilibili-cli（包含标题）
    if bvid:
        result = run_bili(["video", bvid, "--json"], timeout=30)
        if result.get("ok"):
            data = parse_json_output(result.get("stdout", ""))
            if data.get("ok"):
                video_data = data.get("data", {}).get("video", {})
                title = video_data.get("title", "")
                if title:
                    return {"title": title, "description": "", "platform": "bilibili", "bvid": bvid}
        elif result.get("setup_required"):
            return {"error": error_message(result), "platform": "bilibili", "bvid": bvid}

    # 方法2: yt-dlp（不需要cookie）
    code, out, _ = run_cmd(["yt-dlp", "--print", "%(title)s", "--no-download", "--", url], timeout=20)
    if code == 0 and out.strip():
        return {"title": out.strip(), "description": "", "platform": "bilibili"}

    return {"error": "无法获取B站标题", "platform": "bilibili"}

def main():
    tmp = sys.argv[1] if len(sys.argv) > 1 else ""
    body = {}
    url = ""
    if tmp and os.path.exists(tmp):
        try:
            raw = open(tmp, "r", encoding="utf-8").read()
            body = json.loads(raw)
            url = (body.get("params", body) or {}).get("url", "")
        except Exception:
            url = ""

    if not url:
        print(json.dumps({"error": "url required"}, ensure_ascii=False))
        return

    is_bilibili = "bilibili.com" in url or "b23.tv" in url
    result = get_bilibili_info(url) if is_bilibili else get_douyin_title(url)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
