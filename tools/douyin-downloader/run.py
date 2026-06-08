#!/usr/bin/env python3
"""
抖音无水印视频下载和文案提取工具

功能:
1. 从抖音分享链接获取无水印视频下载链接
2. 下载视频并提取音频
3. 使用硅基流动 API 从音频中提取文本
4. 自动保存文案到文件 (一个视频一个文件夹)

环境变量:
- API_KEY: 硅基流动 API 密钥 (用于文案提取功能)

使用示例:
  # 获取下载链接 (无需 API 密钥)
  python douyin_downloader.py --link "抖音分享链接" --action info

  # 下载视频
  python douyin_downloader.py --link "抖音分享链接" --action download --output ./videos

  # 提取文案并保存到文件 (需要 API_KEY 环境变量)
  python douyin_downloader.py --link "抖音分享链接" --action extract --output ./output
"""

import os
import re
import sys
import json
import argparse
import tempfile
import shutil
from pathlib import Path
from typing import Optional
from datetime import datetime


def pick_best_play_addr(video: dict) -> dict:
    bit_rates = video.get("bit_rate") if isinstance(video, dict) else None
    best = None
    best_score = -1
    if isinstance(bit_rates, list):
        for item in bit_rates:
            if not isinstance(item, dict):
                continue
            play_addr = item.get("play_addr")
            if not isinstance(play_addr, dict):
                continue
            if not any(play_addr.get("url_list") or []):
                continue
            try:
                bit_rate = int(item.get("bit_rate") or 0)
            except (TypeError, ValueError):
                bit_rate = 0
            try:
                width = int(play_addr.get("width") or item.get("width") or 0)
                height = int(play_addr.get("height") or item.get("height") or 0)
            except (TypeError, ValueError):
                width = 0
                height = 0
            score = bit_rate * 100000000 + width * height
            if score > best_score:
                best_score = score
                best = play_addr
    return best or video.get("play_addr", {})


def collect_play_addrs_by_quality(video: dict) -> list:
    play_addrs = []
    bit_rates = video.get("bit_rate") if isinstance(video, dict) else None
    if isinstance(bit_rates, list):
        for item in bit_rates:
            if not isinstance(item, dict):
                continue
            play_addr = item.get("play_addr")
            if not isinstance(play_addr, dict):
                continue
            if not any(play_addr.get("url_list") or []):
                continue
            try:
                bit_rate = int(item.get("bit_rate") or 0)
            except (TypeError, ValueError):
                bit_rate = 0
            try:
                width = int(play_addr.get("width") or item.get("width") or 0)
                height = int(play_addr.get("height") or item.get("height") or 0)
            except (TypeError, ValueError):
                width = 0
                height = 0
            play_addrs.append((bit_rate * 100000000 + width * height, play_addr))

    play_addrs.sort(key=lambda item: item[0], reverse=True)
    ordered = []
    seen = set()
    for _, play_addr in play_addrs:
        key = json.dumps(play_addr, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            seen.add(key)
            ordered.append(play_addr)

    fallback = video.get("play_addr") if isinstance(video, dict) else None
    if isinstance(fallback, dict):
        key = json.dumps(fallback, sort_keys=True, ensure_ascii=False)
        if key not in seen:
            ordered.append(fallback)
    return ordered


def build_video_url_candidates(video: dict, quality: str = "best") -> list:
    quality = str(quality or "best").strip().lower()
    candidates = []
    seen = set()
    deferred = []
    deferred_seen = set()

    def add(url, bucket=None):
        if not url:
            return
        url = str(url).strip()
        if not url:
            return
        if bucket == "deferred":
            if url not in seen and url not in deferred_seen:
                deferred_seen.add(url)
                deferred.append(url)
            return
        if url not in seen:
            seen.add(url)
            candidates.append(url)

    def url_height(url):
        text = str(url or "").lower()
        if "1080" in text:
            return 1080
        if "720" in text:
            return 720
        return 0

    for play_addr in collect_play_addrs_by_quality(video):
        width = int(play_addr.get("width") or 0)
        height = int(play_addr.get("height") or 0)
        bucket = None
        short_edge = min(width, height) if width and height else max(width, height)
        if quality == "720" and short_edge > 720:
            bucket = "deferred"
        for url in play_addr.get("url_list") or []:
            url_bucket = bucket
            if quality == "720" and url_height(url) > 720:
                url_bucket = "deferred"
            add(url.replace("playwm", "play"), url_bucket)
            add(url, url_bucket)

    play_addr = pick_best_play_addr(video)
    uri = (
        play_addr.get("uri")
        or video.get("vid")
        or video.get("download_addr", {}).get("uri")
    )
    if uri:
        if quality == "720":
            add(f"https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=720p&line=0&is_play_url=1&watermark=0")
            add(f"https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0&is_play_url=1&watermark=0", "deferred")
        else:
            add(f"https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=1080p&line=0&is_play_url=1&watermark=0")
            add(f"https://aweme.snssdk.com/aweme/v1/play/?video_id={uri}&ratio=720p&line=0&is_play_url=1&watermark=0")

    for url in deferred:
        if url not in seen:
            seen.add(url)
            candidates.append(url)
    if quality == "1080":
        preferred = [url for url in candidates if "ratio=1080p" in url.lower()]
        others = [url for url in candidates if "ratio=1080p" not in url.lower()]
        candidates = preferred + others
    return candidates


def check_dependencies():
    """检查必要的依赖是否已安装"""
    missing = []
    try:
        import requests
    except ImportError:
        missing.append("requests")
    try:
        import ffmpeg
    except ImportError:
        missing.append("ffmpeg-python")

    if missing:
        print(f"缺少依赖: {', '.join(missing)}")
        print(f"请运行: pip install {' '.join(missing)}")
        sys.exit(1)


check_dependencies()

import requests
import ffmpeg

# 请求头，模拟移动端访问
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1'
}

