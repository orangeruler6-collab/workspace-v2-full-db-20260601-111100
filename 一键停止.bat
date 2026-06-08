@echo off
chcp 65001 >nul
setlocal
title Usagi Workspace 一键停止

cd /d "%~dp0"

echo.
echo ================================
echo   Usagi Workspace 一键停止
echo ================================
echo.

if exist codex-dev.pid (
  set /p DEV_PID=<codex-dev.pid
  if not "%DEV_PID%"=="" (
    echo 正在停止主启动进程 PID %DEV_PID% ...
    taskkill /PID %DEV_PID% /T /F >nul 2>nul
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(3000,3100,5555); $pids=Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique; foreach($pid in $pids){ try { Stop-Process -Id $pid -Force -ErrorAction Stop; Write-Host ('已停止端口进程 PID ' + $pid) } catch {} }"

echo.
echo 已尝试停止 3000 / 3100 / 5555 相关服务。
echo.
pause
