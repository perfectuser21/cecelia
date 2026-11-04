// 私有PG跑道的唯一连接合同；不加载dotenv、不透传libpq查询参数或进程凭据。
export function privatePgConfig(env = process.env) {
  const owner = env.CECELIA_PRIVATE_PG_OWNER;
  if (!/^ci-debt-[a-f0-9]{16}$/.test(owner || '')) throw Error('private postgres owner required');
  const urls = [env.TEST_DATABASE_URL, env.DATABASE_URL].filter(Boolean).map(raw => {
    const u = new URL(raw);
    if (u.search || u.hash) throw Error('postgres URL query/fragment forbidden');
    if (!['postgresql:', 'postgres:'].includes(u.protocol)) throw Error('postgres protocol required');
    return { host: u.hostname, port: Number(u.port), database: decodeURIComponent(u.pathname.slice(1)),
      user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
  });
  const fields = { host: env.DB_HOST, port: env.DB_PORT ? Number(env.DB_PORT) : undefined,
    database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD };
  const config = urls[0] || fields;
  for (const candidate of [...urls, fields]) for (const key of Object.keys(fields)) {
    if (candidate[key] !== undefined && candidate[key] !== config[key]) throw Error('postgres configuration conflict: ' + key);
  }
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535 || [5432, 5221].includes(config.port)
      || config.database !== 'cecelia_scratch' || !config.user || typeof config.password !== 'string') throw Error('explicit private loopback scratch configuration required');
  return { ...config, connectionTimeoutMillis: 3000, application_name: owner };
}

export const PRIVATE_PG_IDENTITY_SQL = `SELECT current_database() AS db, host(inet_server_addr()) AS host,
  inet_server_port() AS port, shobj_description(oid, 'pg_database') AS owner
  FROM pg_database WHERE datname=current_database()`;

export function assertOwnedDatabase(identity, config, owner) {
  if (!identity || identity.db !== config.database || identity.host !== config.host || identity.port !== config.port) throw Error('private postgres identity mismatch');
  if (identity.owner !== owner) throw Error('private postgres owner mismatch; cleanup forbidden');
}

export async function verifyPrivatePg(pool, env = process.env) {
  const config = privatePgConfig(env);
  const { rows: [identity] } = await pool.query(PRIVATE_PG_IDENTITY_SQL);
  assertOwnedDatabase(identity, config, env.CECELIA_PRIVATE_PG_OWNER);
  return identity;
}

export async function dropOwnedScratch(admin, verify, inspectOwner) {
  inspectOwner();
  await verify();
  await admin.query('DROP DATABASE cecelia_scratch WITH (FORCE)');
}

export function restoreDump(tool, dump) {
  if (!Buffer.isBuffer(dump) || !dump.length) throw Error('private postgres restore dump is empty');
  return tool('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', 'cecelia_scratch'], dump);
}

export function assertVitestReport(report) {
  const assertions = (report?.testResults || []).flatMap(file => file.assertionResults || []);
  if (report?.success !== true || !Number.isInteger(report.numTotalTests) || report.numTotalTests < 1
      || report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0
      || (report.numPendingTests || 0) !== 0 || (report.numTodoTests || 0) !== 0
      || assertions.length !== report.numTotalTests || assertions.some(a => a.status !== 'passed')) {
    throw Error('private postgres tests require nonempty fully passed results; failed/skip/todo are not success');
  }
  return report.numTotalTests;
}
