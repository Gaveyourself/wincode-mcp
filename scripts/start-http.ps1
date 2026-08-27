[CmdletBinding()]
param(
    [string]$Workspace = $env:WINCODE_WORKSPACE,
    [switch]$AllowCommands,
    [int]$Port = 48371
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Entrypoint = Join-Path $Root "dist\src\http.js"

if ([string]::IsNullOrWhiteSpace($Workspace)) {
    throw "Workspace is required. Pass -Workspace <path> or set WINCODE_WORKSPACE."
}
if (-not (Test-Path -LiteralPath $Workspace -PathType Container)) {
    throw "Workspace directory does not exist: $Workspace"
}
if (-not (Test-Path -LiteralPath $Entrypoint -PathType Leaf)) {
    throw "Built HTTP entrypoint is missing: $Entrypoint. Run 'npm run build' first."
}
if ($Port -lt 1 -or $Port -gt 65535) {
    throw "Invalid port: $Port"
}

$env:WINCODE_WORKSPACE = (Resolve-Path -LiteralPath $Workspace).Path
$env:WINCODE_HTTP_HOST = "127.0.0.1"
$env:WINCODE_HTTP_PORT = [string]$Port
if ($AllowCommands) {
    $env:WINCODE_ALLOW_COMMANDS = "1"
}

& node $Entrypoint
exit $LASTEXITCODE
