import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const runtime = join(process.env.LOCALAPPDATA, 'TallyReadOnlyMCP');
mkdirSync(runtime, { recursive: true });
const connectionFile = join(runtime, 'connection.json');
const connection = existsSync(connectionFile) ? JSON.parse(readFileSync(connectionFile, 'utf8')) : { port: 9174, token: randomBytes(32).toString('hex') };
if (!/^[a-f0-9]{64}$/.test(connection.token) || !Number.isInteger(connection.port)) throw new Error('Invalid existing connection settings');
writeFileSync(connectionFile, JSON.stringify(connection, null, 2), { mode: 0o600 });
const configFile = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml');
const original = existsSync(configFile) ? readFileSync(configFile, 'utf8') : '';
const start = '# BEGIN LOCAL TALLY READONLY MCP';
const end = '# END LOCAL TALLY READONLY MCP';
let cleaned = original;
if (original.includes(start)) {
  const a = original.indexOf(start), b = original.indexOf(end, a);
  if (b < 0) throw new Error('Incomplete managed config section; refusing to change configuration.');
  cleaned = original.slice(0, a) + original.slice(b + end.length);
}
if (/^\[mcp_servers\.tally-readonly(?:\]|\.)/m.test(cleaned)) throw new Error('An unmanaged tally-readonly entry already exists. Refusing to overwrite it.');
const block = `${start}\n[mcp_servers.tally-readonly]\nurl = "http://127.0.0.1:${connection.port}/mcp"\nhttp_headers = { Authorization = "Bearer ${connection.token}" }\nstartup_timeout_sec = 20\ntool_timeout_sec = 90\nenabled = true\n${end}\n`;
if (existsSync(configFile)) copyFileSync(configFile, `${configFile}.before-tally-${Date.now()}.bak`);
writeFileSync(configFile, `${cleaned.trimEnd()}\n\n${block}`, { mode: 0o600 });
// A local configuration artifact for other HTTP-capable desktop MCP clients.
writeFileSync(join(runtime, 'mcp-http-client.json'), JSON.stringify({ mcpServers: { 'tally-readonly': {
  url: `http://127.0.0.1:${connection.port}/mcp`, headers: { Authorization: `Bearer ${connection.token}` },
} } }, null, 2), { mode: 0o600 });
console.log(`Configured Codex for http://127.0.0.1:${connection.port}/mcp. Token stored locally; not printed.`);
