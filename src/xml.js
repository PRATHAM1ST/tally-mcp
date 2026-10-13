import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { CATALOG, REPORTS } from './catalog.js';
import { exportSchema, checkPeriod } from './validation.js';

const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const element = (tag, value) => `<${tag}>${escape(value)}</${tag}>`;

// Sole request constructor. It accepts a narrow typed plan, never raw XML.
export function buildExport(input) {
  const p = checkPeriod(exportSchema.parse(input));
  if (p.kind === 'collection' && p.entity !== 'companies' && !p.company) throw new Error('An explicit company is required.');
  if (p.kind === 'report' && p.report === 'ledger_vouchers' && !p.ledger) throw new Error('ledger is required for ledger_vouchers');
  if (p.kind === 'report' && p.ledger && p.report !== 'ledger_vouchers') throw new Error('ledger is only valid for ledger_vouchers');
  let vars = element('SVEXPORTFORMAT', '$$SysName:XML');
  if (p.company) vars += `<SVCURRENTCOMPANY TYPE="String">${escape(p.company)}</SVCURRENTCOMPANY>`;
  if (p.from_date) vars += `<SVFROMDATE TYPE="Date">${p.from_date.replaceAll('-', '')}</SVFROMDATE><SVTODATE TYPE="Date">${p.to_date.replaceAll('-', '')}</SVTODATE>`;
  if (p.ledger) vars += `<LEDGERNAME TYPE="String">${escape(p.ledger)}</LEDGERNAME>`;
  let tdl = '';
  const id = p.kind === 'collection' ? 'LocalMcpReadOnlyCollection_v1' : REPORTS[p.report];
  if (p.kind === 'collection') {
    const definition = CATALOG[p.entity];
    // Only this fixed read expression can enter the TDL definition.
    const dated = p.entity === 'vouchers' && !!p.from_date;
    tdl = `<TDL><TDLMESSAGE><COLLECTION NAME="${id}" ISMODIFY="No" ISINITIALIZE="Yes"><TYPE>${definition.type}</TYPE>${definition.methods.map(m => element('NATIVEMETHOD', m)).join('')}${dated ? '<FILTER>LocalMcpDateFilter</FILTER>' : ''}</COLLECTION>${dated ? '<SYSTEM TYPE="Formulae" NAME="LocalMcpDateFilter">$Date &gt;= ##SVFromDate AND $Date &lt;= ##SVToDate</SYSTEM>' : ''}</TDLMESSAGE></TDL>`;
  }
  return `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>${p.kind === 'collection' ? 'Collection' : 'Data'}</TYPE><ID>${id}</ID></HEADER><BODY><DESC><STATICVARIABLES>${vars}</STATICVARIABLES>${tdl}</DESC></BODY></ENVELOPE>`;
}

export function parseResponse(buffer) {
  // Tally installations may return UTF-16LE, with or without a BOM.
  const utf16 = (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0x3c && buffer[1] === 0);
  let xml = buffer.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD/entity declarations are forbidden in Tally responses.');
  // Tally uses XML-illegal control character references (notably &#4;).
  let replacements = 0;
  xml = xml.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (match, hex, dec) => {
    const code = parseInt(hex || dec, hex ? 16 : 10);
    if ((code < 32 && ![9, 10, 13].includes(code)) || code === 0xfffe || code === 0xffff || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) { replacements++; return '\uFFFD'; }
    return match;
  }).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, () => { replacements++; return '\uFFFD'; });
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new Error(`Invalid XML returned by local service: ${valid.err.msg}`);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true, processEntities: true }).parse(xml);
  const errors = findNodes(parsed, 'LINEERROR');
  if (errors.length) throw new Error(`Tally rejected the read: ${errors.map(scalar).join('; ').slice(0,1000)}`);
  if (String(scalar(parsed.ENVELOPE?.HEADER?.STATUS)) === '0') throw new Error('Tally returned failure STATUS=0. Check the company and report availability.');
  if (!parsed.ENVELOPE) throw new Error('Local service did not return a Tally ENVELOPE.');
  return { parsed, warnings: replacements ? [`Replaced ${replacements} XML-invalid control characters with U+FFFD.`] : [] };
}

export function scalar(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, '#text')) return v['#text'];
  return v;
}

export function findNodes(root, tag) {
  const found = [];
  const walk = (node, depth) => {
    if (depth > 100) throw new Error('Tally response nesting exceeds safety limit.');
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === tag) found.push(...(Array.isArray(value) ? value : [value]));
      else if (Array.isArray(value)) value.forEach(v => walk(v, depth + 1));
      else walk(value, depth + 1);
    }
  };
  walk(root, 0);
  return found;
}
