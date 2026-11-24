/**
 * 真实 PG + executor + ps：专属远端合同不因本机无进程被回队；
 * 已退役 OpenClaw/SSH 标签不能继续授予存活豁免。
 * 原生执行所有权必须以服务端 TaskRun 为准，不靠 Task JSON 自我声明。
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';

// 本文件的真实探针会扫描 in_progress；连接前必须显式限定 CI 私有测试库。
const nightly = process.env.GITHUB_ACTIONS === 'true'
  && process.env.GITHUB_JOB === 'brain-integration'
  && process.env.GITHUB_WORKFLOW === 'Deep Regression';
const allowedDatabases = nightly ? ['cecelia_scratch', 'cecelia_test'] : ['cecelia_scratch'];
if (process.env.CI !== 'true' || process.env.POSTGRES_INTEGRATION !== '1'
    || !allowedDatabases.includes(process.env.DB_NAME)
    || !['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST)
    || !/^\d+$/.test(process.env.DB_PORT ?? '')
    || Number(process.env.DB_PORT) < 1 || Number(process.env.DB_PORT) > 65535) {
  throw Error('external liveness requires isolated CI PostgreSQL');
}
process.env.NODE_ENV = 'test';

let pool;
let probeTaskLiveness;
let syncOrphanTasksOnStartup;
let suspectProcesses;
const seededIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const identity = (await pool.query('SELECT current_database() AS database_name')).rows[0];
  if (identity?.database_name !== process.env.DB_NAME || !allowedDatabases.includes(identity?.database_name)) {
    throw Error('external liveness database identity mismatch');
  }
  const executor = await import('../../executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  syncOrphanTasksOnStartup = executor.syncOrphanTasksOnStartup;
  suspectProcesses = executor.suspectProcesses;
});

afterEach(async () => {
  suspectProcesses?.clear();
  while (seededIds.length) {
    const id = seededIds.pop();
    await pool.query('DELETE FROM task_runs WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM task_events WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
});

afterAll(async () => { await pool?.end(); });

/** 造一条 in_progress 任务（started/claimed 在 minutesAgo 分钟前） */
async function seedInProgress({
  taskType,
  executorKind = null,
  payload = {},
  claimedBy = null,
  minutesAgo = 5,
}) {
  const r = await pool.query(
    `INSERT INTO tasks (title, task_type, status, executor_kind, payload, claimed_by, claimed_at, started_at, trigger_source)
     VALUES ($1, $2, 'in_progress', $3, $4::jsonb, $5,
             CASE WHEN $5::text IS NULL THEN NULL ELSE NOW() - ($6 || ' minutes')::interval END,
             NOW() - ($6 || ' minutes')::interval, 'manual')
     RETURNING id`,
    [
      `external-exec-liveness fixture ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskType,
      executorKind,
      JSON.stringify(payload),
      claimedBy,
      String(minutesAgo),
    ]
  );
  const id = r.rows[0].id;
  seededIds.push(id);
  return id;
}

async function readTask(id) {
  const r = await pool.query('SELECT status, claimed_by, error_message FROM tasks WHERE id = $1', [id]);
  return r.rows[0];
}

const seedQiumi = (opts = {}) => seedInProgress({
  taskType: 'qiumi_task',
  executorKind: 'external-worker',
  payload: { provider: 'native-agent', run_id: `qiumi-itest-${Date.now()}`, department: 'media' },
  ...opts,
});

const seedDeviceJob = (opts = {}) => seedInProgress({
  taskType: 'device_job',
  payload: { source: 'oneoff', serial: 'ANGYVB4311010223', params: { job_type: 'harvest_keyword' } },
  claimedBy: 'xian-mac-claimer',
  ...opts,
});

const seedScriptRun = (opts = {}) => seedInProgress({
  taskType: 'script_run',
  executorKind: 'script',
  payload: { script_run_id: `script-itest-${Date.now()}`, host: 'us-mac-m4', cmd: 'true' },
  ...opts,
});

describe('A) 启动同步不把外部执行体的活当孤儿回队 [BEHAVIOR]', () => {
  it('device_job（西安 Mac 领单器在跑）→ 保持 in_progress，claimed_by 不动', async () => {
    const id = await seedDeviceJob();
    await syncOrphanTasksOnStartup();

    const t = await readTask(id);
    expect(t.status).toBe('in_progress');
    expect(t.claimed_by).toBe('xian-mac-claimer');
  });

  it('原生 qiumi_task 启动同步保持保守策略，claimed_by 不动', async () => {
    const id = await seedQiumi({ claimedBy: 'brain-dispatcher' });
    await syncOrphanTasksOnStartup();

    const t = await readTask(id);
    expect(t.status).toBe('in_progress');
    expect(t.claimed_by).toBe('brain-dispatcher');
    expect(t.error_message).toBeNull();
  });

  it('script_run（跑场机脚本在跑）→ 保持 in_progress', async () => {
    const id = await seedScriptRun();
    await syncOrphanTasksOnStartup();

    expect((await readTask(id)).status).toBe('in_progress');
  });

  it('普通 dev 任务本机无进程 → 照旧回队（行为不变）', async () => {
    const id = await seedInProgress({ taskType: 'dev' });
    await syncOrphanTasksOnStartup();

    expect((await readTask(id)).status).toBe('queued');
  });
});

describe('B) 运行期活性探针不把外部执行体判死回队 [BEHAVIOR]', () => {
  it('旧 OpenClaw 标签没有实际运行证据，双确认后回队', async () => {
    const id = await seedQiumi({ executorKind: 'openclaw-agent', payload: { run_id: `legacy-${Date.now()}` }, minutesAgo: 4 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    const t = await readTask(id);
    expect(t.status).toBe('queued');
    expect(t.claimed_by).toBeNull();
    expect(suspectProcesses.has(id)).toBe(false);
    const ev = await pool.query(
      `SELECT 1 FROM task_events WHERE task_id = $1 AND event_type IN ('watchdog_safe_requeue', 'watchdog_headed_requeue')`,
      [id]
    );
    expect(ev.rowCount).toBe(1);
  });

  it('旧 SSH 在途标签没有运行证据，不获得永久存活豁免', async () => {
    const id = await seedQiumi({ executorKind: null, minutesAgo: 4 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    expect((await readTask(id)).status).toBe('queued');
  });

  it.each([false, true])('真实原生 TaskRun 未结算资源，本机无 PID 不能回队或清 claim ended=%s', async ended => {
    const id = await seedQiumi({ executorKind: 'external-worker', claimedBy: 'native-owner', minutesAgo: 60 });
    const runId = `native-owned-${id}`;
    await pool.query(`UPDATE tasks SET payload=$2 WHERE id=$1`, [id, { provider: 'native-agent', run_id: runId }]);
    await pool.query(`INSERT INTO task_runs(task_id,run_id,context) VALUES($1,$2,$3)`,
      [id, runId, { source: 'native-agent', native_agent: { task_id: id, run_id: runId, resource_bound: true } }]);
    if (ended) await pool.query("UPDATE task_runs SET ended_at=NOW(),status='cancelled' WHERE task_id=$1", [id]);
    await probeTaskLiveness();
    await probeTaskLiveness();
    expect(await readTask(id)).toMatchObject({ status: 'in_progress', claimed_by: 'native-owner' });
    expect((await pool.query('SELECT ended_at IS NOT NULL AS ended FROM task_runs WHERE task_id=$1', [id])).rows[0].ended).toBe(ended);
    expect((await pool.query(`SELECT 1 FROM task_events WHERE task_id=$1 AND event_type LIKE 'watchdog%requeue'`, [id])).rowCount).toBe(0);
  });

  it('原生接管持行锁未提交：探针等待后不能用旧快照回队', async () => {
    const id = await seedQiumi({ executorKind: null, minutesAgo: 60 });
    await probeTaskLiveness();
    const query = pool.query.bind(pool), owner = await pool.connect();
    let intercepted = false, observedLockWait = false;
    const spy = vi.spyOn(pool, 'query').mockImplementation(async (sql, params, ...rest) => {
      if (!intercepted && typeof sql === 'string' && sql.includes("status = 'queued', claimed_by = NULL") && params?.[0] === id) {
        intercepted = true;
        await owner.query('BEGIN');
        await owner.query(`INSERT INTO task_runs(task_id,run_id,context) VALUES($1,$2,$3)`,
          [id, `native-takeover-${id}`, { source: 'native-agent', native_agent: { task_id: id, resource_bound: true } }]);
        await owner.query("UPDATE tasks SET executor_kind='external-worker',claimed_by='new-native-owner' WHERE id=$1", [id]);
        const update = query(sql, params, ...rest);
        try {
          for (let attempt = 0; attempt < 100; attempt++) {
            const waiting = await owner.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
              AND wait_event_type='Lock' AND query LIKE 'UPDATE tasks SET status = ''queued'', claimed_by = NULL%'`);
            if (waiting.rowCount) { observedLockWait = true; break; }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        } finally { await owner.query('COMMIT'); }
        return update;
      }
      return query(sql, params, ...rest);
    });
    try { await probeTaskLiveness(); } finally { spy.mockRestore(); await owner.query('ROLLBACK'); owner.release(); }
    expect(intercepted).toBe(true);
    expect(observedLockWait).toBe(true);
    expect(await readTask(id)).toMatchObject({ status: 'in_progress', claimed_by: 'new-native-owner' });
    expect((await query(`SELECT 1 FROM task_events WHERE task_id=$1 AND event_type LIKE 'watchdog%requeue'`, [id])).rowCount).toBe(0);
  });

  it('script_run 双确认后仍 in_progress（生死归 script-reaper）', async () => {
    const id = await seedScriptRun({ minutesAgo: 10 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    expect((await readTask(id)).status).toBe('in_progress');
  });

  it('普通 dev 任务零证据 → 照旧双确认回队（94ee0ec4 假杀堵死不放宽）', async () => {
    const id = await seedInProgress({ taskType: 'dev', minutesAgo: 5 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    expect((await readTask(id)).status).toBe('queued');
  });
});
