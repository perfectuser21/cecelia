import { privatePgConfig, verifyPrivatePg } from '../../../../../scripts/ci/private-pg-contract.mjs';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const config = privatePgConfig();
const schema = `debt_01_${randomUUID().replaceAll('-', '')}`;
export const pool = new pg.Pool({ ...config, max: 2, options: `-c search_path=${schema},public` });
let verified = false;
export async function setupScratch() {
  await verifyPrivatePg(pool);
  verified = true;
  await pool.query(`CREATE SCHEMA ${schema}`);
  // 合同所需正式迁移子集；不声称覆盖整库迁移兼容性。
  for (const file of [
    '000_base_schema.sql', '001_cecelia_architecture_upgrade.sql',
    '005_schema_version_and_config.sql', '130_task_execution_metrics.sql',
    '133_pr_status.sql', '137_blocked_status.sql', '138_blocked_detail.sql',
  ]) {
    await pool.query(await readFile(new URL(`../../../migrations/${file}`, import.meta.url), 'utf8'));
  }
  // LangGraph 活跃 checkpoint 边界夹具：本组默认无活跃执行。
  await pool.query('CREATE TABLE checkpoints (thread_id text)');
}
export async function closeScratch() {
  try {
    if (verified) await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await pool.end();
  }
}
