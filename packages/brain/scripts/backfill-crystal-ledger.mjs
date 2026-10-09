#!/usr/bin/env node
/**
 * backfill-crystal-ledger.mjs — 判官口粮第一铲：近 N 天 run 数据回填 crystal_ledger
 *
 * 病灶（2026-09-07 实测）：crystal-judge 每天在跑，但 crystal_ledger 只有 10 行，
 * og1..og8 全部 n_runs=0/data_gap=true，crystal_verdict 8 条全是 keep_llm{"rule":"data_gap"}
 * ——判官在空账上判案。根因不是 bug：判官只吃 crystal_run_evidence（迁移 438），
 * 而该表只有人工搬运的 7 行。真实运行数据躺在另外两张表里无人搬：
 *   - ops_runs（迁移 439 运行舱刀6）4505 行 n8n execution 实录
 *   - tasks 59 条 dev 终态
 * 本脚本就是把这两张表的历史 run 数据铲进台账的那把铲子。
 *
 * 与任务描述的三处偏差（按真实 schema 纠偏，详见
 * docs/superpowers/specs/2026-09-07-crystal-ledger-backfill-design.md 与决策 0e200050）：
 *   ① 幂等键不是 task_id：crystal_ledger 无该列，唯一键是 (report_date, grid_key)，
 *      且它是按日聚合表而非逐 run 明细表。聚合是源数据的确定性函数 → 重跑行数不变。
 *   ② payload.pipeline='canvas' 在 tasks 里 0 行，真正的 canvas run 在 ops_runs
 *      （AwrSocialLeadgenV4 155/193≈80%、AwrCodingHarnessV4 56/63≈89%，正是主理人
 *      引用的「智能获客 80%/编码 89%」）。故增 ops_runs 为第二源，tasks 两条规则原样保留。
 *   ③ token 无源：task_run_metrics 2026-08-23 后断流，n8n 按迁移 439 明说不记 token。
 *      → token_cost=0 且 data_gap=true 诚实标注成本缺口，绝不编造。判决引擎因此
 *      只会出 keep_llm，与「没有成本证据就不许晋升」的语义一致。
 *
 * 写者隔离：判官每天只判「og 八格 ∪ 当日有 evidence 的段」，本脚本的 grid_key 一律带
 * `n8n:` / `task:` 前缀，不在其中 → 两个写者各写各的行，回填不会被次日判官抹掉，
 * 也不会覆盖判官原有判决。本脚本只写 crystal_ledger，不写 crystal_verdict（只补账不代判）。
 *
 * 用法：
 *   node packages/brain/scripts/backfill-crystal-ledger.mjs [--days=30] [--dry-run]
 */

import pool from '../src/db.js';

/** 默认回填窗口（天）。 */
export const BACKFILL_DEFAULT_DAYS = 30;

/**
 * 判定一条 task 归哪个判决单位。canvas 优先于 task_type：
 * pipeline 标记的是「这条 run 走的哪条流水线」，比任务分类更贴近判决单位语义。
 * @param {{task_type?: string, pipeline?: string|null}} task
 * @returns {string|null} grid_key，两条规则都不命中返回 null（不入账）
 */
export function gridKeyForTask(task = {}) {
  if (task.pipeline === 'canvas') return 'task:canvas';
  if (task.task_type === 'dev') return 'task:dev';
  return null;
}

function toFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 把扁平 run 列表聚合成 crystal_ledger 行（纯函数：无 DB、无时钟、无环境依赖）。
 *
 * @param {Array<{report_date: string, grid_key: string, success: boolean, duration_ms: number|null}>} runs
 * @returns {Array<object>} 按 (report_date, grid_key) 稳定排序的 ledger 行
 */
export function aggregateLedgerRows(runs = []) {
  const buckets = new Map();

  for (const r of runs) {
    const reportDate = r?.report_date;
    const gridKey = r?.grid_key;
    // 缺 key 的脏行直接跳过：宁可少一行，不可往账本里塞无归属的数
    if (!reportDate || !gridKey) continue;

    const id = `${reportDate}|${gridKey}`;
    let b = buckets.get(id);
    if (!b) {
      b = { report_date: reportDate, grid_key: gridKey, n_runs: 0, passes: 0, msSum: 0, msCount: 0 };
      buckets.set(id, b);
    }
    b.n_runs += 1;
    if (r.success) b.passes += 1;

    const ms = toFiniteNumber(r.duration_ms);
    if (ms !== null) {
      b.msSum += ms;
      b.msCount += 1;
    }
  }

  return [...buckets.values()]
    .sort((a, b) => (a.report_date === b.report_date
      ? a.grid_key.localeCompare(b.grid_key)
      : a.report_date.localeCompare(b.report_date)))
    .map((b) => ({
      report_date: b.report_date,
      grid_key: b.grid_key,
      n_runs: b.n_runs,
      success_rate: b.passes / b.n_runs,
      broken_count: b.n_runs - b.passes,
      // 无时长样本时留 null 而非 0：0ms 是个假事实，null 才是「没测到」
      latency_ms: b.msCount > 0 ? b.msSum / b.msCount : null,
      // 无 token 源 → 记 0 并置 data_gap，绝不拿别的成本顶替（见文件头 ③）
      token_cost: 0,
      new_branch_rate: 0,
      data_gap: true,
    }));
}

/**
 * 从 ops_runs 取 n8n 实录。report_date 在 SQL 里就换算成北京日，
 * 避免 node 进程时区不同导致同一条 run 落到不同日期（跨机器重跑会破幂等）。
 */
