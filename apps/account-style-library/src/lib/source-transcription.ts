import { execFile } from "child_process";
import { existsSync, promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { isFeishuDocumentUrl, readFeishuDocument } from "./feishu";
import { extractRewriteSourceMaterial, RewriteSourceExtraction, SourceMaterial } from "./source-extraction";
import type { LinkTranscriptionResult } from "./transcription";

const execFileAsync = promisify(execFile);

export async function resolveRewriteSourceMaterial(input: string): Promise<RewriteSourceExtraction> {
  const extracted = extractRewriteSourceMaterial(input);
  if (!extracted.materials.some((material) => material.urls.length)) return extracted;

  const materials: SourceMaterial[] = [];
  for (const material of extracted.materials) {
    if (!material.urls.length) {
      materials.push(material);
      continue;
    }

    const transcriptBlocks: string[] = [];
    const errors: string[] = [];
    const guidance = extractMaterialGuidance(material.text);
    for (const url of material.urls) {
      try {
        if (isFeishuDocumentUrl(url)) {
          const result = await readFeishuDocument({ url, includeComments: true });
          transcriptBlocks.push(formatFeishuDocument(result));
          continue;
        }
        const result = await transcribeLink(url, guidance.titleHint || material.text);
        transcriptBlocks.push(formatLinkTranscript(result));
      } catch (error) {
        errors.push(`${url}: ${error instanceof Error ? error.message : "link source reading failed"}`);
      }
    }

    materials.push({
      ...material,
      text: guidance.remainingText,
      transcribedText: transcriptBlocks.join("\n\n").trim(),
      guidanceText: guidance.guidanceText,
      transcriptionError: errors.join("\n")
    } as SourceMaterial);
  }

  const linkMaterials = materials.filter((material) => material.urls.length);
  const successfulLinkMaterials = linkMaterials.filter((material) => material.transcribedText?.trim());
  if (linkMaterials.length && !successfulLinkMaterials.length) {
    const detail = linkMaterials
      .map((material) => material.transcriptionError)
      .filter(Boolean)
      .join("\n");
    throw new Error(`link source reading failed${detail ? `: ${detail}` : ""}`);
  }

  return {
    ...extracted,
    materials,
    normalizedText: buildResolvedSourceText(materials, input),
    textMaterialCount: materials.filter((material) => (material.transcribedText || material.text).trim()).length
  };
}

async function transcribeLink(url: string, titleHint?: string): Promise<LinkTranscriptionResult> {
  const platform = detectToolsPlatform(url);
  if (platform) return transcribeWithToolsBackend(platform, url, titleHint);

  throw new Error("暂不支持的链接类型，已阻止进入视频转写");
}

async function transcribeWithToolsBackend(
  platform: "douyin" | "bilibili",
  url: string,
  titleHint?: string
): Promise<LinkTranscriptionResult> {
  const result = await runToolsTranscriber(platform, url);
  const text = String(result.text || "").trim();
  if (!text) {
    const error = String(result.error || "").trim();
    throw new Error(error || "tools transcriber returned empty text");
  }

  const source = String(result.source || "");
  return {
    url,
    platform,
    title: String(result.title || titleHint || "").trim(),
    text,
    source: source.includes("subtitle") ? "platform_subtitle" : "volcengine",
    fallback: false,
    fallbackReason: source ? `tools transcriber: ${source}` : "tools transcriber"
  };
}

function detectToolsPlatform(url: string): "douyin" | "bilibili" | "" {
  if (/bilibili\.com|b23\.tv|\bBV[0-9A-Za-z]{8,}\b/i.test(url)) return "bilibili";
  if (/douyin\.com|v\.douyin\.com|iesdouyin\.com/i.test(url)) return "douyin";
  return "";
}

async function runToolsTranscriber(platform: "douyin" | "bilibili", url: string): Promise<Record<string, unknown>> {
  const workspaceRoot = resolveWorkspaceRoot();
  const serverDir = path.join(workspaceRoot, "server");
  const script = path.join(serverDir, platform === "douyin" ? "transcribe_douyin.py" : "transcribe_bilibili.py");
  if (!existsSync(script)) throw new Error(`tools transcriber script not found: ${script}`);

  const tmpFile = path.join(os.tmpdir(), `style_tools_transcribe_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  await fs.writeFile(tmpFile, JSON.stringify({ action: "transcribe", params: { url } }), "utf8");

  try {
    const { stdout, stderr } = await execPython(script, tmpFile, platform === "bilibili" ? 900_000 : 300_000);
    try {
      return JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      throw new Error((stderr || stdout || "tools transcriber returned invalid JSON").slice(0, 500));
    }
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

async function execPython(script: string, tmpFile: string, timeout: number) {
  const candidates = getPythonCandidates();
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await execFileAsync(candidate, [script, tmpFile], {
        cwd: path.dirname(script),
        env: buildPythonEnv(),
        timeout,
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024
      });
    } catch (error) {
      lastError = error;
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("failed to start tools transcriber");
}

function getPythonCandidates() {
  const workspaceRoot = resolveWorkspaceRoot();
  const fromEnv = process.env.PYTHON || process.env.PYTHON_BIN || process.env.PYTHON_EXECUTABLE || "";
  const candidates = [
    fromEnv,
    path.join(workspaceRoot, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python"),
    process.platform === "win32" ? "python" : "python3",
    "python"
  ];
  return candidates.filter((candidate, index) => candidate && candidates.indexOf(candidate) === index);
}

function buildPythonEnv() {
  const workspaceRoot = resolveWorkspaceRoot();
  const pathDirs = [
    path.join(workspaceRoot, ".venv", process.platform === "win32" ? "Scripts" : "bin"),
    path.join(workspaceRoot, "tools", "douyin-downloader", ".venv", process.platform === "win32" ? "Scripts" : "bin"),
    path.join(workspaceRoot, "tools", "bilibili-cli", ".venv", process.platform === "win32" ? "Scripts" : "bin"),
    path.join(workspaceRoot, ".runtime", "ffmpeg", "ffmpeg-8.1.1-essentials_build", "bin"),
    path.join(process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming"), "npm")
  ].filter((dir) => existsSync(dir));
  const env = { ...process.env };
  if (process.platform === "win32" && env.Path && env.PATH && env.Path !== env.PATH) delete env.Path;
  if (process.platform === "win32" && env.Path && !env.PATH) {
    env.PATH = env.Path;
    delete env.Path;
  }
  env.PYTHONIOENCODING = "utf-8";
  env.SILICONFLOW_API_KEY = env.SILICONFLOW_API_KEY || env.SF_KEY || "";
  env.SF_KEY = env.SF_KEY || env.SILICONFLOW_API_KEY || "";
  env.API_KEY = env.SILICONFLOW_API_KEY || env.SF_KEY || "";
  env.DOUYIN_DOWNLOADER_ROOT = env.DOUYIN_DOWNLOADER_ROOT || path.join(workspaceRoot, "tools", "douyin-downloader");
  env.BILIBILI_CLI_ROOT = env.BILIBILI_CLI_ROOT || path.join(workspaceRoot, "tools", "bilibili-cli");
  env.PATH = pathDirs.concat(env.PATH || "").join(path.delimiter);
  return env;
}

function resolveWorkspaceRoot() {
  return path.resolve(process.cwd(), "..", "..");
}

function buildResolvedSourceText(materials: SourceMaterial[], fallback: string) {
  const trimmedFallback = fallback.trim();
  if (!materials.length) return trimmedFallback;

  return materials
    .map((material) => {
      const lines = [`Material ${material.index}:`];
      if ("guidanceText" in material && typeof material.guidanceText === "string" && material.guidanceText.trim()) {
        lines.push(material.guidanceText.trim());
      }
      if (material.transcribedText) {
        lines.push(material.transcribedText);
      } else if (material.urls.length) {
        lines.push("Link transcription failed; no usable video transcript was returned.");
        if (material.transcriptionError) lines.push(material.transcriptionError);
      } else if (material.text) {
        lines.push(material.text);
      }
      if (material.urls.length) lines.push(`Source links: ${material.urls.join(" ")}`);
      return lines.join("\n");
    })
    .join("\n\n---\n\n");
}

function extractMaterialGuidance(text: string) {
  const lines = text.split(/\r?\n/);
  const guidanceLines: string[] = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (/^\s*(用途|用途补充)\s*[:：]/.test(line)) {
      guidanceLines.push(line.trim());
    } else {
      bodyLines.push(line);
    }
  }

  const remainingText = bodyLines.join("\n").trim();
  return {
    guidanceText: guidanceLines.join("\n"),
    remainingText,
    titleHint: remainingText || guidanceLines.join(" ")
  };
}

function formatLinkTranscript(result: LinkTranscriptionResult) {
  const lines = [];
  if (result.title) lines.push(`Title: ${result.title}`);
  lines.push(`Video transcript:\n${result.text}`);
  if (result.fallbackReason) lines.push(`Transcription note: ${result.fallbackReason}`);
  return lines.join("\n");
}

function formatFeishuDocument(result: Awaited<ReturnType<typeof readFeishuDocument>>) {
  const lines = [];
  lines.push(`Feishu document: ${result.title || result.documentId || result.url}`);
  lines.push(`Document text:\n${result.text}`);
  if (result.comments.length) {
    lines.push(`Document comments / client notes:\n${result.comments.join("\n\n")}`);
  } else if (result.commentError) {
    lines.push(`Comment note: ${result.commentError}`);
  }
  return lines.join("\n");
}
