import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { buildExport, parseResponse } from '../src/xml.js';
import { config, field } from '../src/validation.js';
import { TallyReader } from '../src/tally.js';
import { aggregate, selectRows, paginate } from '../src/query.js';
import { CATALOG, REPORTS } from '../src/catalog.js';

test('every catalog template is export-only with immutable native definitions', () => {
  for (const entity of Object.keys(CATALOG)) {
    const xml = buildExport({ kind: 'collection', entity, company: 'Demo' });
    assert.match(xml, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
    assert.doesNotMatch(xml, /<IMPORT|<ACTION|<FUNCTION|<EVENT|<FILE|<HTTP|ISMODIFY="Yes"/i);
  }
  for (const report of Object.keys(REPORTS)) {
    assert.match(buildExport({ kind: 'report', report, company: 'Demo', ...(report === 'ledger_vouchers' ? { ledger: 'Cash' } : {}) }), /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
  }
});

test('reject write requests, arbitrary TDL/XML, unknown fields and reports', () => {
  for (const bad of [
    { kind: 'import', entity: 'ledgers', company: 'Demo' },
    { kind: 'collection', entity: 'ledgers', company: 'Demo', xml: '<IMPORTDATA/>' },
    { kind: 'collection', entity: 'ledgers', company: 'Demo', methods: ['$$Execute:Delete'] },
    { kind: 'collection', entity: 'Voucher : $$Execute:Delete', company: 'Demo' },
    { kind: 'report', report: 'Execute', company: 'Demo' },
    { kind: 'collection', entity: 'ledgers' },
  ]) assert.throws(() => buildExport(bad));
});

test('company and ledger names cannot escape their XML text nodes', () => {
  const attack = '</SVCURRENTCOMPANY><TALLYREQUEST>Import Data</TALLYREQUEST>&"';
  const xml = buildExport({ kind: 'report', report: 'ledger_vouchers', company: attack, ledger: attack });
  assert.equal((xml.match(/<TALLYREQUEST>/g) || []).length, 1);
  assert.ok(xml.includes('&lt;TALLYREQUEST&gt;Import Data&lt;/TALLYREQUEST&gt;'));
  assert.throws(() => buildExport({ kind: 'collection', entity: 'ledgers', company: 'bad\x00' }));
});

test('period validation fails closed and uses only fixed date formula', () => {
  const base = { kind: 'collection', entity: 'vouchers', company: 'Demo' };
  for (const dates of [{ from_date: '2026-01-01' }, { from_date: '2026-02-30', to_date: '2026-03-01' }, { from_date: '2026-04-01', to_date: '2026-01-01' }]) assert.throws(() => buildExport({ ...base, ...dates }));
  assert.match(buildExport({ ...base, from_date: '2026-01-01', to_date: '2026-01-31' }), /LocalMcpDateFilter/);
});

test('remote endpoints and unsafe field paths are refused', () => {
  for (const host of ['example.com', '192.168.1.1', '127.0.0.1.example.com', '0.0.0.0']) assert.throws(() => config({ TALLY_HOST: host }));
  assert.throws(() => config({ TALLY_URL: 'http://evil.example' }));
  assert.throws(() => config({ TALLY_PORT: '0' }));
  assert.throws(() => config({ TALLY_ALLOWED_COMPANIES: '[]' }));
  for (const path of ['__proto__/x', 'constructor', 'NAME;DELETE', '$$Execute:Delete']) assert.equal(field.safeParse(path).success, false);
});

test('XML parser rejects entities, invalid XML, failure status and Tally errors', () => {
  for (const xml of ['<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><ENVELOPE/>', '<ENVELOPE>', '<ENVELOPE><HEADER><STATUS>0</STATUS></HEADER></ENVELOPE>', '<ENVELOPE><LINEERROR>Unavailable report</LINEERROR></ENVELOPE>', '<html/>']) assert.throws(() => parseResponse(Buffer.from(xml)));
  const result = parseResponse(Buffer.from('\uFEFF<ENVELOPE><NAME>0012</NAME><TEXT>A&#4;B</TEXT></ENVELOPE>', 'utf16le'));
  assert.equal(result.parsed.ENVELOPE.NAME, '0012');
  assert.equal(result.parsed.ENVELOPE.TEXT, 'A\uFFFDB');
  assert.equal(result.warnings.length, 1);
});

test('nested querying and decimal totals retain precision and avoid duplicate parent totals', () => {
  const records = [{ DATE: '20260401', 'ALLLEDGERENTRIES.LIST': [{ LEDGERNAME: 'Sales', AMOUNT: '0.1' }, { LEDGERNAME: 'Sales', AMOUNT: { '#text': '0.2', '@TYPE': 'Amount' } }] }];
  const rows = selectRows(records, [{ field: '_parent/DATE', op: 'eq', value: '20260401' }], 'ALLLEDGERENTRIES.LIST');
  assert.equal(aggregate(rows, { operation: 'sum', value_field: 'AMOUNT', group_by: ['LEDGERNAME'] }).groups[0].value, '0.3');
  assert.equal(paginate(rows, { limit: 1 }).has_more, true);
  assert.equal(paginate(rows, { offset: 1, limit: 1 }).has_more, false);
  assert.equal(selectRows(rows, [{ field: 'LEDGERNAME', op: 'ne', value: 'Sales' }]).length, 0);
  assert.throws(() => aggregate([{ AMOUNT: '' }], { operation: 'sum', value_field: 'AMOUNT' }));
  assert.throws(() => aggregate([{ AMOUNT: 'INR 1,000 Dr' }], { operation: 'sum', value_field: 'AMOUNT' }));
  assert.throws(() => aggregate([{}], { operation: 'sum', value_field: 'AMOUNT' }));
  assert.throws(() => selectRows(records, [], 'DATE'), /not a scalar/);
  assert.throws(() => selectRows(records, [], 'WRONG.LIST'), /No nested records/);
});

async function mock(t, handler, settings = {}) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return new TallyReader(config({ TALLY_PORT: String(server.address().port), ...settings }));
}

test('live reads do not cache; malformed requests never hit network; companies are validated', async t => {
  let requests = 0, amount = '10.00'; const bodies = [];
  const reader = await mock(t, (req, res) => {
    requests++; let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      bodies.push(body);
      const data = body.includes('<TYPE>Company</TYPE>') ? '<COMPANY NAME="Demo"><NAME>Demo</NAME></COMPANY>' : `<LEDGER NAME="Cash"><CLOSINGBALANCE>${amount}</CLOSINGBALANCE></LEDGER>`;
      res.end(`<ENVELOPE><HEADER><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${data}</COLLECTION></DATA></BODY></ENVELOPE>`);
    });
  });
  await assert.rejects(reader.read({ entity: 'ledgers', company: 'Demo', xml: 'bad' }));
  assert.equal(requests, 0);
  assert.equal((await reader.read({ entity: 'ledgers', company: 'Demo' })).records[0].CLOSINGBALANCE, '10.00');
  amount = '99.00';
  assert.equal((await reader.read({ entity: 'ledgers', company: 'Demo' })).records[0].CLOSINGBALANCE, '99.00');
  await assert.rejects(reader.read({ entity: 'ledgers', company: 'Not loaded' }), /not loaded/);
  assert.equal(requests, 5);
  for (const body of bodies) assert.match(body, /<TALLYREQUEST>Export<\/TALLYREQUEST>/);
});

test('network refuses redirects, oversized responses and timeouts', async t => {
  const redirect = await mock(t, (req, res) => { res.writeHead(302, { Location: 'http://example.com' }); res.end(); });
  await assert.rejects(redirect.companies(), /redirects/);
  const large = await mock(t, (req, res) => res.end('x'.repeat(4096)), { TALLY_MAX_RESPONSE_MB: '0.001953125' });
  await assert.rejects(large.companies(), /size limit/);
  const hanging = await mock(t, () => {}, { TALLY_TIMEOUT_MS: '100' });
  await assert.rejects(hanging.companies(), /timed out/);
});

test('company allowlist hides and refuses other companies', async t => {
  const reader = await mock(t, (req, res) => res.end('<ENVELOPE><COLLECTION><COMPANY NAME="Allowed"/><COMPANY NAME="Other"/></COLLECTION></ENVELOPE>'), { TALLY_ALLOWED_COMPANIES: '["Allowed"]' });
  assert.equal((await reader.companies()).records.length, 1);
  await assert.rejects(reader.read({ entity: 'ledgers', company: 'Other' }));
});
