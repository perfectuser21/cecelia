/**
 * liveness-never-started.integration.test.ts [BEHAVIOR]
 *
 * TDD Red 证据（vitest）— watchdog liveness 探针「从未启动任务」误判 liveness_dead 修复。
 * 复现任务 1dfa40f7 场景：started_at=null、pid 未跟踪、无 /tmp/cecelia-<id>.log、
 * error_message=S2 锚点执法拒绝点火、payload.failure_class=missing_anchor。
 *
 * 禁 mock 被测边：真连 cecelia_test Postgres（不 mock db.js）、真 executor.js 模块、
 * 真 ps 进程探测（随机 UUID 天然无进程）。零 vi.mock。
 *
 * 毕业去向（generator 义务）：packages/brain/src/__tests__/integration/
 * liveness-never-started.integration.test.js + 登记 vitest.config.js POSTGRES_INTEGRATION_TESTS，
 * 永久回归测试入 CI（brain-integration job）。毕业时仅允许改 import 相对路径，断言逐字不变。
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { writeFileSync, rmSync } from 'fs';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const S2_ERROR_MESSAGE =
  'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火';

let pool: any;
let probeTaskLiveness: any;
let suspectProcesses: any;
const seededIds: string[] = [];
const tmpLogs: string[] = [];

beforeAll(async () => {
  pool = (await import('../../../packages/brain/src/db.js')).default;
  const executor = await import('../../../packages/brain/src/executor.js');
  probeTaskLiveness = executor.probeTaskLiveness;
  suspectProcesses = executor.suspectProcesses;
});

afterEach(async () => {
  suspectProcesses.clear();
  while (seededIds.length) {
    const id = seededIds.pop();
    // 先清 learnings（学习文本保真断言的 fixture 副产物），再清 tasks
    await pool.query('DELETE FROM learnings WHERE task_id = $1', [id]);
    await pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
  while (tmpLogs.length) {
    try { rmSync(tmpLogs.pop() as string); } catch { /* already gone */ }
  }
});

async function seedTask(overrides: Record<string, any> = {}) {
  const {
    started_at = null,
    error_message = null,
    payload = {},
    title = 'liveness-never-started 回归 fixture',
  } = overrides;
  const r = await pool.query(
    `INSERT INTO tasks (title, task_type, status, payload, error_message, started_at)
     VALUES ($1, 'dev', 'in_progress', $2, $3, $4) RETURNING id`,
    [title, JSON.stringify(payload), error_message, started_at]
  );
  const id = r.rows[0].id;
  seededIds.push(id);
  return id;
}

async function readTask(id: string) {
  const r = await pool.query(
    'SELECT status, error_message, payload FROM tasks WHERE id = $1',
    [id]
  );
  return r.rows[0];
}

async function doubleConfirmProbe() {
  // 真实两轮探针：第一轮标 suspect，第二轮确认死亡——suspect 状态跨轮真实保留，不重置
  await probeTaskLiveness();
  await probeTaskLiveness();
}

describe('watchdog liveness 从未启动任务分类 [BEHAVIOR]', () => {
  it('从未启动任务（started_at=null 且无进程日志且 pid 未跟踪）双确认后 watchdog_kill.reason 为 never_started', async () => {
    const id = await seedTask({
      error_message: S2_ERROR_MESSAGE,
      payload: { failure_class: 'missing_anchor' },
    });

    await doubleConfirmProbe();

    const row = await readTask(id);
    const killReason = row.payload?.watchdog_kill?.reason;
    expect(killReason).toBe('never_started');
    expect(killReason).not.toBe('process_disappeared');
    expect(killReason).not.toBe('liveness_dead');
  });

  it('从未启动任务已有 error_message 与 payload.failure_class=missing_anchor 不被 watchdog 记账覆盖', async () => {
    const id = await seedTask({
      error_message: S2_ERROR_MESSAGE,
      payload: { failure_class: 'missing_anchor' },
    });

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.error_message).toBe(S2_ERROR_MESSAGE);
    expect(row.payload?.failure_class).toBe('missing_anchor');
    // 真根因标签保真：分类结果为 never_started（与上一条联合构成 1dfa40f7 完整复现）
    expect(row.payload?.watchdog_kill?.reason).toBe('never_started');
  });

  it('回归：曾启动任务（started_at 非空 + 进程日志存在）仍判 process_disappeared，行为与现状一致', async () => {
    const id = await seedTask({
      started_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      payload: { current_run_id: 'run-regression-dead-000' },
    });
    // 进程日志存在（中性内容，不含 Error/SIGKILL/timeout 关键词）→ 曾启动证据
    const logPath = `/tmp/cecelia-${id}.log`;
    writeFileSync(logPath, 'process started\nworking on task\n');
    tmpLogs.push(logPath);

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.payload?.watchdog_kill?.reason).toBe('process_disappeared');
  });

  it('从未启动任务的 failure learning 文本含真实根因标签 never_started 且不含 liveness_dead 假标签', async () => {
    // PRD 行 20 (b)：failure learning 文本必须携带真实根因，不再出现 liveness_dead 假标签。
    // 现状实证：executor.js requeueTask 内 learnings INSERT（category=failure_pattern,
    // trigger_event=watchdog_kill）的 title/content 取 requeue 通道参数 liveness_dead → 本断言真红。
    // fixture 标题带时间戳唯一化：learnings 以 content_hash（title+content 派生）去重，
    // 固定标题会命中历史 is_latest 行跳写，导致复跑假红。
    const id = await seedTask({
      title: `liveness-learning 保真 fixture ${Date.now()}`,
      error_message: S2_ERROR_MESSAGE,
      payload: { failure_class: 'missing_anchor' },
    });

    await doubleConfirmProbe();

    // task_id 定位 + created_at 5 分钟时间窗，防历史 learnings 行冒充本轮产出
    const r = await pool.query(
      `SELECT title, content FROM learnings
       WHERE task_id = $1 AND trigger_event = 'watchdog_kill'
         AND created_at > NOW() - interval '5 minutes'`,
      [id]
    );
    expect(r.rows.length).toBeGreaterThanOrEqual(1);
    const text = r.rows.map((row: any) => `${row.title} ${row.content}`).join('\n');
    expect(text).toContain('never_started');
    expect(text).not.toContain('liveness_dead');
  });

  it('边界：started_at=null 但存在进程日志（确实曾启动）→ 不判 never_started，仍走既有 process_disappeared 判定', async () => {
    const id = await seedTask({
      started_at: null,
      payload: {},
    });
    const logPath = `/tmp/cecelia-${id}.log`;
    writeFileSync(logPath, 'partial startup output without keywords\n');
    tmpLogs.push(logPath);

    await doubleConfirmProbe();

    const row = await readTask(id);
    expect(row.payload?.watchdog_kill?.reason).toBe('process_disappeared');
    expect(row.payload?.watchdog_kill?.reason).not.toBe('never_started');
  });
});

describe('dev-failure-classifier 识别 never_started [BEHAVIOR]', () => {
  it('never_started 失败文本不落 transient 环境重试通道（liveness_dead 假分类）', async () => {
    const { classifyDevFailure } = await import(
      '../../../packages/brain/src/dev-failure-classifier.js'
    );
    const r = classifyDevFailure({
      error:
        '[watchdog] liveness_probe_failed reason=never_started 进程从未启动（S2锚点执法拒绝点火）',
    });
    expect(r.class).not.toBe('transient');
  });
});
