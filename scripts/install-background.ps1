$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$nodePath = (Get-Command node.exe).Source
$serverFile = Join-Path $projectRoot 'src\http-server.js'
if (-not (Test-Path -LiteralPath $serverFile)) { throw 'HTTP server not found.' }
& $nodePath (Join-Path $PSScriptRoot 'setup-codex.js')
if ($LASTEXITCODE -ne 0) { throw 'Codex configuration failed.' }
$runtimePath = Join-Path $env:LOCALAPPDATA 'TallyReadOnlyMCP'
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
# Authentication files belong only to this account, administrators and SYSTEM.
& icacls.exe $runtimePath /inheritance:r /grant:r "${userId}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure the local authentication directory.' }
$launcherPath = Join-Path $runtimePath 'launch-hidden.vbs'
$quotedCommand = '"' + $nodePath + '" "' + $serverFile + '"'
$vbsCommand = $quotedCommand.Replace('"', '""')
$vbsDirectory = $projectRoot.Replace('"', '""')
$launcher = @"
Set taskShell = CreateObject("WScript.Shell")
taskShell.CurrentDirectory = "$vbsDirectory"
result = taskShell.Run("$vbsCommand", 0, True)
WScript.Quit result
"@
[System.IO.File]::WriteAllText($launcherPath, $launcher)
$taskName = 'Tally ReadOnly MCP'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('"' + $launcherPath + '"') -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
$principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Local read-only Tally MCP. Starts silently at sign-in. No accounting writes.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Installed and started the Tally ReadOnly MCP task. It will start at Windows sign-in.'
