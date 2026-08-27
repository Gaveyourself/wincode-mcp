[CmdletBinding()]
param(
    [string]$Workspace = $env:WINCODE_WORKSPACE,
    [switch]$AllowCommands,
    [string]$TunnelClient = "tunnel-client",
    [string]$Profile = "wincode-real",
    [string]$ProfileDir = (Join-Path $HOME ".config\tunnel-client"),
    [int]$McpPort = 48371,
    [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Entrypoint = Join-Path $Root "dist\src\http.js"
$HealthUrl = "http://127.0.0.1:$McpPort/health"

if ([string]::IsNullOrWhiteSpace($Workspace)) {
    throw "Workspace is required. Pass -Workspace <path> or set WINCODE_WORKSPACE."
}
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
    throw "Workspace directory does not exist: $Workspace"
}
if (-not (Test-Path -LiteralPath $Entrypoint -PathType Leaf)) {
    throw "Built HTTP entrypoint is missing: $Entrypoint. Run 'npm run build' first."
}
if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
    throw "CONTROL_PLANE_API_KEY is not set. Use a runtime API key with Tunnels Read + Use."
}
$TunnelCommand = Get-Command $TunnelClient -ErrorAction Stop
$ProfilePath = Join-Path $ProfileDir "$Profile.yaml"
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
    throw "Tunnel profile is missing: $ProfilePath. Run scripts\init-tunnel.ps1 first."
}

$env:WINCODE_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).Path
$env:WINCODE_HTTP_HOST = "127.0.0.1"
$env:WINCODE_HTTP_PORT = [string]$McpPort
if ($AllowCommands) { $env:WINCODE_ALLOW_COMMANDS = "1" }

$HttpProcess = $null
$StartedHere = $false

function Test-WinCodeHealth {
    try {
        $Result = Invoke-RestMethod -Method Get -Uri $HealthUrl -TimeoutSec 2
        return [bool]$Result.ok
    } catch {
        return $false
    }
}

try {
    if (Test-WinCodeHealth) {
        Write-Host "Reusing healthy WinCode HTTP MCP at $HealthUrl"
    } else {
        $HttpProcess = Start-Process -FilePath "node" -ArgumentList @($Entrypoint) -WorkingDirectory $Root -PassThru -NoNewWindow
        $StartedHere = $true
        $Deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
        while ((Get-Date) -lt $Deadline) {
            if ($HttpProcess.HasExited) {
                throw "WinCode HTTP MCP exited before becoming healthy (exit code $($HttpProcess.ExitCode))."
            }
            if (Test-WinCodeHealth) { break }
            Start-Sleep -Milliseconds 500
        }
        if (-not (Test-WinCodeHealth)) {
            throw "Timed out waiting for WinCode HTTP MCP at $HealthUrl"
        }
        Write-Host "Started WinCode HTTP MCP (PID $($HttpProcess.Id)): $HealthUrl"
    }

    & $TunnelCommand.Source doctor --profile $Profile --profile-dir $ProfileDir --explain
    if ($LASTEXITCODE -ne 0) { throw "tunnel-client doctor failed with exit code $LASTEXITCODE" }

    Write-Host "Starting independent WinCode tunnel profile '$Profile'..."
    & $TunnelCommand.Source run --profile $Profile --profile-dir $ProfileDir
    $TunnelExitCode = $LASTEXITCODE
} finally {
    if ($StartedHere -and $null -ne $HttpProcess -and -not $HttpProcess.HasExited) {
        Stop-Process -Id $HttpProcess.Id -Force -ErrorAction SilentlyContinue
        $HttpProcess.WaitForExit(5000) | Out-Null
    }
}

exit $TunnelExitCode
