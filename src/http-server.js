import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';
import { TallyReader } from './tally.js';

export function createHttpServer({ token, reader = new TallyReader() }) {
  if (!/^[a-f0-9]{64}$/.test(token ?? '')) throw new Error('A 32-byte local authentication token is required. Run the setup script.');
  const expected = Buffer.from(`Bearer ${token}`);
  let active = 0;
  const app = http.createServer(async (req, res) => {
    const port = app.address().port;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403).end('Host denied'); return; }
    // Native desktop MCP clients do not need browser origins or CORS.
    if (req.headers.origin) { res.writeHead(403).end('Browser origins are not allowed'); return; }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ service: 'tally-local-readonly', running: true })); return;
    }
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401).end('Unauthorized'); return; }
    if (req.url !== '/mcp') { res.writeHead(404).end('Not found'); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end('Method not allowed'); return; }
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) { res.writeHead(415).end('JSON required'); return; }
    if (active >= 16) { res.writeHead(429).end('Too many concurrent requests'); return; }
    active++;
    let mcp;
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 128 * 1024) { res.writeHead(413).end('Request too large'); return; }
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { res.writeHead(400).end('Invalid JSON'); return; }
      mcp = createMcpServer(reader);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(500).end('MCP request failed');
      else res.end();
    } finally {
      active--;
      if (mcp) await mcp.close().catch(() => {});
    }
  });
  app.requestTimeout = 15000;
  app.headersTimeout = 10000;
  app.timeout = 90000;
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = join(process.env.LOCALAPPDATA, 'TallyReadOnlyMCP', 'connection.json');
  const { token, port } = JSON.parse(readFileSync(file, 'utf8'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local MCP port');
  const app = createHttpServer({ token });
  app.on('error', e => { console.error(`Local MCP could not start: ${e.code ?? 'error'}`); process.exitCode = 1; });
  app.listen(port, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.closeAllConnections(); app.close(); });
}
