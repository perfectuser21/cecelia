function hasText(value) {
  return typeof value === 'string' && value.length > 0;
}

function buildDatabaseUrl(env) {
  const hasDatabaseParts = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']
    .some((key) => hasText(env[key]));
  if (!hasDatabaseParts) return 'postgresql://localhost/cecelia_test';

  const host = env.DB_HOST || 'localhost';
  const port = env.DB_PORT || '5432';
  const database = encodeURIComponent(env.DB_NAME || 'cecelia_test');
  const user = encodeURIComponent(env.DB_USER || 'cecelia');
  const password = hasText(env.DB_PASSWORD) ? `:${encodeURIComponent(env.DB_PASSWORD)}` : '';
  return `postgresql://${user}${password}@${host}:${port}/${database}`;
}

export function resolveTestDatabaseUrl(env = process.env) {
  const connectionString = env.TEST_DATABASE_URL || env.DATABASE_URL || buildDatabaseUrl(env);
  const databaseName = decodeURIComponent(new URL(connectionString).pathname.slice(1));
  if (!/(_test|_scratch)$/.test(databaseName)) {
    throw new Error(`集成测试拒绝连接非测试库: ${databaseName}`);
  }
  return connectionString;
}