# 硅基流动 API 配置
DEFAULT_API_BASE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
DEFAULT_MODEL = "FunAudioLLM/SenseVoiceSmall"


class DouyinProcessor:
    """抖音视频处理器"""

    def __init__(self, api_key: str = "", api_base_url: Optional[str] = None, model: Optional[str] = None):
        self.api_key = api_key
        self.api_base_url = api_base_url or DEFAULT_API_BASE_URL
        self.model = model or DEFAULT_MODEL
        self.temp_dir = Path(tempfile.mkdtemp())

    def __del__(self):
        """清理临时目录"""
        if hasattr(self, 'temp_dir') and self.temp_dir.exists():
            shutil.rmtree(self.temp_dir, ignore_errors=True)

    def parse_share_url(self, share_text: str, quality: str = "best") -> dict:
        """从分享文本中提取无水印视频链接"""
        # 提取分享链接
        urls = re.findall(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\(\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', share_text)
        if not urls:
            raise ValueError("未找到有效的分享链接")

        share_url = urls[0]
        share_response = requests.get(share_url, headers=HEADERS)
        video_id = share_response.url.split("?")[0].strip("/").split("/")[-1]
        share_url = f'https://www.iesdouyin.com/share/video/{video_id}'

        # 获取视频页面内容
        response = requests.get(share_url, headers=HEADERS)
        response.raise_for_status()

        pattern = re.compile(
            pattern=r"window\._ROUTER_DATA\s*=\s*(.*?)</script>",
            flags=re.DOTALL,
        )
        find_res = pattern.search(response.text)

        if not find_res or not find_res.group(1):
            raise ValueError("从HTML中解析视频信息失败")

        # 解析JSON数据
        json_data = json.loads(find_res.group(1).strip())
        VIDEO_ID_PAGE_KEY = "video_(id)/page"
        NOTE_ID_PAGE_KEY = "note_(id)/page"

        if VIDEO_ID_PAGE_KEY in json_data["loaderData"]:
            original_video_info = json_data["loaderData"][VIDEO_ID_PAGE_KEY]["videoInfoRes"]
        elif NOTE_ID_PAGE_KEY in json_data["loaderData"]:
            original_video_info = json_data["loaderData"][NOTE_ID_PAGE_KEY]["videoInfoRes"]
        else:
            raise Exception("无法从JSON中解析视频或图集信息")

        data = original_video_info["item_list"][0]
        author = data.get("author") if isinstance(data.get("author"), dict) else {}
        author_name = (
            author.get("nickname")
            or author.get("name")
            or author.get("unique_id")
            or author.get("short_id")
            or ""
        )

        # 获取视频信息
        video_urls = build_video_url_candidates(data.get("video", {}), quality)
        if not video_urls:
            raise ValueError("No downloadable video URL found")
        video_url = video_urls[0]
        desc = data.get("desc", "").strip() or f"douyin_{video_id}"

        # 替换文件名中的非法字符
        desc = re.sub(r'[\\/:*?"<>|]', '_', desc)

        return {
            "url": video_url,
            "url_candidates": video_urls,
            "title": desc,
            "video_id": video_id,
            "author": str(author_name).strip()
        }

    def download_video(self, video_info: dict, output_dir: Optional[Path] = None, show_progress: bool = True) -> Path:
        """Download the video, trying all candidate URLs from highest quality down."""
        if output_dir is None:
            output_dir = self.temp_dir
        else:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)

        filename = f"{video_info['video_id']}.mp4"
        filepath = output_dir / filename

        if show_progress:
            print(f"Downloading video: {video_info['title']}")

        urls = video_info.get("url_candidates") or [video_info["url"]]
        last_error = None
        for index, url in enumerate(urls):
            try:
                if show_progress and index > 0:
                    print(f"\nTrying fallback video URL {index + 1}/{len(urls)}...")

                response = requests.get(url, headers=HEADERS, stream=True, timeout=60)
                response.raise_for_status()

                total_size = int(response.headers.get('content-length', 0))
                downloaded = 0
                with open(filepath, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            if show_progress and total_size > 0:
                                progress = downloaded / total_size * 100
                                print(f"\rDownload progress: {progress:.1f}%", end="", flush=True)

                if filepath.stat().st_size <= 0:
                    raise RuntimeError("Downloaded file is empty")

                if show_progress:
                    print(f"\nVideo downloaded: {filepath}")
                return filepath
            except Exception as e:
                last_error = e
                try:
                    if filepath.exists():
                        filepath.unlink()
                except OSError:
                    pass

        raise Exception(f"Video download failed after trying {len(urls)} URLs: {last_error}")

    def extract_audio(self, video_path: Path, show_progress: bool = True) -> Path:
        """Extract MP3 audio from a video file."""
        audio_path = video_path.with_suffix('.mp3')
        if show_progress:
            print("Extracting audio...")
        try:
            (
                ffmpeg
                .input(str(video_path))
                .output(str(audio_path), acodec='libmp3lame', q=0)
                .run(capture_stdout=True, capture_stderr=True, overwrite_output=True)
            )
            if show_progress:
                print(f"Audio extracted: {audio_path}")
            return audio_path
        except Exception as e:
            raise Exception(f"Audio extraction failed: {e}")

    def get_audio_info(self, audio_path: Path) -> dict:
        """Return audio duration and size."""
        try:
            probe = ffmpeg.probe(str(audio_path))
            duration = float(probe['format'].get('duration', 0))
            size = audio_path.stat().st_size
            return {'duration': duration, 'size': size}
        except Exception:
            return {'duration': 0, 'size': audio_path.stat().st_size}

    def split_audio(self, audio_path: Path, segment_duration: int = 600, show_progress: bool = True) -> list:
        """Split long audio into smaller MP3 segments."""
        audio_info = self.get_audio_info(audio_path)
        duration = audio_info['duration']
        if duration <= segment_duration:
            return [audio_path]

        segments = []
        segment_index = 0
        current_time = 0
        if show_progress:
            total_segments = int(duration / segment_duration) + 1
            print(f"Audio duration {duration:.0f}s, splitting into {total_segments} segments...")

        while current_time < duration:
            segment_path = self.temp_dir / f"segment_{segment_index}.mp3"
            try:
                (
                    ffmpeg
                    .input(str(audio_path), ss=current_time, t=segment_duration)
                    .output(str(segment_path), acodec='libmp3lame', q=2)
                    .run(capture_stdout=True, capture_stderr=True, overwrite_output=True)
                )
                segments.append(segment_path)
                segment_index += 1
                current_time += segment_duration
            except Exception as e:
                raise Exception(f"Audio split failed: {e}")
        return segments

    def extract_text_from_audio(self, audio_path: Path, show_progress: bool = True) -> str:
        """Transcribe audio with the configured SiliconFlow-compatible endpoint."""
        if not self.api_key:
            raise ValueError("API key is required for transcription")

        segments = self.split_audio(audio_path, show_progress=show_progress)
        transcripts = []
        headers = {"Authorization": f"Bearer {self.api_key}"}
        for index, segment in enumerate(segments):
            if show_progress and len(segments) > 1:
                print(f"Transcribing segment {index + 1}/{len(segments)}...")
            with open(segment, 'rb') as f:
                files = {'file': (segment.name, f, 'audio/mpeg')}
                data = {'model': self.model}
                response = requests.post(
                    self.api_base_url,
                    headers=headers,
                    files=files,
                    data=data,
                    timeout=180,
                )
            response.raise_for_status()
            payload = response.json()
            text = payload.get('text') or payload.get('data', {}).get('text') or ''
            if text:
                transcripts.append(text.strip())
        return "\n".join(transcripts).strip()

    def cleanup_files(self, *file_paths: Path):
        """Remove temporary files."""
        for file_path in file_paths:
            try:
                if file_path and Path(file_path).exists():
                    Path(file_path).unlink()
            except OSError:
                pass


def get_video_info(share_link: str, quality: str = "best") -> dict:
    """Get video metadata and candidate download URLs."""
    processor = DouyinProcessor()
    return processor.parse_share_url(share_link, quality)


def download_video(share_link: str, output_dir: str = ".", quality: str = "best") -> Path:
    """Download a Douyin video to the target directory."""
    processor = DouyinProcessor()
    video_info = processor.parse_share_url(share_link, quality)
    return processor.download_video(video_info, Path(output_dir))


def extract_text(share_link: str, api_key: Optional[str] = None, output_dir: Optional[str] = None,
                 save_video: bool = False, show_progress: bool = True) -> dict:
    """
    从视频中提取文案并保存到文件

    返回:
        dict: 包含 video_info, text, output_path 的字典
    """
    api_key = api_key or os.getenv('API_KEY')
    if not api_key:
        raise ValueError("未设置环境变量 API_KEY，请先获取硅基流动 API 密钥")

    processor = DouyinProcessor(api_key)

    if show_progress:
        print("正在解析抖音分享链接...")
    video_info = processor.parse_share_url(share_link)

    if show_progress:
        print("正在下载视频...")
    video_path = processor.download_video(video_info, show_progress=show_progress)

    if show_progress:
        print("正在提取音频...")
    audio_path = processor.extract_audio(video_path, show_progress=show_progress)

    if show_progress:
        print("正在从音频中提取文本...")
    text_content = processor.extract_text_from_audio(audio_path, show_progress=show_progress)

    result = {
        "video_info": video_info,
        "text": text_content,
        "output_path": None
    }

    # 保存到文件
    if output_dir:
        output_base = Path(output_dir)
        video_folder = output_base / video_info['video_id']
        video_folder.mkdir(parents=True, exist_ok=True)

        # 保存文案为 Markdown 格式
        transcript_path = video_folder / "transcript.md"
        with open(transcript_path, 'w', encoding='utf-8') as f:
            f.write(f"# {video_info['title']}\n\n")
            f.write(f"| 属性 | 值 |\n")
            f.write(f"|------|----|\n")
            f.write(f"| 视频ID | `{video_info['video_id']}` |\n")
            f.write(f"| 提取时间 | {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} |\n")
            f.write(f"| 下载链接 | [点击下载]({video_info['url']}) |\n\n")
            f.write(f"---\n\n")
            f.write(f"## 文案内容\n\n")
            f.write(text_content)

        result["output_path"] = str(video_folder)

        if show_progress:
            print(f"文案已保存到: {transcript_path}")

        # 保存视频 (可选)
        if save_video:
            saved_video_path = video_folder / f"{video_info['video_id']}.mp4"
            shutil.copy2(video_path, saved_video_path)
            if show_progress:
                print(f"视频已保存到: {saved_video_path}")

    # 清理临时文件
    if show_progress:
        print("正在清理临时文件...")
    processor.cleanup_files(video_path, audio_path)

    return result


def load_config_yaml(config_path):
    """Load config from YAML file if it exists"""
    import yaml
    if not config_path or not os.path.exists(config_path):
        return {}
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def main():
    parser = argparse.ArgumentParser(
        description="抖音无水印视频下载和文案提取工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  # 获取视频信息和下载链接
  python douyin_downloader.py --link "抖音分享链接" --action info

  # 下载视频
  python douyin_downloader.py --link "抖音分享链接" --action download --output ./videos

  # 提取文案并保存到文件 (需要设置 DOUYIN_API_KEY 环境变量)
  python douyin_downloader.py --link "抖音分享链接" --action extract --output ./output

  # 提取文案并同时保存视频
  python douyin_downloader.py --link "抖音分享链接" --action extract --output ./output --save-video
        """
    )

    parser.add_argument("--link", "-l", required=True, help="抖音分享链接或包含链接的文本")
    parser.add_argument("--action", "-a", choices=["info", "download", "extract"],
                        default="info", help="操作类型: info(获取信息), download(下载视频), extract(提取文案)")
    parser.add_argument("--quality", choices=["best", "1080", "720"], default="best", help="Preferred download quality")
    parser.add_argument("--output", "-o", default="./output", help="输出目录 (默认 ./output)")
    parser.add_argument("--api-key", "-k", help="硅基流动 API 密钥 (也可通过 DOUYIN_API_KEY 环境变量设置)")
    parser.add_argument("--save-video", "-v", action="store_true", help="提取文案时同时保存视频")
    parser.add_argument("--quiet", "-q", action="store_true", help="安静模式，减少输出")
    parser.add_argument("-c", "--config", dest="config", help="配置文件路径")

    args = parser.parse_args()

    # Load config from YAML if provided
    config = load_config_yaml(args.config)

    try:
        if args.action == "info":
            info = get_video_info(args.link, args.quality)
            print("\n" + "=" * 50)
            print("视频信息:")
            print("=" * 50)
            print(f"视频ID: {info['video_id']}")
            print(f"标题: {info['title']}")
            print(f"下载链接: {info['url']}")
            print("=" * 50)

        elif args.action == "download":
            base_processor = DouyinProcessor()
            video_info = base_processor.parse_share_url(args.link, args.quality)
            video_path = base_processor.download_video(video_info, Path(args.output))
            print(f"\n视频已保存到: {video_path}")

            # Check if auto-transcript is enabled in config
            transcript_cfg = config.get("transcript", {}) or {}
            if transcript_cfg.get("enabled", False):
                api_key = args.api_key
                if not api_key:
                    # Try to get API key from config or environment
                    api_key_env = transcript_cfg.get("api_key_env", "OPENAI_API_KEY")
                    api_key = os.getenv(api_key_env) or os.getenv("SILICONFLOW_API_KEY") or os.getenv("SF_KEY")
                    if not api_key:
                        api_key = transcript_cfg.get("api_key", "")
                if api_key:
                    print("\n自动转写已启用，开始转写...")
                    # Get API URL and model from config
                    api_url = transcript_cfg.get("api_url", DEFAULT_API_BASE_URL)
                    model = transcript_cfg.get("model", DEFAULT_MODEL)
                    processor = DouyinProcessor(api_key, api_url, model)

                    # Extract audio and transcribe
                    audio_path = processor.extract_audio(Path(video_path))
                    text_content = processor.extract_text_from_audio(audio_path, show_progress=not args.quiet)

                    # Save transcript
                    output_base = Path(args.output)
                    video_folder = output_base / video_info['video_id']
                    video_folder.mkdir(parents=True, exist_ok=True)
                    if config.get("json", False) and video_info.get("author"):
                        metadata_path = video_folder / f"{video_info['video_id']}_data.json"
                        with open(metadata_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                "aweme_id": video_info.get("video_id", ""),
                                "desc": video_info.get("title", ""),
                                "author": {
                                    "nickname": video_info.get("author", "")
                                },
                                "author_name": video_info.get("author", "")
                            }, f, ensure_ascii=False, indent=2)
                    transcript_path = video_folder / f"{video_info['video_id']}.transcript.txt"
                    with open(transcript_path, 'w', encoding='utf-8') as f:
                        f.write(text_content)
                    print(f"\n文案已保存到: {transcript_path}")
                    # Cleanup audio
                    processor.cleanup_files(audio_path)
                else:
                    print("\n警告: 转写已启用但未找到 API 密钥，跳过转写")

        elif args.action == "extract":
            result = extract_text(
                args.link,
                args.api_key,
                output_dir=args.output,
                save_video=args.save_video,
                show_progress=not args.quiet
            )

            if not args.quiet:
                print("\n" + "=" * 50)
                print("提取完成!")
                print("=" * 50)
                print(f"视频ID: {result['video_info']['video_id']}")
                print(f"标题: {result['video_info']['title']}")
                if result['output_path']:
                    print(f"保存位置: {result['output_path']}")
                print("=" * 50)
                print("\n文案内容:\n")
                print(result['text'][:500] + "..." if len(result['text']) > 500 else result['text'])
                print("\n" + "=" * 50)

    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