async function fetchOpsRuns(dbPool, days) {
  const { rows } = await dbPool.query(
    `SELECT to_char(started_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS report_date,
            'n8n:' || wf_id                                               AS grid_key,
            (status = 'success')                                          AS success,
            duration_sec * 1000                                           AS duration_ms
       FROM ops_runs
      WHERE started_at IS NOT NULL
        AND started_at > NOW() - ($1 || ' days')::interval
        AND status <> 'running'`,
    [String(days)],
  );
  return rows;
}

/**
 * 从 tasks 取 Brain 任务终态。
 * 终态时刻取 COALESCE(completed_at, updated_at)——实测有 13 条 completed 任务
 * completed_at 为空（回写只改了 status），拿 updated_at 兜底才不丢这些 run。
 * tasks 的时间列是 timestamp without time zone（按 DB 会话时区落盘），
 * 先 AT TIME ZONE current_setting('TIMEZONE') 还原成绝对时刻再换算北京日。
 */
async function fetchTaskRuns(dbPool, days) {
  const { rows } = await dbPool.query(
    `WITH terminal AS (
       SELECT task_type,
              payload->>'pipeline' AS pipeline,
              status,
              COALESCE(completed_at, updated_at) AS ended_at,
              started_at
         FROM tasks
        WHERE status IN ('completed', 'failed')
          AND COALESCE(completed_at, updated_at) IS NOT NULL
          AND COALESCE(completed_at, updated_at) > NOW() - ($1 || ' days')::interval
          AND (task_type = 'dev' OR payload->>'pipeline' = 'canvas')
     )
     SELECT to_char(
              (ended_at AT TIME ZONE current_setting('TIMEZONE')) AT TIME ZONE 'Asia/Shanghai',
              'YYYY-MM-DD'
            )                                    AS report_date,
            task_type,
            pipeline,
            (status = 'completed')               AS success,
            CASE WHEN started_at IS NOT NULL AND ended_at > started_at
                 THEN EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000
            END                                  AS duration_ms
       FROM terminal`,
    [String(days)],
  );
  return rows
    .map((r) => ({ ...r, grid_key: gridKeyForTask(r) }))
    .filter((r) => r.grid_key !== null);
}

/** 逐行 upsert 台账。冲突键 (report_date, grid_key) → 重跑刷新数值，行数不变。 */
async function upsertLedgerRow(dbPool, row) {
  await dbPool.query(
    `INSERT INTO crystal_ledger
       (report_date, grid_key, n_runs, success_rate, token_cost, latency_ms,
        new_branch_rate, broken_count, data_gap, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW(), NOW())
     ON CONFLICT (report_date, grid_key) DO UPDATE SET
       n_runs = EXCLUDED.n_runs,
       success_rate = EXCLUDED.success_rate,
       token_cost = EXCLUDED.token_cost,
       latency_ms = EXCLUDED.latency_ms,
       new_branch_rate = EXCLUDED.new_branch_rate,
       broken_count = EXCLUDED.broken_count,
       data_gap = EXCLUDED.data_gap,
       updated_at = NOW()`,
    [
      row.report_date,
      row.grid_key,
      row.n_runs,
      row.success_rate,
      row.token_cost,
      row.latency_ms,
      row.new_branch_rate,
      row.broken_count,
      row.data_gap,
    ],
  );
}

/**
 * 回填主流程：取两源 → 聚合 → upsert。
 * @param {{days?: number, dryRun?: boolean, dbPool?: import('pg').Pool}} opts
 */
export async function backfillCrystalLedger({ days = BACKFILL_DEFAULT_DAYS, dryRun = false, dbPool = pool } = {}) {
  const [opsRuns, taskRuns] = await Promise.all([
    fetchOpsRuns(dbPool, days),
    fetchTaskRuns(dbPool, days),
  ]);

  const ledgerRows = aggregateLedgerRows([...opsRuns, ...taskRuns]);

  if (!dryRun) {
    for (const row of ledgerRows) {
      await upsertLedgerRow(dbPool, row);
    }
  }

  return {
    days,
    dry_run: dryRun,
    source_runs: { ops_runs: opsRuns.length, tasks: taskRuns.length },
    ledger_rows: ledgerRows.length,
    rows: ledgerRows,
  };
}

function parseArgs(argv) {
  const daysArg = argv.find((a) => a.startsWith('--days='));
  const days = daysArg ? Number(daysArg.split('=')[1]) : BACKFILL_DEFAULT_DAYS;
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`--days 必须是正数，收到: ${daysArg}`);
  }
  return { days, dryRun: argv.includes('--dry-run') };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('backfill-crystal-ledger.mjs');
if (isDirectRun) {
  const { days, dryRun } = parseArgs(process.argv.slice(2));
  backfillCrystalLedger({ days, dryRun })
    .then((r) => {
      console.log(
        '[backfill-crystal-ledger] %s 窗口=%d天 源(ops_runs=%d, tasks=%d) → 台账行=%d',
        dryRun ? 'DRY-RUN（未写库）' : '已写库',
        r.days,
        r.source_runs.ops_runs,
        r.source_runs.tasks,
        r.ledger_rows,
      );
      for (const row of r.rows) {
        console.log(
          '  %s %s n_runs=%d success_rate=%s latency_ms=%s',
          row.report_date,
          row.grid_key,
          row.n_runs,
          row.success_rate.toFixed(3),
          row.latency_ms === null ? 'null' : Math.round(row.latency_ms),
        );
      }
      return pool.end();
    })
    .catch((err) => {
      console.error('[backfill-crystal-ledger] 失败:', err.message);
      process.exitCode = 1;
      return pool.end();
    });
}
