@echo off
setlocal
title Parallel Work Time - Local Server

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0アプリ内部（変更しないでください）\_local-server.ps1" %*
set "PWT_EXIT_CODE=%ERRORLEVEL%"

if not "%PWT_EXIT_CODE%"=="0" (
  echo.
  echo Local startup failed. See the message above.
  pause
)

exit /b %PWT_EXIT_CODE%
