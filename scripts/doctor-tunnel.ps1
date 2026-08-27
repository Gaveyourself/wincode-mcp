[CmdletBinding()]
param(
    [string]$TunnelClient = "tunnel-client",
    [string]$Profile = "wincode-real",
    [string]$ProfileDir = (Join-Path $HOME ".config\tunnel-client")
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

& $TunnelCommand.Source doctor --profile $Profile --profile-dir $ProfileDir --explain
exit $LASTEXITCODE
