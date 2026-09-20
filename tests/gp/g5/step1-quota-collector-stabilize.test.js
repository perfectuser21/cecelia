// G5「管家 · 算力与基础设施调度」步骤 1「接单即选到有额度的执行体」
// —— 边：模型账号配额采集器（选号的唯一数据源）
//
// 本测试锁死的，是「配额数据可不可以当选号权威」的三个前提。任务 424d9dd2（刀 0）。
//
// 现场（2026-09-20 实测，生产 us-vps）：
//   ops_model_accounts 里两个 Claude 号 pct 恒 NULL、status=unknown、
//   last_error='anthropic usage HTTP 429'；Grok key_expired。
//
// 三条根因，逐条对应本文件的三组断言：
//   ① 采集器没有自 gate。scheduler 的调度模型是「60s 轮询 + 模块自 gate」
//      （scheduler-jobs.js:5-9），别的 job 都自带窗口，唯独它是裸调用 →
//      8 账号 × 60 次/小时 ≈ 480 次厂商 usage 调用/小时 → 429 是我们自己造的。
//   ② defaultExec 是 execSync（host-exec.js:20），8 账号串行 × 30s 超时
//      = 最坏 240s 同步阻塞 Brain 事件循环；job 的 timeoutMs 走 Promise.race，
//      对同步阻塞完全无效（定时器根本没机会跑）。
//   ③ catch 分支不回滚 snapshot，仍以 EMPTY_SNAPSHOT 无条件 upsert
//      → 一次抖动就把上一轮真实读数擦成 NULL。
//      于是 NULL 的语义是「最近一次采集失败」，而不是「没查到」。
//
// 主理人 0920 补充的两条判定（已落 decisions category=judgment）：
//   - 单次失败不算数：可重试类错误轮内重试 2 次，连续 3 轮失败才落确定性 status 并告警
//   - 429 不重试：重试只会加剧限流，与根因①同源
import { describe, it, expect, vi } from 'vitest';
import {
  runModelAccountsCollector,
  COLLECT_INTERVAL_MS,
  MODEL_ACCOUNT_STATUS,
  MODEL_ACCOUNTS,
} from '../../../packages/brain/src/ops-model-accounts-collector.js';

/**
 * 记录型 fake pool。
 * - SELECT MAX(last_checked_at) 类查询 → 返回 gate 行
 * - upsert → 记录 sql/params，按 RETURNING 回一行
 */
function makePool({ lastCollectedAt = null, consecutiveFailures = 0, prevStatus = 'ok' } = {}) {
  const calls = [];
  return {
    calls,
    upserts: () => calls.filter((c) => /INSERT INTO ops_model_accounts/i.test(c.sql)),
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT[\s\S]*last_checked_at/i.test(sql) && !/INSERT/i.test(sql)) {
        return { rows: lastCollectedAt === null ? [] : [{ last_collected_at: lastCollectedAt }] };
      }
      return {
        rows: [{
          account_id: params?.[0],
          consecutive_failures: consecutiveFailures,
          status: prevStatus,
        }],
      };
    },
  };
}

const NOW = Date.parse('2026-09-20T02:00:00.000Z');
const okUsage = JSON.stringify({ five_hour: { utilization: 42 }, seven_day: { utilization: 7 } });

function rateLimitError() {
  const err = new Error('Command failed');
  err.status = 4;
  err.stderr = 'anthropic usage HTTP 429\n';
  return err;
}

function flakyNetworkError() {
  const err = new Error('Command failed');
  err.status = 255;
  err.stderr = 'ssh: connect to host 100.71.151.105 port 22: Operation timed out\n';
  return err;
}

