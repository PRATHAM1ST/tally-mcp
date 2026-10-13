import { z } from 'zod';
import { CATALOG, REPORTS } from './catalog.js';

export const literal = z.string().min(1).max(512).refine(v => !/[\x00-\x1f\x7f]/u.test(v), 'Control characters are forbidden');
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Invalid calendar date');
export const field = z.string().regex(/^[A-Za-z_@][A-Za-z0-9_./@-]{0,127}$/).refine(v => !v.split(/[./]/).some(p => ['__proto__', 'prototype', 'constructor'].includes(p)));
export const period = { from_date: date.optional(), to_date: date.optional() };
export function checkPeriod(p) {
  if (!!p.from_date !== !!p.to_date) throw new Error('Supply both from_date and to_date, or neither.');
  if (p.from_date > p.to_date) throw new Error('from_date must not exceed to_date.');
  return p;
}
export const exportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('collection'), entity: z.enum(Object.keys(CATALOG)), company: literal.optional(), ...period }).strict(),
  z.object({ kind: z.literal('report'), report: z.enum(Object.keys(REPORTS)), company: literal, ledger: literal.optional(), ...period }).strict(),
]);
export const filterSchema = z.object({
  field, op: z.enum(['eq', 'ne', 'contains', 'starts_with', 'gt', 'gte', 'lt', 'lte']),
  value: z.string().max(1024),
}).strict();
export const queryShape = {
  company: literal,
  entity: z.enum(Object.keys(CATALOG).filter(k => k !== 'companies')),
  ...period,
  filters: z.array(filterSchema).max(20).default([]),
};

export function config(env = process.env) {
  const port = Number(env.TALLY_PORT || 9000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid TALLY_PORT');
  // No URL, hostname, proxy or model-controlled destination is accepted.
  if (env.TALLY_HOST && !['127.0.0.1', 'localhost'].includes(env.TALLY_HOST)) throw new Error('TALLY_HOST must be local (127.0.0.1 or localhost).');
  if (env.TALLY_URL) throw new Error('TALLY_URL is not supported; only local TALLY_PORT is configurable.');
  const timeoutMs = Number(env.TALLY_TIMEOUT_MS || 30000);
  const maxBytes = Number(env.TALLY_MAX_RESPONSE_MB || 32) * 1024 * 1024;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new Error('TALLY_TIMEOUT_MS must be 100..120000');
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 128 * 1024 * 1024) throw new Error('TALLY_MAX_RESPONSE_MB must be between 0.001 and 128');
  let allowedCompanies = null;
  if (env.TALLY_ALLOWED_COMPANIES) {
    allowedCompanies = z.array(literal).min(1).parse(JSON.parse(env.TALLY_ALLOWED_COMPANIES));
  }
  return Object.freeze({ port, timeoutMs, maxBytes, allowedCompanies: allowedCompanies && Object.freeze(allowedCompanies) });
}
