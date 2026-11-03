import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { createReadonlyPool } from '../../src/db.js';

const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const privateAddress = address => {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

export function validateMcpPgFixtureTarget(value, serverAddress = process.env.MCP_PG_FIXTURE_SERVER_ADDRESS) {
  let url;
  try { url = new URL(value); } catch { throw Error('MCP_PG_FIXTURE_TARGET_REJECTED'); }
  const database = url.pathname.slice(1);
  const port = Number(url.port || 5432);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^cecelia_mcp_ci(?:_[a-z0-9]+)*$/.test(database)
    || !Number.isInteger(port) || port < 1 || port > 65535
    || url.search || url.hash || !url.username
    || (serverAddress !== undefined && !loopback(serverAddress) && !privateAddress(serverAddress))) {
    throw Error('MCP_PG_FIXTURE_TARGET_REJECTED');
  }
  return { url: url.href, database, port, serverAddress };
}

export function assertMcpPgFixtureIdentity(actual, expected) {
  const addressMatches = expected.serverAddress ? actual?.address === expected.serverAddress : loopback(actual?.address);
  if (actual?.database !== expected.database || !addressMatches
    || Number(actual?.port) !== expected.port) throw Error('MCP_PG_FIXTURE_IDENTITY_MISMATCH');
}

async function assertServer(pool, expected) {
  const { rows } = await pool.query(`SELECT current_database() AS database,
    host(inet_server_addr()) AS address, inet_server_port() AS port`);
  assertMcpPgFixtureIdentity(rows[0], expected);
}

export async function createMcpPgFixture() {
  // 在创建连接池之前验证；不接受通用_test/_scratch库、远端或URL options覆盖地址。
  const target = validateMcpPgFixtureTarget(process.env.TEST_DATABASE_URL);
  const schema = `mcp_ci_${randomBytes(12).toString('hex')}`;
  const role = `${schema}_reader`;
  const owner = randomUUID();
  const pool = createReadonlyPool(target.url, { max: 1 });
  let readonlyPool, ready = false, closed = false;
  const activeManifest = randomUUID(), activeRun = randomUUID(), historicalRun = randomUUID();
  const digest = 'a'.repeat(64), decision = randomUUID();
  const nodeId = value => createHash('sha256').update(`${schema}:${value}`).digest('hex');
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      await readonlyPool?.end();
      if (ready) {
        await assertServer(pool, target);
        const { rows } = await pool.query(`SELECT owner FROM "${schema}"._mcp_fixture_owner`);
        if (rows.length !== 1 || rows[0].owner !== owner) throw Error('MCP_PG_FIXTURE_OWNER_MISMATCH');
        await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        await pool.query(`DROP ROLE "${role}"`);
      }
    } finally { await pool.end(); }
  };
  try {
    await assertServer(pool, target);
    await pool.query('BEGIN');
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`SET search_path TO "${schema}", pg_catalog`);
    await pool.query('CREATE TABLE _mcp_fixture_owner (owner uuid NOT NULL)');
    await pool.query('INSERT INTO _mcp_fixture_owner VALUES ($1)', [owner]);
    await pool.query('CREATE TABLE decisions (id uuid PRIMARY KEY)');
    await pool.query('CREATE TABLE schema_version (version varchar(10) PRIMARY KEY, description text)');
    for (const migration of ['402_map_manifest_versions.sql', '405_map_projection_core.sql']) {
      const sql = readFileSync(new URL(`../../../brain/migrations/${migration}`, import.meta.url), 'utf8');
      await pool.query(sql);
    }
    await pool.query('INSERT INTO decisions VALUES ($1)', [decision]);
    await pool.query(`INSERT INTO map_manifest_versions
      (id, scope_key, version, source_decision_id, manifest, digest, status, activated_at)
      VALUES ($1, 'mcp-fixture', 1, $2, $3, $4, 'active', now())`,
    [activeManifest, decision, JSON.stringify({ schema_version: 1, scope_key: 'mcp-fixture', source_decision_id: decision }), digest]);
    for (const [id, status, activatedAt] of [[historicalRun, 'superseded', '2026-01-01'], [activeRun, 'active', '2026-01-02']]) {
      await pool.query(`INSERT INTO map_projection_runs
        (id,scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
        VALUES ($1,'mcp-fixture',$2,$3,'{}','mcp-pg-fixture',$3,$4,$5)`,
      [id, activeManifest, digest, status, activatedAt]);
      for (const type of status === 'active' ? ['value_stream', 'capability', 'crosscut'] : ['value_stream', 'capability']) {
        await pool.query(`INSERT INTO map_projection_nodes (run_id,node_id,node_type,node_key,name)
          VALUES ($1,$2,$3,$3,$3)`, [id, nodeId(type), type]);
      }
      await pool.query(`INSERT INTO map_projection_edges
        (run_id,edge_id,edge_type,edge_key,from_node_id,to_node_id)
        VALUES ($1,$2,'contains','contains',$3,$4)`,
      [id, nodeId('edge'), nodeId('value_stream'), nodeId('capability')]);
    }
    // 本job自有临时角色：只对本人schema有SELECT，不能写；密码仅为隔离CI测试值。
    await pool.query(`CREATE ROLE "${role}" LOGIN PASSWORD 'isolated-ci'`);
    await pool.query(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
    await pool.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
    await pool.query('COMMIT');
    ready = true;
    const readonlyUrl = new URL(target.url);
    readonlyUrl.username = role;
    readonlyUrl.password = 'isolated-ci';
    readonlyUrl.searchParams.set('options', `-csearch_path=${schema},pg_catalog`);
    readonlyPool = createReadonlyPool(readonlyUrl.href, { max: 5 });
    await assertServer(readonlyPool, target);
    return { pool, readonlyPool, schema, activeManifest, activeRun, historicalRun, close };
  } catch (error) {
    if (!ready) await pool.query('ROLLBACK').catch(() => {});
    await close();
    throw error;
  }
}
