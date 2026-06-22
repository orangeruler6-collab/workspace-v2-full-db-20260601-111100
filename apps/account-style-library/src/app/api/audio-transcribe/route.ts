import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SILICONFLOW_TRANSCRIBE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions";
const SILICONFLOW_TRANSCRIBE_MODEL = "FunAudioLLM/SenseVoiceSmall";
const MAX_AUDIO_SIZE_BYTES = 200 * 1024 * 1024;
const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "wav", "aac", "flac", "ogg", "opus", "mpeg", "mpga"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const uploaded = form.get("file");
    if (!uploaded || typeof uploaded === "string") {
      return NextResponse.json({ error: "请上传一个 MP3 或音频文件。" }, { status: 400 });
    }

    const fileName = uploaded.name || "audio.mp3";
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeType = uploaded.type || "application/octet-stream";
    if (!mimeType.startsWith("audio/") && !AUDIO_EXTENSIONS.has(extension)) {
      return NextResponse.json({ error: "暂时只支持 MP3、M4A、WAV、AAC、FLAC、OGG 等音频文件。" }, { status: 400 });
    }
    if (uploaded.size <= 0) {
      return NextResponse.json({ error: "音频文件为空，请重新选择。" }, { status: 400 });
    }
    if (uploaded.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json({ error: "音频文件太大，当前单次上传上限是 200MB。" }, { status: 413 });
    }

    const apiKey = await readSiliconFlowApiKey();
    if (!apiKey) {
      return NextResponse.json({ error: "未配置 SILICONFLOW_API_KEY，无法进行 MP3 转写。" }, { status: 500 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append("model", SILICONFLOW_TRANSCRIBE_MODEL);
    upstreamForm.append("file", uploaded, fileName);

    const upstream = await fetch(SILICONFLOW_TRANSCRIBE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: upstreamForm,
      signal: AbortSignal.timeout(10 * 60 * 1000)
    });

    const fallback = upstream.clone();
    const data = await upstream.json().catch(async () => ({ error: await fallback.text().catch(() => "") }));
    if (!upstream.ok) {
      return NextResponse.json({ error: summarizeTranscribeError(data, upstream.status) }, { status: upstream.status });
    }

    const transcript = extractTranscript(data);
    if (!transcript) {
      return NextResponse.json({ error: "音频转写完成，但服务没有返回可用文本。" }, { status: 502 });
    }

    return NextResponse.json({
      transcript,
      fileName,
      size: uploaded.size,
      model: SILICONFLOW_TRANSCRIBE_MODEL
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "音频转写超时，请稍后重试或先压缩音频。"
      : error instanceof Error
        ? error.message
        : "音频转写失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function readSiliconFlowApiKey() {
  const fromEnv = process.env.SILICONFLOW_API_KEY || process.env.SF_KEY;
  if (fromEnv) return fromEnv;

  const candidatePaths = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env")
  ];

  for (const envPath of candidatePaths) {
    const parsed = await readEnvFile(envPath);
    const key = parsed.SILICONFLOW_API_KEY || parsed.SF_KEY;
    if (key) return key;
  }

  return "";
}

async function readEnvFile(filePath: string) {
  try {
    const content = await readFile(filePath, "utf8");
    return Object.fromEntries(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator <= 0) return ["", ""];
          const key = line.slice(0, separator).trim();
          const rawValue = line.slice(separator + 1).trim();
          return [key, rawValue.replace(/^['"]|['"]$/g, "")];
        })
        .filter(([key]) => key)
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function extractTranscript(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const record = data as Record<string, unknown>;
  const candidates = [record.text, record.transcript, record.result, record.content];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  if (record.data && typeof record.data === "object") {
    return extractTranscript(record.data);
  }
  return "";
}

function summarizeTranscribeError(data: unknown, status: number) {
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const message = record.error || record.message || record.msg;
    if (typeof message === "string" && message.trim()) return `音频转写失败：${message.trim()}`;
  }
  return `音频转写失败：服务返回 ${status}`;
}
