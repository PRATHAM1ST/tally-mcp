import http from 'node:http';
import { CATALOG, POLICY } from './catalog.js';
import { config } from './validation.js';
import { buildExport, parseResponse, findNodes, scalar } from './xml.js';

export class TallyReader {
  #config;
  #tail = Promise.resolve();
  constructor(settings = config()) { this.#config = settings; }
  get endpoint() { return `http://127.0.0.1:${this.#config.port}`; }
  get allowedCompanies() { return this.#config.allowedCompanies; }

  async #export(plan) {
    if (plan.company && this.allowedCompanies && !this.allowedCompanies.includes(plan.company)) throw new Error('Company is not in TALLY_ALLOWED_COMPANIES.');
    // Validation and the export-only builder are mandatory at the network boundary.
    const xml = buildExport(plan);
    const run = () => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: this.#config.port, path: '/', method: 'POST', agent: false,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml), 'Accept-Encoding': 'identity', 'Cache-Control': 'no-store' } }, res => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error(`Local Tally HTTP ${res.statusCode}; redirects are never followed.`)); return; }
        const chunks = []; let size = 0; let failed = false;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > this.#config.maxBytes) {
            failed = true;
            const error = new Error('Tally response exceeded size limit. Narrow the date range; no partial data was returned.');
            reject(error); req.destroy(error); return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          if (failed) return;
          try { resolve({ ...parseResponse(Buffer.concat(chunks)), fetched_at: new Date().toISOString(), source: this.endpoint, policy: POLICY }); }
          catch (e) { reject(e); }
        });
      });
      const timer = setTimeout(() => req.destroy(new Error('Tally read timed out. Check Tally or narrow the date range.')), this.#config.timeoutMs);
      req.once('close', () => clearTimeout(timer));
      req.on('error', e => reject(new Error(e.code === 'ECONNREFUSED' ? `Tally data interface unavailable at ${this.endpoint}. Open Tally, load a company, and enable its HTTP Server on this port. Gateway port 9999 is not the data interface.` : e.message)));
      req.end(xml);
    });
    const pending = this.#tail.then(run);
    this.#tail = pending.catch(() => {});
    return pending;
  }

  async companies() {
    const response = await this.#export({ kind: 'collection', entity: 'companies' });
    const records = this.#records(response, 'companies').filter(row => !this.allowedCompanies || this.allowedCompanies.includes(String(scalar(row.NAME) ?? row['@NAME'])));
    return { ...this.#meta(response), records };
  }

  async #verifyCompany(company) {
    const { records } = await this.companies();
    if (!records.some(row => String(scalar(row.NAME) ?? row['@NAME']) === company)) throw new Error('Company is not loaded or not allowed. Use tally_companies and pass its exact name.');
  }

  #meta({ fetched_at, source, policy, warnings }) { return { fetched_at, source, policy, warnings, live: true }; }
  #records(response, entity) {
    const collections = findNodes(response.parsed, 'COLLECTION');
    if (!collections.length) throw new Error('Tally did not return a collection. Check company access and collection support.');
    return collections.flatMap(c => findNodes(c, CATALOG[entity].tag)).map(r => {
      if (!r || typeof r !== 'object') throw new Error('Malformed Tally record');
      return r;
    });
  }

  async read(input) {
    // Validate before even doing discovery: malformed requests cannot touch Tally.
    buildExport({ kind: 'collection', ...input });
    if (input.entity === 'companies') return this.companies();
    await this.#verifyCompany(input.company);
    const response = await this.#export({ kind: 'collection', ...input });
    return { ...this.#meta(response), company: input.company, entity: input.entity, period: { from_date: input.from_date ?? null, to_date: input.to_date ?? null }, records: this.#records(response, input.entity) };
  }

  async report(input) {
    buildExport({ kind: 'report', ...input });
    await this.#verifyCompany(input.company);
    const response = await this.#export({ kind: 'report', ...input });
    return { ...this.#meta(response), company: input.company, report: input.report, period: { from_date: input.from_date ?? null, to_date: input.to_date ?? null }, data: response.parsed.ENVELOPE };
  }

  async status() {
    try { const result = await this.companies(); return { connected: true, endpoint: this.endpoint, policy: POLICY, loaded_companies: result.records.length, fetched_at: result.fetched_at }; }
    catch (e) { return { connected: false, endpoint: this.endpoint, policy: POLICY, error: e.message }; }
  }
}
