/** Validate the exact DB_DEFAULTS object consumed by taskLeaseFixture, not a spare URL. */
export function assertAutoPoolTestDatabase(config, env = process.env) {
  const nightly = env.GITHUB_ACTIONS === 'true'
    && env.GITHUB_JOB === 'brain-integration'
    && env.GITHUB_WORKFLOW === 'Deep Regression';
  const allowedDatabase = config.database === 'cecelia_scratch'
    || (nightly && config.database === 'cecelia_test');
  if (env.CI !== 'true' || env.POSTGRES_INTEGRATION !== '1'
      || !allowedDatabase || !['127.0.0.1', 'localhost'].includes(config.host)
      || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw Error('auto pool ownership requires the actual isolated CI PostgreSQL target');
  }
  return config;
}
