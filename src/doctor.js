import { TallyReader } from './tally.js';
try {
  const status = await new TallyReader().status();
  console.log(JSON.stringify(status, null, 2));
  process.exitCode = status.connected ? 0 : 1;
} catch (e) { console.error(e.message); process.exitCode = 1; }
