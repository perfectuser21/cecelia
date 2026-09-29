/**
 * external-exec-orphan-liveness.integration.test.js [BEHAVIOR]
 *
 * 「活在别的机器上跑着，Brain 本机查不到进程就把它回队」——0929 两条同类现网 bug。
 *
 * ## A) 启动同步（syncOrphanTasksOnStartup）
 *   每次 Brain 部署重启，in_progress 且本机无进程的任务一律回 queued，且不清 claimed_by。
 *   device_job 执行在西安 Mac（领单器）、qiumi_task 执行在 MMV（openclaw agent，
 *   证据在 MMV ~/brain-runs/<run_id>.pid/.exit）——本机永远查不到进程 → 每次部署都被回队
 *   → device_job 会被中台 /api/schedule/claim 再领一次，同一活在真手机上重跑。
 *
 * ## B) 运行期活性探针（probeTaskLiveness）
 *   0929 15:43 qiumi 任务 87c9a08b（executor_kind=openclaw-agent，网关慢 4 分钟才起 agent）：
 *     15:40:05 openclaw_agent_spawned → 15:43:48 marked SUSPECT → 15:48:48 confirmed DEAD
 *     → 零 spawn 证据 → watchdog_safe_requeue；而 MMV 上 agent 实际在跑。
 *   探针只认本机三条 spawn 证据（activeProcesses / /tmp/cecelia-<id>.log / error_message），
 *   从不看 executor_kind——对外部执行体结构性恒判死。
 *
 * ## 契约
 *   外部执行体（注册表派生：device_job / qiumi_task / script_run，或 executor_kind 属其集合）：
 *   启动同步不回队、不动 claimed_by；运行期探针不判死不回队（openclaw-agent / script 交给
 *   各自收割器读远端 .exit，device_job 保留既有认领新鲜度 + 超时兜底，见
 *   liveness-external-executor-claim.integration.test.js）。其余任务类型行为不变。
 *
 * 禁 mock 被测边：真连 Postgres、真 executor.js、真 ps 探测（随机 UUID 天然无进程）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let pool;
let probeTaskLiveness;
let syncOrphanTasksOnStartup;
let suspectProcesses;
const seededIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const executor = await import('../../executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  syncOrphanTasksOnStartup = executor.syncOrphanTasksOnStartup;
  suspectProcesses = executor.suspectProcesses;
});

afterEach(async () => {
  suspectProcesses.clear();
  while (seededIds.length) {
    const id = seededIds.pop();
    await pool.query('DELETE FROM task_events WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
});

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
  executorKind: 'openclaw-agent',
  payload: { run_id: `qiumi-itest-${Date.now()}`, department: 'media' },
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

  it('openclaw-agent 的 qiumi_task（MMV agent 在跑）→ 保持 in_progress，claimed_by 不动', async () => {
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
  it('87c9a08b 原样复现：openclaw-agent 秋米任务起 4 分钟，双确认后仍 in_progress', async () => {
    const id = await seedQiumi({ minutesAgo: 4 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    const t = await readTask(id);
    expect(t.status).toBe('in_progress');
    expect(suspectProcesses.has(id)).toBe(false);
    const ev = await pool.query(
      `SELECT 1 FROM task_events WHERE task_id = $1 AND event_type IN ('watchdog_safe_requeue', 'watchdog_headed_requeue')`,
      [id]
    );
    expect(ev.rowCount).toBe(0);
  });

  it('ssh 派发在途（executor_kind 尚未落库）的 qiumi_task 同样不判死', async () => {
    const id = await seedQiumi({ executorKind: null, minutesAgo: 4 });
    await probeTaskLiveness();
    await probeTaskLiveness();

    expect((await readTask(id)).status).toBe('in_progress');
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
