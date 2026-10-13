# Local, read-only Tally MCP

**DO NOT UPDATE ANYTHING, READ ONLY DATA**

A local MCP server that lets an MCP-capable LLM read current Tally data. It uses Tally's XML export interface on `127.0.0.1`, with MCP over stdio or authenticated local HTTP. Every data tool reads Tally again. There is no manual export, scheduled refresh, cloud service, external API key, database mirror, or accounting-data file written by this server.

## Installed background connection

Codex is configured in `C:\Users\admin\.codex\config.toml` to connect to **http://127.0.0.1:9174/mcp**. The Windows scheduled task **Tally ReadOnly MCP** starts the server silently when this Windows user signs in and keeps it running independently of Codex. The task restarts after failure up to three times at one-minute intervals. It runs as the current user without elevation and has no normal execution time limit.

Restart Codex to load the connection, then ask it to use `tally_status` and `tally_companies`. The background MCP can be running while Tally is offline; live accounting reads still need Tally and a loaded company.

Run `npm.cmd run background:check` to verify the background MCP and Tally separately. Open `http://127.0.0.1:9174/health` to check only the background process.

See [CONNECTING.md](CONNECTING.md) for Codex, LM Studio, Cursor, Claude Desktop, generic MCP settings, startup controls and local privacy.

## Start here

Node.js 22 or newer is required. Dependencies are already installed in this workspace. On another machine, run `npm.cmd ci --ignore-scripts` once; this installation needs internet access. Runtime does not.

1. Open TallyPrime and load the company you want to query.
2. Ensure its HTTP interface is enabled: **F1 Help > Settings > Connectivity > Client/Server Configuration**, with Tally acting as **Server** or **Both**, using port **9000**. Menu wording varies by version. Restart Tally if its configuration asks you to. This server never modifies Tally settings or enables services itself.
3. In this folder run `npm.cmd run doctor`. It must show `"connected": true`. The Tally Gateway/licensing service at port **9999** is not the accounting data interface.
4. Codex is already configured for the background server. For another stdio-capable LLM application, add the entry from [mcp-client.json](mcp-client.json) to its MCP configuration, then restart/reconnect it. This stdio configuration launches its own instance automatically. VS Code users can use the included `.vscode/mcp.json`. For sharing the running HTTP instance, see [CONNECTING.md](CONNECTING.md).
5. Ask: **List the loaded Tally companies, then show the trial balance for [exact company name] from 2026-04-01 to 2026-09-30.**

To regenerate the configuration with correct absolute paths after moving the folder: `npm.cmd run config`. Use `node src/server.js` to launch directly. A running stdio server normally waits silently for an MCP client; it is not a web page.

**Connection status at build time:** TallyPrime is installed and its `tally.ini` specifies `ServerPort=9000`, but only background gateway/scheduler processes were running. Nothing was listening for accounting requests at `127.0.0.1:9000`. The MCP handshake and data workflow were tested with a local mock; actual company data remains unverified until Tally is open and serving it. Opening/loading your company may require your Tally credentials.

