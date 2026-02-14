@echo off
REM Rebuild script for Windows 11 (Command Prompt)
REM Run from project root. For Task Scheduler: use full path to rebuild.cmd
cd /d "%~dp0"
call npm run build
