# WinCode MCP

WinCode MCP is a Windows-first local coding MCP server. It is intentionally developed as a standalone product and does not depend on LiyuanCode MCP.

## V0.3 scope

V0.3 provides:

- MCP v2 stdio transport
- loopback-only Streamable HTTP transport for Secure MCP Tunnel use
- workspace health information
- bounded directory listing and UTF-8 file reading
- recursive text search without following symlink directories
- bounded file creation/overwrite with optional expected SHA-256 protection
- context-checked single-file unified patch application
- read-only Git status, diff and log with repository-root confinement
- managed long-running command processes
- bounded command output retrieval by byte offset
- command stdin, wait semantics, status and process-tree termination
- workspace path isolation for built-in file and Git tools
- JSONL mutation/command audit log under `.wincode/audit.jsonl`
- commands disabled by default and available only in explicit trusted mode
- independent Windows tunnel scripts/profile using ports 48371/48372

## Requirements

- Windows 10/11
- Node.js 20 or newer (Node.js 22 LTS is recommended)
- npm
- Git for Windows for Git tools
- PowerShell 7 is recommended when using the `powershell` command mode

## Install

```powershell
npm install
npm run typecheck
npm test
npm run build
```

## Run over stdio

Choose exactly one workspace root for the server process:

```powershell
$env:WINCODE_WORKSPACE = "D:\Projects\MyProject"
npm run dev
```

Command execution is intentionally disabled by default. To run in trusted mode:

```powershell
$env:WINCODE_WORKSPACE = "D:\Projects\MyProject"
$env:WINCODE_ALLOW_COMMANDS = "1"
npm run dev
```

`stdio` is the MCP protocol channel, so the server writes human-readable logs only to stderr.


## Run over loopback HTTP

For an OpenAI Secure MCP Tunnel, WinCode provides a local-only HTTP endpoint. It refuses non-loopback bind hosts.

```powershell
$env:WINCODE_WORKSPACE = "D:\Projects\MyProject"
$env:WINCODE_ALLOW_COMMANDS = "1"
npm run start:http
```

Defaults:

- MCP: `http://127.0.0.1:48371/mcp`
- health: `http://127.0.0.1:48371/health`

For the independent `wincode-real` Secure MCP Tunnel setup and the supervised Windows stack script, see [`docs/WINDOWS_TUNNEL.md`](docs/WINDOWS_TUNNEL.md).

## Tools

- `health`
- `list_directory`
- `read_file`
- `write_file`
- `apply_patch`
- `search_files`
- `start_command`
- `get_command_status`
- `get_command_output`
- `send_command_input`
- `wait_command`
- `terminate_command`
- `git_status`
- `git_diff`
- `git_log`

## Safety model

Built-in file tools canonicalize paths and reject lexical traversal, sibling-prefix tricks, and symlink/junction resolution outside the configured workspace. Git tools additionally reject repositories whose root resolves outside the workspace.

`read_file` returns a SHA-256 digest. Supplying it as `expectedSha256` to `write_file` or `apply_patch` makes stale edits fail instead of silently overwriting a newer version.

Command execution is different: an arbitrary child process can access anything that the Windows user account itself can access. For that reason, commands are disabled by default. `WINCODE_ALLOW_COMMANDS=1` means trusted mode, not OS-level sandboxing.

The audit log intentionally records metadata rather than command arguments or shell expressions, reducing the risk of logging secrets. Set `WINCODE_AUDIT=0` to disable it.

## Configuration

- `WINCODE_WORKSPACE`: workspace root; defaults to process working directory
- `WINCODE_ALLOW_COMMANDS=1`: enable trusted command execution
- `WINCODE_MAX_READ_BYTES`: maximum file bytes returned by reads
- `WINCODE_MAX_WRITE_BYTES`: maximum file size accepted by writes/patches
- `WINCODE_COMMAND_OUTPUT_BYTES`: retained command-output ring size
- `WINCODE_GIT_OUTPUT_BYTES`: maximum retained Git stdout
- `WINCODE_AUDIT=0`: disable JSONL audit logging
- `WINCODE_POWERSHELL`: PowerShell executable; defaults to `pwsh.exe`
- `WINCODE_GIT`: Git executable; defaults to `git`
- `WINCODE_HTTP_HOST`: HTTP bind host; only loopback values are accepted, default `127.0.0.1`
- `WINCODE_HTTP_PORT`: local HTTP MCP port, default `48371`

## Roadmap

### V0.4

- clangd / pyright / TypeScript language-server diagnostics
- Windows-native process isolation prototype
- packaging and self-diagnostics

### V0.5+

- WSL backend
- tray application and installer
- optional SSH backend
