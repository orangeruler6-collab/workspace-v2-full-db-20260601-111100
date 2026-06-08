import { execFile } from "child_process";
import { existsSync } from "fs";
import { createRequire } from "module";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function bundledFfmpegPath() {
  const localPath = path.join(
    process.cwd(),
    "node_modules",
    "ffmpeg-static",
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
  );
  if (existsSync(localPath)) return localPath;

  try {
    const resolved = require("ffmpeg-static");
    return typeof resolved === "string" ? resolved.trim() : "";
  } catch {
    return "";
  }
}

export function resolveFfmpegBin() {
  const configured = process.env.FFMPEG_BIN?.trim();
  if (configured) return configured;

  const bundled = bundledFfmpegPath();
  if (bundled && existsSync(bundled)) return bundled;

  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

export async function checkFfmpegRuntime() {
  const bin = resolveFfmpegBin();
  try {
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : bin;
    const args = process.platform === "win32" ? ["/d", "/s", "/c", bin, "-version"] : ["-version"];
    const { stdout } = await execFileAsync(command, args, {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return {
      ok: true,
      bin,
      version: stdout.trim()
    };
  } catch (error) {
    return {
      ok: false,
      bin,
      version: "",
      message: error instanceof Error ? error.message : "ffmpeg 检查失败"
    };
  }
}
