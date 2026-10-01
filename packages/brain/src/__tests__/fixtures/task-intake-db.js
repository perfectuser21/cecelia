import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createIntakeRepositoryFixture(repository = fileURLToPath(new URL('../../../../..', import.meta.url))) {
  const directory = mkdtempSync(join(tmpdir(), 'intake-git-evidence-'));
  const path = join(directory, 'repository');
  const git = (cwd, args) => execFileSync('git', args,
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    const head = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']);
    // 浅克隆也有真实HEAD对象；只在独立夹具内提供origin/main，绝不修改源仓库ref。
    git(repository, ['clone', '--shared', '--no-checkout', repository, path]);
    git(path, ['update-ref', 'refs/remotes/origin/main', head]);
    return { path, head, close: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

// 本地只碰scratch；CI沿用已有隔离postgres服务。没有连接串/生产兜底。
export async function createIntakeTestDatabase() {
  const database = process.env.DB_NAME || 'cecelia_scratch';
  if (database !== 'cecelia_scratch' && !(process.env.CI === 'true' && database === 'cecelia_test')) {
    throw new Error('交办验真仅允许本机cecelia_scratch或CI隔离cecelia_test');
  }
  const config = { database, host: process.env.DB_HOST || '/tmp',
    user: process.env.DB_USER || process.env.USER, port: Number(process.env.DB_PORT || 5432),
    password: process.env.DB_PASSWORD || '', max: 5 };
  const schema = `intake_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool(config);
  let pool, repositoryFixture;
  try {
    repositoryFixture = createIntakeRepositoryFixture();
    if ((await admin.query('SELECT current_database() AS name')).rows[0].name !== database) {
      throw new Error('交办验真数据库不匹配');
    }
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ ...config, options: `-c search_path=${schema},public` });
    for (const table of ['tasks', 'work_routing_receipts', 'cecelia_events',
      'map_scope_repositories', 'map_projection_runs', 'map_projection_nodes', 'initiative_runs']) {
      await pool.query(`CREATE TABLE ${schema}.${table} (LIKE public.${table} INCLUDING ALL)`);
    }
    // LIKE保留CHECK/唯一索引；补收据外键及不可变触发器，任务+收据仍受真实约束。
    await pool.query(`ALTER TABLE work_routing_receipts ADD FOREIGN KEY(task_id) REFERENCES tasks(id)`);
    await pool.query(`CREATE TRIGGER work_routing_receipts_immutable BEFORE UPDATE OR DELETE
      ON work_routing_receipts FOR EACH ROW EXECUTE FUNCTION public.reject_work_routing_receipt_mutation()`);
    await pool.query(`CREATE SEQUENCE ${schema}.events_id_seq`);
    await pool.query(`ALTER TABLE cecelia_events ALTER COLUMN id SET DEFAULT nextval('${schema}.events_id_seq')`);
    await pool.query(`INSERT INTO map_scope_repositories(scope_key,repo,adapter_key,adapter_config)
      VALUES('cecelia','cecelia','repository-v1',$1::jsonb)`,
    [JSON.stringify({ path: repositoryFixture.path, aliases: ['perfectuser21/cecelia'] })]);
    const runId = randomUUID();
    await pool.query(`INSERT INTO map_projection_runs(id,scope_key,manifest_version_id,manifest_digest,
      fact_revisions,projector_version,projection_digest,status,activated_at)
      VALUES($1,'cecelia',$2,$3,'{}','intake-test-v1',$3,'active',NOW())`, [runId, randomUUID(), 'a'.repeat(64)]);
    await pool.query(`INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name)
      VALUES($1,$2,'capability','F1','任务接单')`, [runId, 'b'.repeat(64)]);
    return { pool, database, schema, close: async () => {
      try {
        await pool.end();
        try { await admin.query(`DROP SCHEMA ${schema} CASCADE`); } finally { await admin.end(); }
      } finally { repositoryFixture.close(); }
    } };
  } catch (error) {
    try {
      await pool?.end();
      try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin.end(); }
    } finally { repositoryFixture?.close(); }
    throw error;
  }
}