describe('G5 step1 · 根因① 采集器自 gate（停止自造 429）', () => {
  it('导出采集周期常量，且不短于 5 分钟（60s 轮询下必须自己拦住）', () => {
    expect(typeof COLLECT_INTERVAL_MS).toBe('number');
    expect(COLLECT_INTERVAL_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('距上次采集不足一个周期 → 跳过，且一次厂商调用都不发', async () => {
    const pool = makePool({ lastCollectedAt: new Date(NOW - 60_000).toISOString() });
    const exec = vi.fn(async () => okUsage);

    const r = await runModelAccountsCollector(pool, { exec, inContainer: false, now: () => NOW });

    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('self_gate');
    expect(exec).not.toHaveBeenCalled();
    expect(pool.upserts()).toHaveLength(0);
  });

  it('超过一个周期 → 正常采集', async () => {
    const pool = makePool({ lastCollectedAt: new Date(NOW - COLLECT_INTERVAL_MS - 1000).toISOString() });
    const exec = vi.fn(async () => okUsage);

    const r = await runModelAccountsCollector(pool, { exec, inContainer: false, now: () => NOW });

    expect(r.skipped).toBeFalsy();
    expect(exec).toHaveBeenCalled();
  });

  it('only（按需刷新单账号）与 force 必须能绕过 gate —— 刀1 选号侧要用这个接缝', async () => {
    const poolOnly = makePool({ lastCollectedAt: new Date(NOW - 1000).toISOString() });
    const execOnly = vi.fn(async () => okUsage);
    const rOnly = await runModelAccountsCollector(poolOnly, {
      only: 'claude-account2', exec: execOnly, inContainer: false, now: () => NOW,
    });
    expect(rOnly.skipped).toBeFalsy();
    expect(execOnly).toHaveBeenCalledTimes(1);

    const poolForce = makePool({ lastCollectedAt: new Date(NOW - 1000).toISOString() });
    const execForce = vi.fn(async () => okUsage);
    const rForce = await runModelAccountsCollector(poolForce, {
      force: true, exec: execForce, inContainer: false, now: () => NOW,
    });
    expect(rForce.skipped).toBeFalsy();
    expect(execForce).toHaveBeenCalled();
  });
});

describe('G5 step1 · 根因② 异步化（不许同步掐死 Brain 事件循环）', () => {
  it('采集器不得使用同步的 defaultExec —— 必须走异步接缝', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/ops-model-accounts-collector.js', import.meta.url),
      'utf8',
    );
    // 只允许异步版本；出现裸 defaultExec（后面不接 Async）即回归
    expect(src).not.toMatch(/\bdefaultExec\b(?!Async)/);
    expect(src).toMatch(/defaultExecAsync/);
  });

  it('单轮全部账号的探测有总预算，超预算的剩余账号本轮跳过（不让一轮无限延长）', async () => {
    const pool = makePool({ lastCollectedAt: null });
    let virtualNow = NOW;
    // 每个账号耗 20s 虚拟时间；8 账号串行 = 160s，必须在总预算处截断
    const exec = vi.fn(async () => { virtualNow += 20_000; return okUsage; });

    const r = await runModelAccountsCollector(pool, {
      exec, inContainer: false, now: () => virtualNow,
    });

    expect(exec.mock.calls.length).toBeLessThan(MODEL_ACCOUNTS.length);
    expect(r.budget_exhausted).toBe(true);
  });
});

describe('G5 step1 · 根因③ 失败不擦白历史读数（变异测试锚）', () => {
  it('采集失败时写库不得触碰 pct 列 —— 上一轮真实读数必须留着', async () => {
    const pool = makePool({ lastCollectedAt: null });
    const exec = vi.fn(async () => { throw flakyNetworkError(); });

    await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0,
    });

    const upserts = pool.upserts();
    expect(upserts.length).toBeGreaterThan(0);
    for (const c of upserts) {
      // 失败路径的 SQL 里不许出现 pct 列的赋值（否则就是把历史读数擦成 NULL）
      expect(c.sql).not.toMatch(/five_hour_pct\s*=/i);
      expect(c.sql).not.toMatch(/seven_day_pct\s*=/i);
    }
  });

  it('采集成功时正常写 pct（成功路径不受影响）', async () => {
    const pool = makePool({ lastCollectedAt: null });
    const exec = vi.fn(async () => okUsage);

    await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW,
    });

    const sql = pool.upserts()[0].sql;
    expect(sql).toMatch(/five_hour_pct/i);
    expect(pool.upserts()[0].params).toContain(42);
  });
});

