import { execFile, spawn } from "child_process";
import { existsSync } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type FeishuConfig = {
  folderToken: string;
  opencliBin: string;
  identity: string;
};

export type FeishuDocumentReadResult = {
  url: string;
  title: string;
  documentId: string;
  documentType: string;
  text: string;
  comments: string[];
  commentError?: string;
};

function larkCliBin() {
  const configured = process.env.LARK_CLI_BIN || process.env.OPENCLI_BIN || process.env.USAGI_OPENCLI_PATH;
  if (configured && configured.toLowerCase().includes("lark-cli")) return configured;
  if (process.platform !== "win32") return "lark-cli";

  const npmDir = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : path.join(os.homedir(), "AppData", "Roaming", "npm");
  const cmdPath = path.join(npmDir, "lark-cli.cmd");
  if (existsSync(cmdPath)) return cmdPath;

  return "lark-cli.cmd";
}

function openCliInvocation(command: string, args: string[]) {
  if (process.platform !== "win32") return { command, args };
  return {
    command: process.env.ComSpec || "cmd.exe",
    args: ["/d", "/s", "/c", command, ...args]
  };
}

function feishuConfig(): FeishuConfig {
  return {
    folderToken: process.env.FEISHU_FOLDER_TOKEN || "",
    opencliBin: larkCliBin(),
    identity: process.env.FEISHU_OPENCLI_AS || "user"
  };
}

export function getFeishuRuntimeConfig() {
  const config = feishuConfig();
  return {
    configured: true,
    mode: "lark-cli" as const,
    opencliBin: config.opencliBin,
    identity: config.identity,
    folderConfigured: Boolean(config.folderToken)
  };
}

export async function checkFeishuRuntime() {
  const config = feishuConfig();
  try {
    const invocation = openCliInvocation(config.opencliBin, ["doctor", "--offline"]);
    const { stdout, stderr } = await execFileAsync(invocation.command, invocation.args, {
      maxBuffer: 1024 * 1024,
      timeout: 10000
    });
    return {
      ...getFeishuRuntimeConfig(),
      doctor: {
        ok: true,
        message: (stdout || stderr).trim()
      }
    };
  } catch (error) {
    return {
      ...getFeishuRuntimeConfig(),
      doctor: {
        ok: false,
        message: error instanceof Error ? error.message : "lark-cli doctor 检查失败"
      }
    };
  }
}

export async function publishFeishuDocument(input: { title: string; content: string }) {
  return publishWithOpenCli(feishuConfig(), input);
}

export function isFeishuDocumentUrl(url: string) {
  return /(?:^|\.)((feishu|larksuite)\.cn|feishu\.com|larksuite\.com)$/i.test(safeHostname(url));
}

export async function readFeishuDocument(input: { url: string; includeComments?: boolean }): Promise<FeishuDocumentReadResult> {
  const config = feishuConfig();
  const args = [
    "docs",
    "+fetch",
    "--doc",
    input.url,
    "--as",
    config.identity,
    "--api-version",
    "v2",
    "--format",
    "json"
  ];

  const { stdout, stderr } = await runLarkCli(config, args, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: 120000
  });
  const parsed = parseJsonish(stdout);
  const text = extractFeishuDocumentText(parsed, stdout).trim();
  const ref = extractFeishuDocumentRef(input.url, parsed);
  const title = extractFirstStringByKeys(parsed, ["title", "document_title", "name"]) || ref.documentId || "飞书文档";

  if (!text) {
    throw new Error(`飞书文档读取为空${stderr.trim() ? `：${stderr.trim()}` : ""}`);
  }

  let comments: string[] = [];
  let commentError = "";
  if (input.includeComments !== false && ref.documentId && ref.documentType) {
    try {
      comments = await readFeishuDocumentComments(config, ref.documentId, ref.documentType);
    } catch (error) {
      commentError = error instanceof Error ? error.message : "飞书批注读取失败";
    }
  }

  return {
    url: input.url,
    title,
    documentId: ref.documentId,
    documentType: ref.documentType,
    text,
    comments,
    commentError: commentError || undefined
  };
}

