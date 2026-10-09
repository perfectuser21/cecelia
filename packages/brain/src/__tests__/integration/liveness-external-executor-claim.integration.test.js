/**
 * liveness-external-executor-claim.integration.test.js [BEHAVIOR]
 *
 * 「活在别的机器上跑着，本机 liveness 把它判死回队」——device_job 的结构性误杀。
 *
 * ## 0923 生产实证（单 e8c1dbce，小彩 ANGYVB4311010223）
 *
 *   21:17:50  工作机领单器认领 → in_progress，真机开始采收
 *   21:28     [liveness] confirmed DEAD → 零 spawn 证据 → 安全回队（status 改回 queued）
 *   21:34:09  活真干完了，回执被拒：NOT_RUNNING「这条活已不在执行中」
 *   21:35:19  同一条活**又被领走**，手机上重跑一遍
 *
 * 根因：liveness 的三条 spawn 证据全是 **Brain 本机（us-vps）** 的——
 *   A. activeProcesses 条目   B. /tmp/cecelia-<id>.log   D. error_message
 * 而 device_job 由工作机领单器在**西安的 Mac** 上执行，进程和日志都在那台机器上，
 * us-vps 这三条一条都不会有。于是**每一个 device_job 都必然被判死**。
 *
 * 后果不只是丢回执：状态被改回 queued 后会被再次认领，同一个活在真手机上反复执行
 * ——机时浪费，而且在抖音上重复操作有风控风险。
 *
 * ## 契约
 *
 * 认领新鲜（claimed_by 非空且 claimed_at 在宽限期内）= 外部执行体活着的证据，
 * liveness 不插手。宽限期过了仍无回执 → 落回既有 SUSPECT→DEAD 流程，
 * 工作机真挂了照样有出路，不会僵死在 in_progress。
 *
 * 禁 mock 被测边：真连 Postgres、真 executor.js、真 ps 探测（随机 UUID 天然无进程）。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

let pool;
let probeTaskLiveness;
let suspectProcesses;
const seededIds = [];

beforeAll(async () => {
  pool = (await import('../../db.js')).default;
  const executor = await import('../../executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
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

/** 造一条「已被工作机领单器认领、正在真机上跑」的 device_job */
async function seedDeviceJob({
  claimedMinutesAgo = 5,
  claimedBy = 'mac-mini-m1-us-claimer',
  taskType = 'device_job',
} = {}) {
  const r = await pool.query(
    `INSERT INTO tasks (title, task_type, status, payload, claimed_by, claimed_at, started_at, trigger_source)
     VALUES ($1, $2, 'in_progress', $3::jsonb, $4,
             NOW() - ($5 || ' minutes')::interval,
             NOW() - ($5 || ' minutes')::interval, 'manual')
     RETURNING id`,
    [
      `liveness-external-claim fixture ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      taskType,
      JSON.stringify({
        source: 'oneoff',
        serial: 'ANGYVB4311010223',
        params: { job_type: 'harvest_keyword', keyword: 'AI获客' },
      }),
      claimedBy,
      String(claimedMinutesAgo),
    ]
  );
  const id = r.rows[0].id;
  seededIds.push(id);
  return id;
}

async function readTask(id) {
  const r = await pool.query('SELECT status, claimed_by FROM tasks WHERE id = $1', [id]);
  return r.rows[0];
}

/** 真实两轮探针：第一轮标 suspect，第二轮确认死亡 */
async function doubleConfirmProbe() {
  await probeTaskLiveness();
  await probeTaskLiveness();
}

describe('liveness 不该把「在别的机器上跑着的活」判死回队 [BEHAVIOR]', () => {
  it('认领新鲜的 device_job → 不回队（0923 单 e8c1dbce 的原样复现）', async () => {
    const id = await seedDeviceJob({ claimedMinutesAgo: 5 });
    await doubleConfirmProbe();

    const t = await readTask(id);
    expect(t.status).toBe('in_progress');
    expect(t.claimed_by).toBe('mac-mini-m1-us-claimer');
  });

  it('采收要跑 25 分钟也不能被判死 —— 真机实测单个词 17~25 分钟', async () => {
    // 生产实测：一个视频要逐个点进评论者主页核验身份，25 分钟是常态不是异常。
    // 宽限期若短于这个时长，等于每一单都会在跑完前被回队重领。
    const id = await seedDeviceJob({ claimedMinutesAgo: 25 });
    await doubleConfirmProbe();

    expect((await readTask(id)).status).toBe('in_progress');
  });

  it('认领过久仍无回执 → 落回既有流程被回队（工作机真挂了要有出路）', async () => {
    // 不能为了不误杀就永不回收：那样工作机断电后活会永远僵在 in_progress，
    // 页面上看着在跑、实际没人做，比误杀更难发现。
    const id = await seedDeviceJob({ claimedMinutesAgo: 24 * 60 });
    await doubleConfirmProbe();

    expect((await readTask(id)).status).toBe('queued');
  });

  it('没有认领者的 device_job 不受豁免 —— 豁免的依据是「有人正在做」', async () => {
    const id = await seedDeviceJob({ claimedBy: null, claimedMinutesAgo: 5 });
    await doubleConfirmProbe();

    expect((await readTask(id)).status).toBe('queued');
  });

  it('别的任务类型照旧 —— 这次豁免只针对外部执行体，不放宽 dev 任务', async () => {
    // dev 任务由 Brain 自己在本机 spawn，三条 spawn 证据本来就该有；
    // 若也跟着豁免，等于把 94ee0ec4 那次修的假杀堵死一起放开了。
    const id = await seedDeviceJob({ taskType: 'dev', claimedMinutesAgo: 5 });
    await doubleConfirmProbe();

    expect((await readTask(id)).status).toBe('queued');
  });
});
