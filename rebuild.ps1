# Rebuild script for Windows 11 (PowerShell)
# Run from project root. For Task Scheduler: use "powershell.exe -NoProfile -File C:\path\to\sf-event-agg\rebuild.ps1"
Set-Location $PSScriptRoot
npm run build
