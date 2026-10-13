# Connect and use your Tally MCP

The read-only rule remains **DO NOT UPDATE ANYTHING, READ ONLY DATA** in both transports.

## Your Codex Desktop setup is installed

- MCP name: **tally-readonly**
- Address: **http://127.0.0.1:9174/mcp**
- Codex configuration: `C:\Users\admin\.codex\config.toml`
- Automatic startup: Task Scheduler > **Tally ReadOnly MCP**, at Windows sign-in for your account
- Server folder: `C:\Users\admin\Desktop\tally-mcp` — keep it here, or rerun installation after moving it

Completely quit and reopen Codex, then start a new chat. This active conversation may not discover newly added MCP tools until reconnecting. Your other configuration was preserved and a timestamped backup was made before editing it.

Codex shares its MCP configuration across supported local clients and supports both stdio and Streamable HTTP. This setup uses its documented HTTP URL and authorization-header settings. [Official OpenAI MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Try this prompt:

> Use tally-readonly. Check tally_status, list loaded companies using tally_companies, and tell me which companies I can query. DO NOT UPDATE ANYTHING, READ ONLY DATA.

Then:

> For [exact company name], show the trial balance from 2026-04-01 to 2026-09-30 using tally_report. Include the company, period and data fetch time.

> For [exact company name], find unpaid receivables using the native bills_receivable report.

If the status says Tally is offline, open TallyPrime, load a company and ensure it serves XML HTTP on port 9000. The MCP automatically retries through each new tool call; no re-import or server restart is required after Tally becomes available.

## Connect another LLM application

MCP connects to the **application hosting the model**, not directly to model weights. The application must support MCP and tool use. A plain chat website or bare model API cannot automatically reach this PC's localhost server.

Two connection options are available:

| Option | Settings | How it runs |
|---|---|---|
| Streamable HTTP | URL `http://127.0.0.1:9174/mcp`, plus authorization header | Shares the existing background process |
| stdio/local command | Command `C:\Program Files\nodejs\node.exe`; argument `C:\Users\admin\Desktop\tally-mcp\src\server.js`; environment `TALLY_PORT=9000` | The application starts its own read-only instance |

For HTTP, the complete ready-to-copy client entry, including its local authentication header, is in:

`C:\Users\admin\AppData\Local\TallyReadOnlyMCP\mcp-http-client.json`

Merge its `tally-readonly` entry into your application's existing `mcpServers` object. Do not replace unrelated MCP entries. Keep this file private: the header is the password for local MCP access. Applications with a form-based UI should use Streamable HTTP, the URL above, and the `Authorization` header from this file. Browser-origin requests are intentionally rejected; use a native desktop host.

For stdio, use [mcp-client.json](mcp-client.json). This file has no HTTP token because the host communicates directly with its own child process.

### LM Studio: a local model option

Load a local model that supports tool use. Open **Program > Install > Edit mcp.json** and merge the HTTP entry above, or the stdio entry. Enable the MCP tools for the chat and ask the status/company prompt. LM Studio documents both transports and the same JSON configuration format. [LM Studio MCP instructions](https://lmstudio.ai/docs/app/mcp).

Using a downloaded local model and local MCP keeps model processing on this PC. Model quality, tool-calling reliability, context capacity and hardware requirements still vary.

### Cursor

Merge the HTTP entry into `C:\Users\admin\.cursor\mcp.json`, or `.cursor/mcp.json` for a single project. Enable the server in Cursor's MCP settings and use its tool-capable chat mode. [Cursor MCP configuration](https://prod.cursor.com/docs/mcp).

### Claude Desktop

Use **Settings > Developer > Edit Config** and merge the **stdio** entry from [mcp-client.json](mcp-client.json) into `%APPDATA%\Claude\claude_desktop_config.json`. Completely quit and reopen the app. This uses its own server process and works independently of the background HTTP listener. [MCP's Claude Desktop setup guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers).

### Other apps and cloud-only connectors

Use the HTTP or stdio settings if the app supports them. Some hosted connectors require a publicly reachable URL or OAuth and cannot use a localhost bearer-token server. Those are not compatible with this strictly local setup. No tunnel or public endpoint has been created.

Codex and other cloud-model apps can send returned Tally records to their model provider. **A local MCP does not make a cloud model local.** Choose a local model host if accounting data must remain entirely on the PC. The read-only protection applies to this MCP; other tools available to a model remain governed by their own permissions.

## Startup and troubleshooting

The task starts **after Windows sign-in**, rather than before login. No Codex window or terminal is required. It remains active while this account is logged in, including while the screen is locked. The PC must be awake. Tally itself is not automatically launched or logged into by this task.

Check the background connection from this project folder:

```powershell
npm.cmd run background:check
```

Expected: `mcp_connected: true`, six read-only tools, plus a separate Tally connection result. At setup time the MCP passed its connection test, while Tally's port 9000 was offline.

Inspect or start the task:

```powershell
Get-ScheduledTask -TaskName 'Tally ReadOnly MCP'
Start-ScheduledTask -TaskName 'Tally ReadOnly MCP'
```

Disable future automatic startup (does not stop an already running instance):

```powershell
Disable-ScheduledTask -TaskName 'Tally ReadOnly MCP'
```

Re-enable it:

```powershell
Enable-ScheduledTask -TaskName 'Tally ReadOnly MCP'
```

To stop the current background task, use **Task Scheduler > Tally ReadOnly MCP > End**. Confirm `/health` stops responding. Do not terminate unrelated Node.js processes.

Repair/reinstall after moving the folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-background.ps1
```

The installer retains the local authentication token, updates only its managed Codex entry and named scheduled task, and preserves unrelated Codex settings. The startup task must be ended before reinstalling a moved server so that the new path takes effect. Changing the local HTTP port also requires reinstalling and restarting the task.

The authentication files are in `%LOCALAPPDATA%\TallyReadOnlyMCP` with access restricted to your account, administrators and SYSTEM. They are separate from source files and contain no Tally accounting records. A hidden launcher keeps the process windowless. No firewall or Tally settings were changed.
