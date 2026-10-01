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
export async function seedExecutionDirectoryPgFixture(pool) {
  if (process.env.NODE_ENV !== 'test') throw Error('execution directory fixture requires test environment');
  const { rows: [{ database }] } = await pool.query('SELECT current_database() AS database');
  if (!/^(kernel_cli_owner_|kernel_ctlown_|kernel_wiring_|scriptchain)/.test(database)) {
    throw Error('isolated fixture database required');
  }
  for (const [, id, name] of LEGACY_BINDINGS) {
    await pool.query(`INSERT INTO system_registry(id,type,name,status)
      VALUES($1,'machine',$2,'active')
      ON CONFLICT(type,name) DO UPDATE SET id=EXCLUDED.id,status='active'`, [id, name]);
  }
  await importLegacyPolicy({ pool, env: FIXTURE_EXECUTION_ENV });
  await directory.refresh({ pool });
}
export const refreshExecutionDirectoryPgFixture = pool => directory.refresh({ pool });
