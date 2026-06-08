@echo off
chcp 65001 >nul
setlocal
title Usagi Workspace 一键启动

cd /d "%~dp0"

echo.
echo ================================
echo   Usagi Workspace 一键启动
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 Node.js。请先安装 Node.js，然后重新双击本文件。
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 npm。请确认 Node.js 安装完整。
  echo.
  pause
  exit /b 1
)

if not exist package.json (
  echo [错误] 当前目录不是项目根目录：%CD%
  echo 请把这个文件放在 D:\workspace-v2 目录里再运行。
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [提示] 第一次运行可能需要先安装依赖：
  echo        npm install
  echo.
)

echo 正在启动服务，请不要关闭这个窗口。
echo.
echo 启动完成后会自动打开：
echo   主前端：  http://localhost:3000/
echo   写作台：  http://localhost:3000/style-workbench
echo.

start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$ProgressPreference='SilentlyContinue'; $main='http://localhost:3000/'; $style='http://localhost:3000/style-workbench'; $health='http://localhost:3000/style-workbench/api/health'; for($i=0; $i -lt 120; $i++){ try { Invoke-WebRequest $main -UseBasicParsing -TimeoutSec 2 | Out-Null; Invoke-WebRequest $health -UseBasicParsing -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep -Seconds 1 } }; Start-Process $main; Start-Process $style"

call npm run dev

echo.
echo 服务已经停止，或启动过程中遇到错误。
echo 如果你看不懂上面的信息，把这个窗口截图发给我就行。
echo.
pause
