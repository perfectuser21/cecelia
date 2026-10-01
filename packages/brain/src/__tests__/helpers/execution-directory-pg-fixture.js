import { LEGACY_BINDINGS } from '../../execution-directory/legacy-policy.js';
import { importLegacyPolicy } from '../../execution-directory/store.js';
import { directory } from '../../execution-directory/directory.js';
export const FIXTURE_EXECUTION_ENV = Object.freeze({
  FLEET_WORKER_US_MAC_M4_URL: 'http://fixture-mmv:5231',
  FLEET_WORKER_XIAN_MAC_M1_URL: 'http://fixture-m1:5231',
  FLEET_WORKER_XIAN_MAC_M4_URL: 'http://fixture-m4:5231',
  EXECUTOR_BRIDGE_URL: 'http://fixture-mmv:3457',
  XIAN_CODEX_BRIDGE_URL: 'http://fixture-m4:3458',
});

// 独立数据库才可登记固定设备身份；授权仍走真实迁移、策略导入和查询。
export async function seedExecutionDirectoryPgFixture(pool, { ciSmoke = false, env = process.env } = {}) {
  if (ciSmoke && (env.NODE_ENV !== 'test' || env.GITHUB_ACTIONS !== 'true'
      || !['localhost', '127.0.0.1'].includes(env.DB_HOST) || env.DB_NAME !== 'cecelia_test')) {
    throw Error('CI execution directory fixture boundary');
  }
  if (env.NODE_ENV !== 'test') throw Error('execution directory fixture requires test environment');
  const { rows: [{ database }] } = await pool.query('SELECT current_database() AS database');
  if (ciSmoke ? database !== 'cecelia_test'
    : !/^(kernel_cli_owner_|kernel_ctlown_|kernel_wiring_|scriptchain)/.test(database)) {
    throw Error('isolated fixture database required');
  }
  if (ciSmoke && (await pool.query('SELECT 1 FROM execution_nodes LIMIT 1')).rows.length) {
    throw Error('CI execution directory fixture requires empty directory');
  }
  for (const [, id, name] of LEGACY_BINDINGS) {
    await pool.query(`INSERT INTO system_registry(id,type,name,status)
      VALUES($1,'machine',$2,'active')
      ON CONFLICT(type,name) DO UPDATE SET id=EXCLUDED.id,status='active'`, [id, name]);
  }
  // CI 不引用现网地址；未运行 Worker 的 loopback 端口让真实健康探针拒绝准入。
  const executionEnv = ciSmoke
    ? Object.fromEntries(Object.keys(FIXTURE_EXECUTION_ENV).map(key => [key, 'http://127.0.0.1:5231']))
    : FIXTURE_EXECUTION_ENV;
  await importLegacyPolicy({ pool, env: executionEnv });
  await directory.refresh({ pool });
}
export const refreshExecutionDirectoryPgFixture = pool => directory.refresh({ pool });
