@echo off
setlocal

set "PROVIDER=%~1"
if /I "%PROVIDER%"=="codex" (
  set "MARKER=agent-codex-running.flag"
  set "HOLD=agent-codex-running-hold.flag"
) else if /I "%PROVIDER%"=="claudeCode" (
  set "MARKER=agent-claudeCode-running.flag"
  set "HOLD=agent-claudeCode-running-hold.flag"
) else (
  exit /b 2
)

if defined NIMBO_AGENT_STATUS_DIR (
  set "STATUS_DIR=%NIMBO_AGENT_STATUS_DIR%"
) else (
  if defined APPDATA (
    set "STATUS_DIR=%APPDATA%\com.nimbo.app"
  ) else (
    set "STATUS_DIR=%LOCALAPPDATA%\com.nimbo.app"
  )
)

if not exist "%STATUS_DIR%" mkdir "%STATUS_DIR%" >nul 2>nul
break > "%STATUS_DIR%\%MARKER%"
del "%STATUS_DIR%\%HOLD%" >nul 2>nul

exit /b 0
