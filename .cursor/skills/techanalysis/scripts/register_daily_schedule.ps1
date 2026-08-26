# Registers a Windows scheduled task: TechAnalysis daily at 9:00 AM local time.
# Run once from an elevated or normal PowerShell session:
#   powershell -ExecutionPolicy Bypass -File .cursor\skills\techanalysis\scripts\register_daily_schedule.ps1

$ErrorActionPreference = "Stop"

$taskName = "Robinhood-TechAnalysis"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..")).Path
$runScript = Join-Path $PSScriptRoot "run_scheduled.ps1"

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`"" `
  -WorkingDirectory $repoRoot

$trigger = New-ScheduledTaskTrigger -Daily -At "9:00AM"

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$description = "Run TechAnalysis BuySkill and SellSkill batch on stocklist.xlsx every morning at 9:00 AM local time."

Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description $description `
  -Force | Out-Null

$timeZone = (Get-TimeZone).DisplayName
Write-Host "Scheduled task '$taskName' created."
Write-Host "Runs daily at 9:00 AM local computer time ($timeZone)."
Write-Host "Repo: $repoRoot"
