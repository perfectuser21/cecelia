import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { DB_DEFAULTS } from '../../db-config.js';

vi.mock('../../lib/relay-baton.js', () => ({ relayOnComplete: vi.fn().mockResolvedValue(null) }));
vi.mock('../../alerting.js', () => ({ raise: vi.fn() }));
vi.mock('../../capture-inbox.js', () => ({ pushCaptureAtom: vi.fn() }));

describe('部署验证与真实数据库快照', () => {
  let admin, pool, schema;
  beforeAll(async () => {
    if (DB_DEFAULTS.database !== 'cecelia_scratch' && !(process.env.CI === 'true' && DB_DEFAULTS.database === 'cecelia_test')) throw Error('仅允许隔离测试数据库');
    admin = new pg.Client(DB_DEFAULTS);
    await admin.connect();
    if ((await admin.query('SELECT current_database() AS db')).rows[0].db !== DB_DEFAULTS.database) throw Error('数据库身份不符');
    schema = `postdeploy_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new pg.Pool({ ...DB_DEFAULTS, options: `-c search_path=${schema},public` });
    await pool.query(`CREATE TABLE tasks (id text PRIMARY KEY, title text, task_type text, status text,
      payload jsonb DEFAULT '{}', result jsonb, claimed_by text, claimed_at timestamptz, pr_url text, completed_at timestamptz,
      error_message text, updated_at timestamptz DEFAULT now());
      CREATE TABLE task_runs(task_id text,run_id text,status text,ended_at timestamptz,context jsonb)`);
  });
  beforeEach(async () => {
    await pool.query('DELETE FROM tasks');
    (await import('../../postdeploy-verifier.js'))._resetThrottleForTest();
    vi.clearAllMocks();
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
  });

  it.each([false, true])('无 PR 的普通 dev 验证结束仍未交付（命令=%s）', async (withCommand) => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['no-pr','无 PR','dev','pending_postdeploy', withCommand ? { postdeploy_check: { command: 'node -v' } } : {}]);
    await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(pool);
    expect((await pool.query("SELECT status FROM tasks WHERE id='no-pr'")).rows[0].status).toBe('completed_no_pr');
    expect((await import('../../lib/relay-baton.js')).relayOnComplete).not.toHaveBeenCalled();
  });

  it.each([
    ['data', {}],
    ['dev', { harness_mode: true }],
    ['dev', { decomposition: true }],
    ['dev', { existing_pr_url: 'https://github.com/owner/repo/pull/1' }],
  ])('保留现有非 dev 与 dev 豁免合同 %s %j', async (type, payload) => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['exempt','豁免',type,'pending_postdeploy',payload]);
    await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(pool);
    expect((await pool.query("SELECT status FROM tasks WHERE id='exempt'")).rows[0].status).toBe('completed');
  });

  it.each([
    { harness_mode: 'false' },
    { decomposition: 'known' },
    { pr_url: 'PR #123', existing_pr_url: 'not-a-url' },
  ])('无效豁免或 PR 字段不能当成交付 %j', async payload => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['invalid-pr','未交付','dev','pending_postdeploy',payload]);
    await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(pool);
    expect((await pool.query("SELECT status FROM tasks WHERE id='invalid-pr'")).rows[0].status).toBe('completed_no_pr');
  });

  it('验证要求变化时，旧命令不能完成新要求', async () => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['config-race','验证变更','data','pending_postdeploy',{ postdeploy_check: { command: 'node -v' } }]);
    const wrapped = { connect: (...a) => pool.connect(...a), query: async (sql, params) => {
      const result = await pool.query(sql, params);
      if (sql.includes('FROM tasks') && sql.includes('pending_postdeploy') && sql.includes('LIMIT'))
        await pool.query("UPDATE tasks SET payload=$2 WHERE id=$1", ['config-race',{ postdeploy_check: { command: 'sh -c "exit 1"' } }]);
      return result;
    } };
    expect(await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(wrapped)).toMatchObject({ verified: 0, skipped: 1 });
    expect((await pool.query("SELECT status FROM tasks WHERE id='config-race'")).rows[0].status).toBe('pending_postdeploy');
  });

  it('读取后任务类型变为 dev，不能按原类型完成', async () => {
    await pool.query("INSERT INTO tasks(id,title,task_type,status,payload) VALUES ('type-race','类型变更','data','pending_postdeploy','{}')");
    const wrapped = { connect: (...a) => pool.connect(...a), query: async (sql, params) => {
      const result = await pool.query(sql, params);
      if (sql.includes('FROM tasks') && sql.includes('pending_postdeploy') && sql.includes('LIMIT'))
        await pool.query("UPDATE tasks SET task_type='dev' WHERE id='type-race'");
      return result;
    } };
    await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(wrapped);
    expect((await pool.query("SELECT status FROM tasks WHERE id='type-race'")).rows[0].status).toBe('pending_postdeploy');
  });

  it('非法命令验收时任务已完成，不得覆盖为失败或计失败', async () => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['invalid-race','并发终态','data','pending_postdeploy',{ postdeploy_check: { command: 'rm -rf /' } }]);
    const wrapped = { connect: (...a) => pool.connect(...a), query: async (sql, params) => {
      const result = await pool.query(sql, params);
      if (sql.includes('FROM tasks') && sql.includes('pending_postdeploy') && sql.includes('LIMIT'))
        await pool.query("UPDATE tasks SET status='completed' WHERE id='invalid-race'");
      return result;
    } };
    expect(await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(wrapped)).toMatchObject({ failed: 0, skipped: 1 });
    expect((await pool.query("SELECT status FROM tasks WHERE id='invalid-race'")).rows[0].status).toBe('completed');
  });

  it('重试上限时任务已完成，不得错误计失败或发告警', async () => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['retry-race','并发终态','data','pending_postdeploy',{ postdeploy_retry_count: 2, postdeploy_check: { command: 'sh -c "exit 1"' } }]);
    const wrapped = { connect: (...a) => pool.connect(...a), query: async (sql, params) => {
      const result = await pool.query(sql, params);
      if (sql.includes('FROM tasks') && sql.includes('pending_postdeploy') && sql.includes('LIMIT'))
        await pool.query("UPDATE tasks SET status='completed' WHERE id='retry-race'");
      return result;
    } };
    expect(await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(wrapped)).toMatchObject({ failed: 0, skipped: 1 });
    expect((await import('../../alerting.js')).raise).not.toHaveBeenCalled();
    expect((await pool.query("SELECT status FROM tasks WHERE id='retry-race'")).rows[0].status).toBe('completed');
  });

  it('其他工作者已推进重试次数，不覆盖较新的数值', async () => {
    await pool.query('INSERT INTO tasks(id,title,task_type,status,payload) VALUES ($1,$2,$3,$4,$5)',
      ['retry-count','重试竞争','data','pending_postdeploy',{ postdeploy_retry_count: 0, postdeploy_check: { command: 'sh -c "exit 1"' } }]);
    const wrapped = { connect: (...a) => pool.connect(...a), query: async (sql, params) => {
      const result = await pool.query(sql, params);
      if (sql.includes('FROM tasks') && sql.includes('pending_postdeploy') && sql.includes('LIMIT'))
        await pool.query("UPDATE tasks SET payload=jsonb_set(payload,'{postdeploy_retry_count}','1') WHERE id='retry-count'");
      return result;
    } };
    expect(await (await import('../../postdeploy-verifier.js')).runPostdeployVerifier(wrapped)).toMatchObject({ failed: 0, skipped: 1 });
    expect((await pool.query("SELECT payload->>'postdeploy_retry_count' AS n FROM tasks WHERE id='retry-count'")).rows[0].n).toBe('1');
  });
});