async function publishWithOpenCli(config: FeishuConfig, input: { title: string; content: string }) {
  const args = [
    "docs",
    "+create",
    "--title",
    input.title || "写作台生成文档",
    "--markdown",
    "-",
    "--as",
    config.identity
  ];
  if (config.folderToken) args.push("--folder-token", config.folderToken);

  const { stdout, stderr } = await spawnWithInput(config.opencliBin, args, input.content, {
    maxBuffer: 1024 * 1024 * 20,
    timeout: 120000
  });
  const output = stdout.trim();
  const payload = parseJsonish(output);
  const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>) : {};
  const documentId = String(nested.doc_id || nested.document_id || data.doc_id || data.document_id || "");
  const url = String(nested.doc_url || nested.url || data.doc_url || data.url || "");

  if (!documentId && !url) {
    throw new Error(`飞书文档创建失败：${stderr.trim() || output || "opencli 未返回文档链接"}`);
  }

  return {
    title: input.title,
    documentId,
    url: url || `https://www.feishu.cn/docx/${documentId}`
  };
}

async function readFeishuDocumentComments(config: FeishuConfig, documentId: string, documentType: string) {
  const params = {
    file_token: documentId,
    file_type: documentType,
    is_solved: false,
    page_size: 100
  };
  const { stdout } = await spawnWithInput(config.opencliBin, [
    "drive",
    "file.comments",
    "list",
    "--params",
    "-",
    "--page-all",
    "--as",
    config.identity,
    "--format",
    "json"
  ], JSON.stringify(params), {
    maxBuffer: 1024 * 1024 * 10,
    timeout: 60000
  });

  return extractFeishuComments(parseJsonish(stdout));
}

function runLarkCli(config: FeishuConfig, args: string[], options: { maxBuffer: number; timeout: number }) {
  const invocation = openCliInvocation(config.opencliBin, args);
  return execFileAsync(invocation.command, invocation.args, {
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
    windowsHide: true
  });
}

function spawnWithInput(command: string, args: string[], input: string, options: { maxBuffer: number; timeout: number }) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const invocation = openCliInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("飞书文档创建超时"));
    }, options.timeout);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > options.maxBuffer) {
        child.kill("SIGTERM");
        finish(new Error("飞书文档创建输出过大"));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > options.maxBuffer) {
        child.kill("SIGTERM");
        finish(new Error("飞书文档创建错误输出过大"));
      }
    });
    child.on("error", finish);
    child.on("close", (code) => {
      if (code === 0) {
        finish();
        return;
      }
      finish(new Error(stderr.trim() || `飞书文档创建失败：lark-cli 退出码 ${code}`));
    });

    child.stdin.end(input);
  });
}

function safeHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function extractFeishuDocumentRef(url: string, payload: unknown) {
  const fromPayload =
    extractFirstStringByKeys(payload, ["document_id", "doc_id", "docx_id", "token", "file_token"]) || "";
  const fromUrl = extractTokenFromFeishuUrl(url);
  const documentId = fromPayload || fromUrl.documentId;
  return {
    documentId,
    documentType: normalizeFeishuDocumentType(fromUrl.documentType || inferFeishuDocumentType(documentId))
  };
}

function extractTokenFromFeishuUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const typeIndex = parts.findIndex((part) => /^(docx|doc|wiki|sheets|sheet|base|bitable|slides)$/i.test(part));
    if (typeIndex >= 0 && parts[typeIndex + 1]) {
      return {
        documentType: parts[typeIndex],
        documentId: parts[typeIndex + 1]
      };
    }
  } catch {
    return { documentType: "", documentId: "" };
  }
  return { documentType: "", documentId: "" };
}

