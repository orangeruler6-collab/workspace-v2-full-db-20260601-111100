import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import process from "process";
import { spawn } from "child_process";

const root = process.cwd();
const stateDir = path.join(root, ".dev-server");
const pidFile = path.join(stateDir, "next-dev.pid");
const logFile = path.join(stateDir, "next-dev.log");
const port = Number(process.env.PORT || process.env.NEXT_PORT || 3100);
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const healthPath = "/style-workbench/api/health";
const healthTimeoutMs = 10000;

const command = process.argv[2] || "start";

async function main() {
  await fs.promises.mkdir(stateDir, { recursive: true });

  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "restart") {
    await stop({ quiet: true });
    return start();
  }
  if (command === "status") return status();

  console.error("Usage: node scripts/dev-server.mjs <start|stop|restart|status>");
  process.exit(1);
}

async function start() {
  const current = readPid();
  const currentHealth = current && isRunning(current) ? await checkHealth(port) : null;
  if (currentHealth?.ok) {
    console.log(`Next dev is already running: pid=${current}, http://localhost:${port}/style-workbench`);
    return;
  }

  const listener = await findPortListener(port);
  if (listener) {
    console.error(`Port ${port} is already in use: pid=${listener.pid || "unknown"} ${listener.command || ""}`.trim());
    process.exit(1);
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(port), "-H", "0.0.0.0"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_PORT: String(port),
      NODE_OPTIONS: ensureNodeMemory(process.env.NODE_OPTIONS)
    },
    windowsHide: true
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`, "utf8");
  fs.closeSync(logFd);

  console.log(`Started Next dev in background: pid=${child.pid}`);
  console.log(`URL: http://localhost:${port}/style-workbench`);
  console.log(`Log: ${logFile}`);
}

async function stop(options = {}) {
  const pid = readPid();
  if (!pid) {
    if (!options.quiet) console.log("No background dev server pid was found.");
    return;
  }

  if (!isRunning(pid)) {
    fs.rmSync(pidFile, { force: true });
    if (!options.quiet) console.log(`Background dev server was already stopped, cleared pid=${pid}.`);
    return;
  }

  signalDevServer(pid, "SIGTERM");
  const stopped = await waitForStop(pid, 5000);
  if (!stopped) signalDevServer(pid, "SIGKILL");
  const listener = await findPortListener(port);
  if (listener?.pid && listener.pid !== pid) {
    await killProcessTree(listener.pid).catch(() => {});
  }
  fs.rmSync(pidFile, { force: true });
  if (!options.quiet) console.log(`Stopped background dev server: pid=${pid}`);
}

async function status() {
  const pid = readPid();
  const listener = await findPortListener(port);
  const health = await checkHealth(port);

  console.log(
    JSON.stringify(
      {
        pid,
        pidRunning: pid ? isRunning(pid) : false,
        port,
        portListening: Boolean(listener),
        listener,
        healthy: health.ok,
        health,
        url: `http://localhost:${port}/style-workbench`,
        logFile
      },
      null,
      2
    )
  );
}

function readPid() {
  try {
    const value = Number(fs.readFileSync(pidFile, "utf8").trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureNodeMemory(value) {
  if (value?.includes("--max-old-space-size")) return value;
  return [value, "--max-old-space-size=4096"].filter(Boolean).join(" ");
}

function signalDevServer(pid, signal) {
  if (process.platform === "win32" && signal === "SIGKILL") {
    killProcessTree(pid).catch(() => {});
    return true;
  }

  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

function killProcessTree(pid) {
  if (process.platform !== "win32") {
    process.kill(pid, "SIGKILL");
    return Promise.resolve();
  }
  return run("taskkill", ["/PID", String(pid), "/T", "/F"]).then(() => undefined);
}

async function waitForStop(pid, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const listener = await findPortListener(port);
    if (!isRunning(pid) && !listener) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function canConnect(targetPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: targetPort });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

function checkHealth(targetPort) {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: targetPort,
        path: healthPath,
        timeout: healthTimeoutMs
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve({
            ok: response.statusCode && response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            path: healthPath,
            body: body.slice(0, 500)
          });
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, path: healthPath, error: "timeout" });
    });
    request.on("error", (error) => resolve({ ok: false, path: healthPath, error: error.message }));
  });
}

async function findPortListener(targetPort) {
  if (!(await canConnect(targetPort))) return null;

  if (process.platform === "win32") {
    const script = [
      `$conn = Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
      "if ($conn) {",
      "  $proc = Get-CimInstance Win32_Process -Filter \"ProcessId=$($conn.OwningProcess)\"",
      "  [pscustomobject]@{ pid = $conn.OwningProcess; command = $proc.CommandLine } | ConvertTo-Json -Compress",
      "}"
    ].join("; ");
    const result = await run("powershell", ["-NoProfile", "-Command", script]).catch(() => "");
    if (!result.trim()) return { port: targetPort };
    try {
      return JSON.parse(result);
    } catch {
      return { port: targetPort, command: result.trim() };
    }
  }

  const result = await run("lsof", ["-nP", `-iTCP:${targetPort}`, "-sTCP:LISTEN", "-FpPc"]).catch(() => "");
  const lines = result.split("\n").filter(Boolean);
  const info = {};
  for (const line of lines) {
    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "p") info.pid = Number(value);
    if (prefix === "c") info.command = value;
  }
  return Object.keys(info).length ? info : { port: targetPort };
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${bin} exited with ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
