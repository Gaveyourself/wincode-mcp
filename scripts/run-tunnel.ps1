[CmdletBinding()]
param(
    [string]$TunnelClient = "tunnel-client",
    [string]$Profile = "wincode-real",
    [string]$ProfileDir = (Join-Path $HOME ".config\tunnel-client"),
    [int]$McpPort = 48371
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($env:CONTROL_PLANE_API_KEY)) {
    throw "CONTROL_PLANE_API_KEY is not set. Use a runtime API key with Tunnels Read + Use."
}
$TunnelCommand = Get-Command $TunnelClient -ErrorAction Stop
$ProfilePath = Join-Path $ProfileDir "$Profile.yaml"
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
    throw "Tunnel profile is missing: $ProfilePath. Run scripts\init-tunnel.ps1 first."
}

try {
    $Health = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:$McpPort/health" -TimeoutSec 3
    if (-not $Health.ok) { throw "WinCode health endpoint returned ok=false." }
} catch {
    throw "WinCode HTTP MCP is not healthy at http://127.0.0.1:$McpPort/health. Start it first or use scripts\run-stack.ps1. $($_.Exception.Message)"
}

& $TunnelCommand.Source run --profile $Profile --profile-dir $ProfileDir
exit $LASTEXITCODE