function normalizeFeishuDocumentType(type: string) {
  const normalized = type.toLowerCase();
  if (normalized === "doc" || normalized === "docx") return normalized;
  if (normalized === "sheet" || normalized === "sheets") return "sheet";
  if (normalized === "base" || normalized === "bitable") return "bitable";
  if (normalized === "slides") return "slides";
  return normalized === "wiki" ? "" : normalized;
}

function inferFeishuDocumentType(documentId: string) {
  if (/^doxcn/i.test(documentId)) return "doc";
  return documentId ? "docx" : "";
}

function extractFeishuDocumentText(payload: unknown, stdout: string) {
  const candidates = collectStringValuesByKeys(payload, [
    "content",
    "markdown",
    "text",
    "plain_text",
    "body",
    "document_content"
  ]);
  const best = candidates
    .map(cleanFeishuDocumentText)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  if (best) return best;

  return cleanFeishuDocumentText(stdout);
}

function cleanFeishuDocumentText(input: string) {
  return decodeHtmlEntities(input)
    .replace(/<[^>]+>/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractFeishuComments(payload: unknown) {
  const items = findFirstArrayByKey(payload, "items");
  if (!items.length) return [];

  return items
    .map((item, index) => {
      const quote = extractFirstStringByKeys(item, ["quote"]) || "";
      const replies = findFirstArrayByKey(item, "replies")
        .map((reply) => extractFirstStringByKeys(reply, ["content", "text", "plain_text"]))
        .filter(Boolean);
      const directContent = extractFirstStringByKeys(item, ["content", "text", "plain_text"]);
      const content = [directContent, ...replies].filter(Boolean).join(" / ");
      if (!quote && !content) return "";
      return [`批注 ${index + 1}:`, quote ? `引用：${cleanFeishuDocumentText(quote)}` : "", content ? `意见：${cleanFeishuDocumentText(content)}` : ""]
        .filter(Boolean)
        .join("\n");
    })
    .filter(Boolean);
}

function extractFirstStringByKeys(value: unknown, keys: string[]): string {
  return collectStringValuesByKeys(value, keys)[0] || "";
}

function collectStringValuesByKeys(value: unknown, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const results: string[] = [];
  const visited = new Set<unknown>();

  const walk = (current: unknown, keyHint = "") => {
    if (current == null || visited.has(current)) return;
    if (typeof current === "string") {
      if (wanted.has(keyHint.toLowerCase())) results.push(current);
      return;
    }
    if (typeof current !== "object") return;
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) walk(item, keyHint);
      return;
    }

    for (const [key, item] of Object.entries(current as Record<string, unknown>)) {
      walk(item, key);
    }
  };

  walk(value);
  return results.map((item) => item.trim()).filter(Boolean);
}

function findFirstArrayByKey(value: unknown, key: string): unknown[] {
  const visited = new Set<unknown>();
  const wanted = key.toLowerCase();

  const walk = (current: unknown): unknown[] => {
    if (current == null || visited.has(current) || typeof current !== "object") return [];
    visited.add(current);

    if (Array.isArray(current)) {
      for (const item of current) {
        const nested = walk(item);
        if (nested.length) return nested;
      }
      return [];
    }

    for (const [entryKey, item] of Object.entries(current as Record<string, unknown>)) {
      if (entryKey.toLowerCase() === wanted && Array.isArray(item)) return item;
      const nested = walk(item);
      if (nested.length) return nested;
    }
    return [];
  };

  return walk(value);
}

function decodeHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseJsonish(output: string): unknown {
  if (!output) return {};
  try {
    return JSON.parse(output);
  } catch {
    const firstBrace = output.indexOf("{");
    const firstBracket = output.indexOf("[");
    const candidates = [firstBrace, firstBracket].filter((index) => index >= 0);
    const start = Math.min(...candidates);
    if (Number.isFinite(start)) {
      try {
        return JSON.parse(output.slice(start));
      } catch {
        return {};
      }
    }
    return {};
  }
}
