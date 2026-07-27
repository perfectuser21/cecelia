import net from 'node:net';
import pg from 'pg';

const { Client } = pg;
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('FAKE_RED:config:TEST_DATABASE_URL_missing');

let url;
try {
  url = new URL(raw);
} catch {
  throw new Error('FAKE_RED:config:TEST_DATABASE_URL_invalid');
}

const database = decodeURIComponent(url.pathname.slice(1));
const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !hostname || !database) {
  throw new Error('FAKE_RED:config:postgres_protocol_host_database_required');
}
if (!/^(test|harness)(_[a-z0-9]+)*$/.test(database) || /cecelia|prod/i.test(database)) {
  throw new Error(`FAKE_RED:config:database_not_whitelisted:${database}`);
}
if (
  ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)
  || hostname.endsWith('.localhost')
  || (!net.isIP(hostname) && !hostname.includes('.'))
) {
  throw new Error(`FAKE_RED:config:local_or_ambiguous_host:${hostname}`);
}

const allowed = String(process.env.TEST_DATABASE_ALLOWED_CIDRS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (allowed.length === 0) {
  throw new Error('FAKE_RED:config:TEST_DATABASE_ALLOWED_CIDRS_missing');
}

function ipv4Number(address) {
  if (net.isIP(address) !== 4) return null;
  return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0);
}

function addressAllowed(address) {
  return allowed.some((entry) => {
    const [network, prefixText] = entry.split('/');
    if (!prefixText) return address === network;
    const prefix = Number(prefixText);
    const value = ipv4Number(address);
    const base = ipv4Number(network);
    if (value == null || base == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

const client = new Client({ connectionString: raw, application_name: 'kernel-feedback-lineage-preflight' });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const result = await client.query(
    'SELECT current_database() AS database, inet_server_addr()::text AS server_addr',
  );
  await client.query('ROLLBACK');
  const facts = result.rows[0];
  if (facts?.database !== database || !facts?.server_addr) {
    throw new Error('FAKE_RED:db:database_or_inet_mismatch');
  }
  if (['127.0.0.1', '::1'].includes(facts.server_addr) || !addressAllowed(facts.server_addr)) {
    throw new Error(`FAKE_RED:db:server_addr_not_allowed:${facts.server_addr}`);
  }
  console.log(`PG_PREFLIGHT_OK:${facts.database}:${facts.server_addr}`);
} finally {
  await client.end().catch(() => {});
}
