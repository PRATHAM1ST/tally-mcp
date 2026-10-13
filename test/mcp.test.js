import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('real stdio MCP handshake, tools, live query, aggregate, policy and injection rejection', async t => {
  let requests = 0;
  const mock = http.createServer((req, res) => {
    requests++;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      assert.match(body, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
      const data = body.includes('<TYPE>Company</TYPE>') ? '<COMPANY NAME="Demo"><NAME>Demo</NAME></COMPANY>' : '<LEDGER NAME="Cash"><NAME>Cash</NAME><PARENT>Cash-in-Hand</PARENT><CLOSINGBALANCE TYPE="Amount">100.10</CLOSINGBALANCE></LEDGER>';
      res.end(`<ENVELOPE><BODY><DATA><COLLECTION>${data}</COLLECTION></DATA></BODY></ENVELOPE>`);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/server.js', import.meta.url))], env: { TALLY_PORT: String(mock.address().port) }, stderr: 'pipe' });
  const client = new Client({ name: 'integration-test', version: '1' });
  t.after(() => client.close());
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const status = await client.callTool({ name: 'tally_status', arguments: {} });
  assert.equal(status.structuredContent.connected, true);
  const result = await client.callTool({ name: 'tally_query', arguments: { company: 'Demo', entity: 'ledgers', fields: ['NAME', 'CLOSINGBALANCE'] } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.records[0].CLOSINGBALANCE, '100.10');
  const total = await client.callTool({ name: 'tally_aggregate', arguments: { company: 'Demo', entity: 'ledgers', operation: 'sum', value_field: 'CLOSINGBALANCE' } });
  assert.equal(total.structuredContent.groups[0].value, '100.1');
  const before = requests;
  const bad = await client.callTool({ name: 'tally_query', arguments: { company: 'Demo', entity: 'ledgers', xml: '<IMPORTDATA/>' } });
  assert.equal(bad.isError, true);
  const write = await client.callTool({ name: 'tally_update', arguments: { action: 'Delete' } });
  assert.equal(write.isError, true);
  assert.equal(requests, before);
  const policy = await client.readResource({ uri: 'tally://policy' });
  assert.match(policy.contents[0].text, /DO NOT UPDATE ANYTHING, READ ONLY DATA/);
});
