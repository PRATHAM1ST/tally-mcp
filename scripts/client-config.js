import { fileURLToPath } from 'node:url';
console.log(JSON.stringify({ mcpServers: { 'tally-readonly': {
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/server.js', import.meta.url))],
  env: { TALLY_PORT: '9000' },
} } }, null, 2));
