import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/http-server.js';

test('background MCP requires authentication, blocks browser origins and supports multiple clients', async t => {
  const token = randomBytes(32).toString('hex');
  const app = createHttpServer({ token, reader: { status: async () => ({ connected: true, mock: true }) } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); app.close(); });
  const url = `http://127.0.0.1:${app.address().port}`;
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: 'bad' })).status, 400);
  assert.equal((await fetch(`${url}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ huge: 'x'.repeat(140000) }) })).status, 413);
  const rebinding = await new Promise(resolve => {
    http.get(`${url}/health`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(rebinding, 403);
  for (let i = 0; i < 2; i++) {
    const client = new Client({ name: `http-test-${i}`, version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      assert.equal((await client.listTools()).tools.length, 6);
      assert.equal((await client.callTool({ name: 'tally_status', arguments: {} })).structuredContent.connected, true);
      assert.equal((await client.callTool({ name: 'tally_update', arguments: {} })).isError, true);
    } finally { await client.close(); }
  }
});
