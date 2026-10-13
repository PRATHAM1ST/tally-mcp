import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { token, port } = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'TallyReadOnlyMCP', 'connection.json'), 'utf8'));
const client = new Client({ name: 'tally-background-check', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const { tools } = await client.listTools();
  const status = await client.callTool({ name: 'tally_status', arguments: {} });
  console.log(JSON.stringify({ mcp_connected: true, read_only_tools: tools.map(t => t.name), tally: status.structuredContent }, null, 2));
} finally { await client.close(); }
