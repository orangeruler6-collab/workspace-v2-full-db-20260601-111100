import base64
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
import zlib


def write_json(data):
    print(json.dumps(data, ensure_ascii=False))


def clean_text(value):
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", value or "")).strip()


def parse_docx(path):
    parts = []
    with zipfile.ZipFile(path) as zf:
        names = [
            "word/document.xml",
            *[n for n in zf.namelist() if re.match(r"word/(header|footer)\d*\.xml$", n)],
        ]
        for name in names:
            if name not in zf.namelist():
                continue
            xml = zf.read(name).decode("utf-8", "ignore")
            xml = re.sub(r"</w:p\s*>", "\n", xml)
            xml = re.sub(r"<w:tab\s*/>", "\t", xml)
            xml = re.sub(r"<w:br\s*/>", "\n", xml)
            texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", xml, flags=re.S)
            parts.append(html.unescape("".join(texts)))
    return clean_text("\n".join(parts))


def run_pdftotext(path):
    for cmd in ("pdftotext", "xpdf-pdftotext"):
        try:
            proc = subprocess.run(
                [cmd, "-layout", path, "-"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=30,
            )
            if proc.returncode == 0 and proc.stdout.strip():
                return clean_text(proc.stdout)
        except Exception:
            pass
    return ""


def decode_pdf_string(raw):
    raw = raw.replace(rb"\\n", b"\n").replace(rb"\\r", b"\r").replace(rb"\\t", b"\t")
    raw = raw.replace(rb"\\(", b"(").replace(rb"\\)", b")").replace(rb"\\\\", b"\\")
    try:
        return raw.decode("utf-16-be")
    except Exception:
        return raw.decode("latin1", "ignore")


def parse_pdf_stream_text(data):
    chunks = []
    for match in re.finditer(rb"(<<[\s\S]{0,1200}?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream", data):
        dictionary, stream = match.group(1), match.group(2)
        if b"FlateDecode" in dictionary:
            try:
                stream = zlib.decompress(stream)
            except Exception:
                continue
        for raw in re.findall(rb"\((?:\\.|[^\\)])*\)\s*Tj", stream):
            chunks.append(decode_pdf_string(raw[1:-3].strip()[:-1] if raw.endswith(b") Tj") else raw[1:-3]))
        for array in re.findall(rb"\[(.*?)\]\s*TJ", stream, flags=re.S):
            for raw in re.findall(rb"\((?:\\.|[^\\)])*\)", array):
                chunks.append(decode_pdf_string(raw[1:-1]))
            for raw in re.findall(rb"<([0-9A-Fa-f\s]+)>", array):
                try:
                    chunks.append(bytes.fromhex(re.sub(rb"\s+", b"", raw).decode()).decode("utf-16-be", "ignore"))
                except Exception:
                    pass
        if chunks:
            chunks.append("\n")
    return clean_text("".join(chunks))


def parse_pdf(path):
    text = run_pdftotext(path)
    if text:
        return text, []
    with open(path, "rb") as f:
        data = f.read()
    text = parse_pdf_stream_text(data)
    return text, extract_pdf_images(data)


def normalize_pdf_stream(stream):
    return stream.strip(b"\r\n")


def extract_pdf_images(data, limit=4):
    images = []
    for match in re.finditer(rb"(<<[\s\S]{0,2200}?/Subtype\s*/Image[\s\S]{0,2200}?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream", data):
        dictionary, stream = match.group(1), normalize_pdf_stream(match.group(2))
        if b"/DCTDecode" in dictionary:
            mime = "image/jpeg"
            image_data = stream
        elif b"/JPXDecode" in dictionary:
            mime = "image/jp2"
            image_data = stream
        else:
            continue
        if len(image_data) < 2048:
            continue
        images.append({
            "mime": mime,
            "base64": base64.b64encode(image_data).decode("ascii")
        })
        if len(images) >= limit:
            break
    return images


def main():
    if len(sys.argv) < 2:
        write_json({"error": "payload file required"})
        return
    payload = json.load(open(sys.argv[1], "r", encoding="utf-8"))
    params = payload.get("params") or {}
    filename = params.get("filename") or "document"
    file_data = params.get("file_data") or params.get("file_base64") or ""
    ext = os.path.splitext(filename.lower())[1]
    if ext not in (".pdf", ".docx", ".doc"):
        write_json({"error": "仅支持 PDF、DOCX / Word 文档"})
        return
    if ext == ".doc":
        write_json({"error": "暂不支持老版 .doc，请另存为 .docx 后导入"})
        return
    if not file_data:
        write_json({"error": "missing file data"})
        return
    try:
        raw = base64.b64decode(file_data.split(",", 1)[-1])
    except Exception as e:
        write_json({"error": "文件数据解析失败：" + str(e)})
        return
    if len(raw) > 25 * 1024 * 1024:
        write_json({"error": "文件超过 25MB，请先压缩或拆分"})
        return
    fd, temp_path = tempfile.mkstemp(suffix=ext, prefix="usagi_doc_")
    os.close(fd)
    try:
        with open(temp_path, "wb") as f:
            f.write(raw)
        images = []
        if ext == ".docx":
            text = parse_docx(temp_path)
        else:
            text, images = parse_pdf(temp_path)
        if not text:
            if images:
                write_json({
                    "ok": False,
                    "needs_ocr": True,
                    "title": os.path.splitext(os.path.basename(filename))[0],
                    "images": images,
                    "message": "PDF 没有文字层，已提取页面图片，等待视觉模型 OCR。"
                })
                return
            write_json({"error": "没有提取到文字。若是扫描版 PDF，需要先 OCR 后再导入。"})
            return
        write_json({"ok": True, "title": os.path.splitext(os.path.basename(filename))[0], "text": text[:60000]})
    except Exception as e:
        write_json({"error": "文档解析失败：" + str(e)})
    finally:
        try:
            os.unlink(temp_path)
        except Exception:
            pass


if __name__ == "__main__":
    main()
