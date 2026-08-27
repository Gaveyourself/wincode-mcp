[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^tunnel_[A-Za-z0-9]+$')]
    [string]$TunnelId,

    [string]$TunnelClient = "tunnel-client",
    [string]$Profile = "wincode-real",
    [string]$ProfileDir = (Join-Path $HOME ".config\tunnel-client"),
    [int]$McpPort = 48371,
    [int]$HealthPort = 48372,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
if ($McpPort -lt 1 -or $McpPort -gt 65535) { throw "Invalid MCP port: $McpPort" }
if ($HealthPort -lt 1 -or $HealthPort -gt 65535) { throw "Invalid tunnel health port: $HealthPort" }
if ($McpPort -eq $HealthPort) { throw "MCP and tunnel health ports must be different." }

$TunnelCommand = Get-Command $TunnelClient -ErrorAction Stop
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$ProfilePath = Join-Path $ProfileDir "$Profile.yaml"
if ((Test-Path -LiteralPath $ProfilePath) -and -not $Force) {
    throw "Tunnel profile already exists: $ProfilePath. Re-run with -Force only if replacement is intended."
}

$Args = @(
    "init",
    "--sample", "sample_mcp_remote_no_auth",
    "--profile", $Profile,
    "--profile-dir", $ProfileDir,
    "--tunnel-id", $TunnelId,
    "--mcp-server-url", "http://127.0.0.1:$McpPort/mcp",
    "--health-listen-addr", "127.0.0.1:$HealthPort"
)
if ($Force) { $Args += "--force" }

& $TunnelCommand.Source @Args
if ($LASTEXITCODE -ne 0) { throw "tunnel-client init failed with exit code $LASTEXITCODE" }

Write-Host "Created tunnel profile: $ProfilePath"
Write-Host "Profile: $Profile"
Write-Host "Tunnel ID: $TunnelId"
Write-Host "MCP target: http://127.0.0.1:$McpPort/mcp"
Write-Host "Tunnel health UI: http://127.0.0.1:$HealthPort/ui"
Write-Host "Runtime key is read from CONTROL_PLANE_API_KEY; it is not written into this script."
