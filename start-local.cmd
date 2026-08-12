@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Parallel Work Time - Local Server

rem Keep this batch file ASCII-only. Japanese Windows may read UTF-8 batch files
rem using code page 932, which corrupts a Japanese directory name written here.
set "PWT_SERVER_SCRIPT="
for /d %%D in ("%~dp0*") do if exist "%%~fD\_local-server.ps1" set "PWT_SERVER_SCRIPT=%%~fD\_local-server.ps1"

if not defined PWT_SERVER_SCRIPT (
  echo Local startup failed. _local-server.ps1 was not found.
  set "PWT_EXIT_CODE=4"
  goto :failed
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PWT_SERVER_SCRIPT%" %*
set "PWT_EXIT_CODE=%ERRORLEVEL%"

if "%PWT_EXIT_CODE%"=="0" goto :end

:failed
echo.
echo Local startup failed. See the message above.
pause

:end
exit /b %PWT_EXIT_CODE%
