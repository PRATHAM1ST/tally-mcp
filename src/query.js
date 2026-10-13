import Decimal from 'decimal.js';
import { scalar } from './xml.js';

Decimal.set({ precision: 50 });

// Slash separates nested paths because Tally tag names themselves contain dots.
export function valuesAt(record, path) {
  const parts = path.split('/');
  function visit(node, i) {
    if (Array.isArray(node)) return node.flatMap(v => visit(v, i));
    if (i === parts.length) return [scalar(node)];
    if (!node || typeof node !== 'object' || !Object.hasOwn(node, parts[i])) return [];
    return visit(node[parts[i]], i + 1);
  }
  return visit(record, 0);
}

export function decimal(value) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Expected a numeric scalar.');
  const s = String(value).trim();
  // Do not guess units, currencies, foreign-exchange expressions, blanks or Dr/Cr.
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(s)) throw new Error(`Non-numeric amount ${JSON.stringify(s.slice(0,80))}; currency/unit/Dr-Cr strings require explicit interpretation.`);
  return new Decimal(s);
}

export function selectRows(records, filters = [], rowPath) {
  const rows = rowPath ? records.flatMap(parent => valuesAt(parent, rowPath).map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('row_path must select nested records, not a scalar.');
    return { ...row, _parent: parent };
  })) : records;
  if (rowPath && records.length && !rows.length) throw new Error(`No nested records found at row_path ${rowPath}. Inspect an unprojected sample to find the correct XML list name.`);
  return rows.filter(row => filters.every(filter => {
    const values = valuesAt(row, filter.field);
    if (!values.length) return false;
    const match = value => {
      if (value === null || typeof value === 'object') return false;
      const lhs = String(value).toLocaleLowerCase('en-US');
      const rhs = filter.value.toLocaleLowerCase('en-US');
      switch (filter.op) {
        case 'eq': case 'ne': return lhs === rhs;
        case 'contains': return lhs.includes(rhs);
        case 'starts_with': return lhs.startsWith(rhs);
        default: {
          const comparison = decimal(value).cmp(decimal(filter.value));
          return { gt: comparison > 0, gte: comparison >= 0, lt: comparison < 0, lte: comparison <= 0 }[filter.op];
        }
      }
    };
    return filter.op === 'ne' ? values.every(v => !match(v)) : values.some(match);
  }));
}

export function paginate(records, { offset = 0, limit = 100, fields, sort_by, sort_numeric = false, descending = false } = {}) {
  const rows = [...records];
  if (sort_by) rows.sort((a,b) => {
    const av = valuesAt(a, sort_by)[0], bv = valuesAt(b, sort_by)[0];
    const result = sort_numeric ? decimal(av).cmp(decimal(bv)) : String(av ?? '').localeCompare(String(bv ?? ''));
    return descending ? -result : result;
  });
  let page = rows.slice(offset, offset + limit);
  if (fields) page = page.map(row => Object.fromEntries(fields.map(f => { const values = valuesAt(row, f); return [f, values.length > 1 ? values : values[0] ?? null]; })));
  return { total_matching: rows.length, offset, returned: page.length, has_more: offset + page.length < rows.length, next_offset: offset + page.length < rows.length ? offset + page.length : null, records: page };
}

export function aggregate(records, { operation, value_field, group_by = [] }) {
  if (operation !== 'count' && !value_field) throw new Error('value_field is required for numeric aggregates.');
  const groups = new Map();
  for (const record of records) {
    const key = group_by.map(f => {
      const values = valuesAt(record, f);
      if (values.length !== 1 || (values[0] !== null && typeof values[0] === 'object')) throw new Error(`Group field ${f} must have exactly one scalar per row. Use row_path for nested entries.`);
      return values[0];
    });
    const encoded = JSON.stringify(key);
    const group = groups.get(encoded) ?? { group: Object.fromEntries(group_by.map((f, i) => [f, key[i]])), count: 0, total: new Decimal(0), min: null, max: null };
    group.count++;
    if (operation !== 'count') {
      const values = valuesAt(record, value_field);
      if (values.length !== 1) throw new Error(`Amount field ${value_field} must have exactly one value per row. Missing amounts are never treated as zero. Use row_path for nested entries.`);
      const amount = decimal(values[0]);
      group.total = group.total.plus(amount);
      group.min = group.min === null || amount.lt(group.min) ? amount : group.min;
      group.max = group.max === null || amount.gt(group.max) ? amount : group.max;
    }
    groups.set(encoded, group);
    if (groups.size > 5000) throw new Error('Too many aggregate groups. Narrow filters or dates.');
  }
  return { operation, value_field: value_field ?? null, input_rows: records.length,
    groups: [...groups.values()].map(g => ({ group: g.group, count: g.count, value: operation === 'count' ? String(g.count) : ({ sum: g.total, min: g.min, max: g.max, average: g.total.div(g.count) })[operation].toFixed() })),
    note: 'Values retain Tally signs. Sum only compatible currencies/units. No rounding was applied; averages use 50 significant digits.' };
}