Tally documents the required running instance, loaded company, HTTP port and POST-based XML protocol in its [integration prerequisites](https://help.tallysolutions.com/pre-requisites-for-integrations/).

## Available tools

| Tool | Purpose |
|---|---|
| `tally_status` | Test the local data connection |
| `tally_companies` | Discover loaded and permitted companies |
| `tally_catalog` | Discover supported entities, reports and query conventions |
| `tally_query` | Filter, sort, project and paginate live records |
| `tally_aggregate` | Count, sum, minimum, maximum and average, optionally grouped |
| `tally_report` | Read a supported native financial report |

Supported entities: companies, ledgers, groups, vouchers, stock items/groups/categories, godowns, units, currencies, cost centres/categories, voucher types and budgets. Voucher reads request native accounting and inventory entries, with the nested structure retained. Fields actually returned depend on Tally's version, enabled features and export behavior.

Reports: trial balance, balance sheet, profit and loss, day book, stock summary, ledger vouchers, bills receivable and bills payable. Report IDs and `LedgerName` come from Tally's [XML reference](https://help.tallysolutions.com/sample-xml/). An unavailable report produces an error; it must not be interpreted as a zero balance.

This supports a broad range of accounting and inventory questions using available data. It cannot promise every conceivable question, unavailable/custom fields, arbitrary SQL, custom report names or user-supplied TDL.

## Query examples

Discover companies first; substitute the exact company name below. Use a small query without `fields` to inspect available native field names. Attribute values use `@NAME`; an XML scalar carrying a TYPE attribute is unwrapped automatically for filtering and aggregation.

Ledger balances:

```json
{
  "company": "Your Company",
  "entity": "ledgers",
  "from_date": "2026-04-01",
  "to_date": "2026-09-30",
  "filters": [{ "field": "PARENT", "op": "eq", "value": "Sundry Debtors" }],
  "fields": ["NAME", "@NAME", "PARENT", "CLOSINGBALANCE"],
  "limit": 100
}
```

`PARENT` matches the immediate group; it does not implicitly include descendant groups. Read `groups` and follow their parents for hierarchical questions.

Sales ledger line totals, with `tally_aggregate`:

```json
{
  "company": "Your Company",
  "entity": "vouchers",
  "from_date": "2026-04-01",
  "to_date": "2026-09-30",
  "row_path": "ALLLEDGERENTRIES.LIST",
  "filters": [
    { "field": "_parent/VOUCHERTYPENAME", "op": "eq", "value": "Sales" },
    { "field": "_parent/ISCANCELLED", "op": "eq", "value": "No" },
    { "field": "_parent/ISOPTIONAL", "op": "eq", "value": "No" }
  ],
  "operation": "sum",
  "value_field": "AMOUNT",
  "group_by": ["LEDGERNAME"]
}
```

Inspect the returned structure first: some versions use `LEDGERENTRIES.LIST`. These are signed ledger movements, not automatically net sales; party and tax ledger entries are separate groups. Custom voucher types require their actual names. Missing filter fields never match. For recognized accounting totals prefer native financial reports.

Balance sheet with `tally_report`:

```json
{
  "company": "Your Company",
  "report": "balance_sheet",
  "from_date": "2026-04-01",
  "to_date": "2026-09-30"
}
```

Filters: `eq`, `ne`, `contains`, `starts_with`, `gt`, `gte`, `lt`, `lte`. Text comparisons ignore case; field names are case-sensitive. Filters are ANDed. `/` separates nested paths because Tally's XML tags contain dots. Nested values use any-match, except `ne`, which requires all values to differ. Use `row_path` to filter several fields on the same nested entry. `_parent/FIELD` then reads its parent voucher.

Amounts stay signed and are aggregated using decimal arithmetic (50 significant digits), never binary floating point. Missing values, units, currency labels, foreign-exchange expressions and Dr/Cr suffixes are rejected for numeric aggregation. Interpret these explicitly using the source data or use a native report. Do not sum different units or currencies.

## Enforced read-only boundary

- The only network operation is a source-controlled XML **Export** template sent to IPv4 loopback. XML uses HTTP POST even for reads; the export envelope determines the operation.
- There is no import/update/create/delete tool, write toggle, raw request tool, arbitrary formula interface, SQL interface, file access tool or shell tool.
- Strict input schemas reject unknown parameters. Entity/report names are allowlisted; company and ledger strings are XML-escaped. Company names must match a currently loaded company.
- The only request-local TDL is a fixed native collection definition and optional fixed voucher-date filter. It includes no object mutation or action. Nothing is installed into Tally. This follows Tally's documented [collection export pattern](https://help.tallysolutions.com/article/DeveloperReference/integration-capabilities/case_study_1.htm/).
- The Tally transport rejects remote hosts, arbitrary URLs and redirects, ignores HTTP proxy variables, bounds response size and time, and serializes outgoing requests. The optional HTTP MCP listener binds only `127.0.0.1`, requires a random bearer token, verifies the Host header, rejects browser origins and caps incoming request sizes/concurrency. Its unauthenticated `/health` endpoint exposes only process health, never accounting data.
- XML DTD/entity declarations are rejected. Tally's invalid control characters are replaced with U+FFFD and disclosed in response warnings. Native decimal strings and leading zeros are preserved.
- The policy is published in MCP instructions, every tool description and the `tally://policy` resource. Read-only tool annotations are advisory; code is the enforcement.

The boundary covers operations exposed by **this MCP**, with trusted local source, dependencies and Tally installation. It cannot prevent writes made directly in Tally, through another tool, or by software with direct access to Tally's writable HTTP interface. Existing Tally extensions can also change native report behavior. The MCP does not modify Tally permissions, firewall rules or company settings.

For an additional independent boundary, have your Tally administrator restrict the company user to the necessary read/report/export permissions where supported. Never expose Tally's HTTP port to the internet. These are deployment controls outside the MCP's tool interface.

## Local privacy and configuration

The server itself sends accounting data only back to its local MCP client. **Use a local LLM in a local MCP-capable application for fully local processing.** A cloud-backed LLM application may send tool results to its model provider; local MCP transport alone does not prevent that.

Environment variables are supplied by the host's MCP configuration; `.env` files are not loaded automatically:

| Variable | Default | Meaning |
|---|---|---|
| `TALLY_PORT` | `9000` | Local Tally data port |
| `TALLY_TIMEOUT_MS` | `30000` | Per-export deadline, up to 120000 ms |
| `TALLY_MAX_RESPONSE_MB` | `32` | Export size cap, at most 128 MB |
| `TALLY_ALLOWED_COMPANIES` | unset | Optional JSON array of exact permitted company names |

Example: `"TALLY_ALLOWED_COMPANIES": "[\"My Company\"]"`. This hides other companies from discovery and prevents reading them through this MCP. An empty list is rejected to prevent configuration ambiguity.

There is no financial-data cache or application data log. The host may keep chat history. Dependencies and configuration files are ordinary local software files; the strict read-only promise applies to Tally accounting data.

## Live-read limits

Every query includes the source and fetch timestamp. Query pagination happens in memory after a complete bounded export. Each page refetches Tally and can change if someone edits accounts between calls; it is not a transactional snapshot. Use aggregates for totals from one exported collection. Company validation and the subsequent export are also separate requests, so keep the requested company loaded.

Supply both dates for a financial period. Without dates, Tally's active period applies. Voucher dates are filtered in the fixed collection definition; master balances and native reports use Tally's period variables. Other filters run locally, so they do not reduce the XML downloaded. Narrow voucher date ranges for large companies. Oversized exports/results fail explicitly; there is no silent truncation. Query pages are capped at 500 rows and MCP responses at 4 MB.

## Verification

Run `npm.cmd test` for security and real MCP stdio integration tests using a local mock Tally service. Tests cover export-only templates, XML injection, unknown/write commands, date validation, remote-host rejection, unsafe field paths, DTDs, UTF-16, exact decimal arithmetic, company restrictions, fresh reads, redirects, response limits and timeouts. `npm.cmd run doctor` separately checks the real Tally connection.

The tests verify the bridge and policy, not the behavior of a live Tally version or custom TDL installed there. Validate a known trial balance against Tally once connected before relying on financial answers.
