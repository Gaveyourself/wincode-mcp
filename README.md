# WinCode MCP

WinCode MCP is a Windows-first local coding MCP server. It is intentionally developed as a standalone product and does not depend on LiyuanCode MCP.

## V0.1 scope

The first milestone provides:

- MCP v2 stdio transport
- workspace health information
- bounded directory listing
- bounded UTF-8 file reading
- recursive text search without following symlink directories
- managed long-running command processes
- bounded command output retrieval by byte offset
- command status and process-tree termination
- workspace path isolation for built-in file tools
- commands disabled by default and available only in explicit trusted mode

## Requirements

- Windows 10/11
- Node.js 20 or newer (Node.js 22 LTS is recommended)
- npm
- PowerShell 7 is recommended when using the `powershell` command mode

## Install

```powershell
npm install
npm run typecheck
npm test
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

## Initial tools

- `health`
- `list_directory`
- `read_file`
- `search_files`
- `start_command`
- `get_command_status`
- `get_command_output`
- `terminate_command`

## Security model

The built-in file tools canonicalize paths and reject lexical traversal, sibling-prefix tricks, and symlink/junction resolution outside the configured workspace.

Command execution is different: an arbitrary child process can access anything that the Windows user account itself can access. For that reason, V0.1 disables commands by default. `WINCODE_ALLOW_COMMANDS=1` means trusted mode, not OS-level sandboxing.

A later milestone will add Windows-native process isolation (restricted token / Job Object or an equivalent backend) before calling command execution sandboxed.

## Roadmap

### V0.2

- bounded writes and context-checked patching
- Git status/diff/log
- command input and wait semantics
- command policy and audit log
- Windows-native process isolation research/prototype

### V0.3

- clangd / pyright / TypeScript language-server diagnostics
- Streamable HTTP bound to loopback with authentication
- packaging and self-diagnostics

### V0.4+

- WSL backend
- tray application and installer
- optional SSH backend
