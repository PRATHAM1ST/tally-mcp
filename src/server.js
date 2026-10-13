import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CATALOG, REPORTS, POLICY, INSTRUCTIONS } from './catalog.js';
import { TallyReader } from './tally.js';
import { literal, field, period, queryShape, checkPeriod } from './validation.js';
import { selectRows, paginate, aggregate } from './query.js';
import { pathToFileURL } from 'node:url';

export function createMcpServer(reader = new TallyReader()) {
const server = new McpServer({ name: 'tally-local-readonly', version: '1.0.0' }, { instructions: INSTRUCTIONS });
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function tool(name, description, schema, handler) {
  server.registerTool(name, { description: `${POLICY}. ${description}`, inputSchema: schema, annotations }, async args => {
    try {
      const output = await handler(schema.parse(args));
      const text = JSON.stringify(output);
      if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('MCP result exceeds 4 MB. Reduce limit, select fields, or narrow dates. No partial result returned.');
      return { content: [{ type: 'text', text }], structuredContent: output };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ policy: POLICY, error: e.message }) }] }; }
  });
}

tool('tally_status', 'Check the local Tally data connection. Does not change configuration.', z.object({}).strict(), () => reader.status());
tool('tally_companies', 'List currently loaded, permitted companies live. Use an exact company name in subsequent reads.', z.object({}).strict(), () => reader.companies());
tool('tally_catalog', 'Describe available data, reports, field paths, limits and safe query patterns.', z.object({}).strict(), async () => ({
  policy: POLICY, entities: Object.keys(CATALOG), reports: REPORTS, instructions: INSTRUCTIONS,
  field_paths: 'Native XML names are case-sensitive. Use NAME or @NAME, PARENT, CLOSINGBALANCE, VOUCHERTYPENAME, DATE. Slash traverses nesting: ALLLEDGERENTRIES.LIST/LEDGERNAME. Query a small sample to discover fields.',
  row_path: 'To aggregate voucher ledger lines use row_path ALLLEDGERENTRIES.LIST (or LEDGERENTRIES.LIST if present). Parent voucher fields become _parent/DATE or _parent/VOUCHERTYPENAME.',
  defaults: 'Without dates Tally uses its current period. Supply both dates for reproducible financial questions. Filters run locally after a bounded live export; date filters for vouchers also run in Tally.',
  limitations: 'No arbitrary SQL, expressions, custom TDL or UDF report names. Availability of native fields, nested details and reports depends on Tally version and configuration. Large exports fail instead of producing incomplete totals.',
}));

async function readRows(args) {
  checkPeriod(args);
  const { company, entity, from_date, to_date } = args;
  const result = await reader.read({ company, entity, from_date, to_date });
  const records = selectRows(result.records, args.filters, args.row_path);
  const { records: _records, ...meta } = result;
  return { records, meta };
}

tool('tally_query', 'Read/filter live masters and vouchers with native nested details. All filters are AND; nested values use any-match except ne. Page through all results; each page reads live again.', z.object({
  ...queryShape,
  row_path: field.optional(), fields: z.array(field).min(1).max(50).optional(),
  offset: z.number().int().min(0).max(10000000).default(0), limit: z.number().int().min(1).max(500).default(100),
  sort_by: field.optional(), sort_numeric: z.boolean().default(false), descending: z.boolean().default(false),
}).strict(), async args => {
  const { records, meta } = await readRows(args);
  return { ...meta, ...paginate(records, args), snapshot: false };
});

tool('tally_aggregate', 'Compute decimal aggregates on a complete live filtered export. Use row_path for voucher line amounts. Rejects missing, ambiguous or formatted amounts, rather than giving misleading totals.', z.object({
  ...queryShape, row_path: field.optional(), operation: z.enum(['count', 'sum', 'min', 'max', 'average']),
  value_field: field.optional(), group_by: z.array(field).max(5).default([]),
}).strict(), async args => {
  if (args.operation !== 'count' && !args.value_field) throw new Error('value_field is required.');
  const { records, meta } = await readRows(args);
  return { ...meta, ...aggregate(records, args) };
});

tool('tally_report', 'Export an allowlisted native financial report live, preserving its XML structure as JSON. Requires ledger for ledger_vouchers. Unsupported reports return errors.', z.object({
  company: literal, report: z.enum(Object.keys(REPORTS)), ledger: literal.optional(), ...period,
}).strict(), args => reader.report(args));

server.registerResource('read-only-policy', 'tally://policy', { description: POLICY, mimeType: 'text/plain' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: INSTRUCTIONS }] }));
return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createMcpServer().connect(new StdioServerTransport());
}
