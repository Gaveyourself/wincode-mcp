# Windows Secure MCP Tunnel

WinCode uses an independent OpenAI MCP tunnel. It does not reuse the LiyuanCode tunnel ID, profile, or local ports.

Default local layout:

- WinCode HTTP MCP: `http://127.0.0.1:48371/mcp`
- WinCode health: `http://127.0.0.1:48371/health`
- tunnel-client operator health/UI: `127.0.0.1:48372`
- tunnel-client profile: `wincode-real`

The MCP HTTP server refuses non-loopback bind addresses. The only component that talks to the OpenAI control plane is `tunnel-client` over its outbound connection.

## 1. Build WinCode

From the repository root in PowerShell:

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## 2. Create a separate tunnel

Create a new tunnel in OpenAI Tunnels management and copy its `tunnel_...` ID. Do not reuse the LiyuanCode tunnel ID.

Create or use a runtime API key whose principal has Tunnels Read + Use. The long-lived tunnel daemon should use the runtime key, not an admin key.

Set the runtime key for the current PowerShell session:

```powershell
$env:CONTROL_PLANE_API_KEY = "<runtime-api-key>"
```

Do not commit the key to this repository or put it in a tunnel YAML file as plaintext.

## 3. Initialize the independent WinCode profile

`tunnel-client` must be installed and available on `PATH` (or pass its full executable path with `-TunnelClient`).

```powershell
.\scripts\init-tunnel.ps1 -TunnelId "tunnel_REPLACE_WITH_NEW_WINCODE_ID"
```

This creates:

```text
$HOME\.config\tunnel-client\wincode-real.yaml
```

with these endpoints:

```text
MCP target:       http://127.0.0.1:48371/mcp
Tunnel health/UI: http://127.0.0.1:48372
```

The generated profile references `CONTROL_PLANE_API_KEY`; it should not contain the runtime key itself.

## 4. Run WinCode and the tunnel together

For read/write/Git access but no arbitrary command execution:

```powershell
.\scripts\run-stack.ps1 -Workspace "D:\Projects"
```

For full trusted coding mode, including command execution:

```powershell
.\scripts\run-stack.ps1 -Workspace "D:\Projects" -AllowCommands
```

`-AllowCommands` means trusted mode. Commands run with the permissions of the Windows user account; V0.3 does not claim OS-level sandboxing.

`run-stack.ps1` performs the following sequence:

1. Reuses a healthy WinCode HTTP server if one is already running, otherwise starts one on `127.0.0.1:48371`.
2. Waits for `/health` to become ready.
3. Runs `tunnel-client doctor --explain` for `wincode-real`.
4. Starts `tunnel-client run --profile wincode-real` in the foreground.
5. When the tunnel exits, stops only the WinCode HTTP process that the script itself started.

## 5. Separate-process troubleshooting

Start only the HTTP MCP:

```powershell
.\scripts\start-http.ps1 -Workspace "D:\Projects" -AllowCommands
```

In another PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:48371/health
```

Validate only the tunnel profile:

```powershell
.\scripts\doctor-tunnel.ps1
```

Run only the tunnel after the HTTP MCP is healthy:

```powershell
.\scripts\run-tunnel.ps1
```

The tunnel-client local UI is normally available at:

```text
http://127.0.0.1:48372/ui
```

## 6. ChatGPT side

Keep `run-stack.ps1` running while the WinCode connector is discovered and while ChatGPT is using WinCode. Register the new WinCode tunnel separately from the existing LiyuanCode connector so both tools can coexist.

Expected logical layout:

```text
ChatGPT
├── LiyuanCode_MCP -> LiyuanCode tunnel -> liyuan01
└── WinCode_MCP    -> WinCode tunnel    -> Windows
```