describe('G5 step1 · 主理人判定：单次失败不算数（重试 + 连续 3 轮确认）', () => {
  it('可重试错误（ssh/网络/超时）→ 轮内重试，第 3 次成功即算成功', async () => {
    const pool = makePool({ lastCollectedAt: null });
    let n = 0;
    const exec = vi.fn(async () => {
      n += 1;
      if (n < 3) throw flakyNetworkError();
      return okUsage;
    });

    const r = await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0,
    });

    expect(exec).toHaveBeenCalledTimes(3);
    expect(r.results[0].status).toBe('ok');
  });

  it('429 一律不重试（重试加剧限流），且要有独立分类 rate_limited', async () => {
    const pool = makePool({ lastCollectedAt: null });
    const exec = vi.fn(async () => { throw rateLimitError(); });

    const r = await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(r.results[0].status).toBe('rate_limited');
    expect([...MODEL_ACCOUNT_STATUS]).toContain('rate_limited');
  });

  it('key_expired / no_credential 是确定性否定事实 → 不重试', async () => {
    const pool = makePool({ lastCollectedAt: null });
    const exec = vi.fn(async () => {
      const err = new Error('Command failed');
      err.stderr = "ENOENT: no such file or directory, open '~/.claude-account1/.credentials.json'\n";
      throw err;
    });

    const r = await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0,
    });

    expect(exec).toHaveBeenCalledTimes(1);
    expect(r.results[0].status).toBe('no_credential');
  });

  it('连续失败计数在 SQL 里自增（不许 SELECT 判态再 UPDATE —— 铁律 761f242b）', async () => {
    const pool = makePool({ lastCollectedAt: null, consecutiveFailures: 0 });
    const exec = vi.fn(async () => { throw flakyNetworkError(); });

    await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0,
    });

    const sql = pool.upserts()[0].sql;
    expect(sql).toMatch(/consecutive_failures\s*=\s*ops_model_accounts\.consecutive_failures\s*\+\s*1/i);
    // 未达 3 次前 status 保持上一轮的值，由 SQL 的 CASE 决定，同样不做先读后写
    expect(sql).toMatch(/CASE\s+WHEN[\s\S]*consecutive_failures[\s\S]*THEN/i);
  });

  it('连续失败未达 3 次 → 不告警', async () => {
    const pool = makePool({ lastCollectedAt: null, consecutiveFailures: 1, prevStatus: 'ok' });
    const onAlert = vi.fn();
    const exec = vi.fn(async () => { throw flakyNetworkError(); });

    await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0, onAlert,
    });

    expect(onAlert).not.toHaveBeenCalled();
  });

  it('连续失败刚好达到 3 次 → 告警一次（之后不再重复刷）', async () => {
    const exec = vi.fn(async () => { throw flakyNetworkError(); });

    const poolThird = makePool({ lastCollectedAt: null, consecutiveFailures: 3, prevStatus: 'unknown' });
    const onAlertThird = vi.fn();
    await runModelAccountsCollector(poolThird, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0, onAlert: onAlertThird,
    });
    expect(onAlertThird).toHaveBeenCalledTimes(1);

    const poolFourth = makePool({ lastCollectedAt: null, consecutiveFailures: 4, prevStatus: 'unknown' });
    const onAlertFourth = vi.fn();
    await runModelAccountsCollector(poolFourth, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW, retryDelayMs: 0, onAlert: onAlertFourth,
    });
    expect(onAlertFourth).not.toHaveBeenCalled();
  });

  it('成功一轮后连续失败计数归零', async () => {
    const pool = makePool({ lastCollectedAt: null, consecutiveFailures: 2 });
    const exec = vi.fn(async () => okUsage);

    await runModelAccountsCollector(pool, {
      only: 'claude-account1', exec, inContainer: false, now: () => NOW,
    });

    expect(pool.upserts()[0].sql).toMatch(/consecutive_failures\s*=\s*0/i);
  });
});
