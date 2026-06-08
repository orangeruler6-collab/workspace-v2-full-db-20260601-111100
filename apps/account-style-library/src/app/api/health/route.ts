import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import os from "os";
import path from "path";
import { existsSync } from "fs";
import { libraryRoot } from "@/lib/storage";
import { getChatRuntimeConfig } from "@/lib/ai";
import { getImageRuntimeConfig } from "@/lib/cover";
import { checkFeishuRuntime } from "@/lib/feishu";
import { checkFfmpegRuntime } from "@/lib/ffmpeg";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

function opencliBin() {
  const configured = process.env.OPENCLI_BIN || process.env.USAGI_OPENCLI_PATH;
  if (configured) return configured;
  if (process.platform !== "win32") return "opencli";

  const npmDir = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : path.join(os.homedir(), "AppData", "Roaming", "npm");
  const cmdPath = path.join(npmDir, "opencli.cmd");
  if (existsSync(cmdPath)) return cmdPath;

  return "opencli.cmd";
}

export async function GET() {
  const opencli = opencliBin();
  const chat = getChatRuntimeConfig();
  const image = getImageRuntimeConfig();
  const feishu = await checkFeishuRuntime();
  const ffmpeg = await checkFfmpegRuntime();
  let opencliOk = false;
  let opencliVersion = "";

  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : opencli;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", opencli, "--version"] : ["--version"];
    const { stdout } = await execFileAsync(command, args, { timeout: 5000 });
    opencliOk = true;
    opencliVersion = stdout.trim();
  } catch {
    opencliOk = false;
  }

  return NextResponse.json({
    opencli: {
      ok: opencliOk,
      bin: opencli,
      version: opencliVersion
    },
    libraryRoot: libraryRoot(),
    volcengineAsrConfigured: Boolean(
      process.env.VOLCENGINE_ASR_API_KEY ||
      process.env.VOLCENGINE_API_KEY ||
      (process.env.VOLCENGINE_ASR_APP_KEY && process.env.VOLCENGINE_ASR_ACCESS_KEY)
    ),
    chatConfigured: chat.configured,
    chat,
    imageConfigured: image.configured,
    image,
    ffmpeg,
    feishuConfigured: feishu.configured,
    feishu
  });
}
