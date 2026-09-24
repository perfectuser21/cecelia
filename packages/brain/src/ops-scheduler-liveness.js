/**
 * ops-scheduler-liveness — Brain 自己的 scheduler job 入运行舱（决策 69cd802f，task 50a2c256）。
 *
 * 起因：2026-09-24 notion-gtd-sync 内层 30s 循环卡死 8.4h，运行舱与 Notion 驾驶舱全绿——
 * 48 个 JOBS 是 Brain 自己的 workflow，却从未进 ops_workflows，活性判定只对表里的行生效。
 * 入图不靠手填：这里把 working_memory 里的调度哨兵翻译成 ops_workflows(source='scheduler') 行。
 *
 * 纪律：
 *  1. 活性只认时间戳，不看 ok：`lastRunAt = record.liveness_at ?? record.at`。job 在报错/超时
 *     也是在跑，`last_run_status='error'|'timeout'` 已是诚实信号；若失败哨兵一律算 null，
 *     错误行 last_run_at 永远 NULL 会触发每分钟刷新，且 dead→cold 会被当"恢复"误报 P2。
 *  2. 只写机器列。人工列（owner/note/priority/starred/enable_intent/dispatch）永不出现在 SET 里。
 *  3. 降噪：liveness / last_run_status 没变、last_run_at 前进不足 10 分钟、且 silent_sec 增长
 *     不足 600s 就不刷新——否则 48 行每分钟都"变更"，把 pushOpsWorkflows 的 LIMIT 50 吃光并让
 *     Notion 每轮 PATCH 48 页；最后一条专治 dead/warn 行——没有它，一个死了 8 小时的 job 会一直
 *     显示"停了 15 分钟"，这是全绿假象的变体。
 *  4. 失联告警按轮合并成一条 Bark（紧急告警走 Bark 的既定规矩；raise('P1') 每小时批发到飞书、
 *     只留 5 条预览、Brain 重启即丢缓冲，本案的告警走它可能延迟 1 小时或丢失）。恢复
 *     （dead → ok/warn，不含 dead → cold）走 raise('P2')。去重靠"只在翻转时发"。
 *     Bark 无 BARK_TOKEN 时静默返回 false（不抛）——发送成功与否不能靠 catch 判断，
 *     所以 `sent === false` 时兜底 `raise('P1', 'scheduler_job_dead', ...)` 一次，不让告警彻底消失。
 *  5. 下线的 job（不在本轮 jobs 里）把 source='scheduler' 行置 cold，并清空 silent_sec/liveness_at——
 *     不清会在驾驶舱显示"数据不足 + 停了 15 分钟"这种自相矛盾的旧值。
 *  6. 整函数包 try/catch：任一步抛错复用 ops-collector.js 的 `classifyError` 归类
 *     （unreachable/schema_drift/config_missing/parse_error），写 scheduler 来源的错误心跳
 *     并返回 { ok:false }，不静默变旧、不再统一硬编码 parse_error（与 n8n/launchd 腿口径一致）。
 *
 * JOBS 经 opts.jobs 注入，不 import scheduler-jobs.js（会成环：scheduler-jobs → 本模块 →
 * scheduler-jobs；仓库先例 routes/sentinel.js 同样"不 import，避免拖入 handler 依赖链"）。
 */
import { classifyDeclaredLiveness } from './ops-liveness.js';
import { writeHeartbeat, classifyError } from './ops-collector.js';
import { raise as defaultRaise } from './alerting.js';
import { sendBark as defaultBark } from './notifier.js';

export const SCHEDULER_SOURCE = 'scheduler';
export const SCHEDULER_MACHINE = 'us-vps';
const DEFAULT_SENTINEL_PREFIX = 'scheduler_job_last_run:';
const DEFAULT_INTERVAL_SEC = 60; // 调度轮 LOOP_INTERVAL_MS

function statusOf(rec) {
  if (!rec) return null;
  if (rec.timedOut) return 'timeout';
  return rec.ok ? 'success' : 'error';
}

/** scheduler-jobs handler（needsPool:true）。opts.jobs 必传（注入 JOBS）；其余供测试注入。 */
export async function runSchedulerLiveness(pool, opts = {}) {
  const {
    jobs = [],
    now = Date.now(),
    raise = defaultRaise,
    bark = defaultBark,
    sentinelPrefix = DEFAULT_SENTINEL_PREFIX,
  } = opts;
  const collectedAt = new Date(now).toISOString();

  try {
    const { rows } = await pool.query(
      `SELECT key, value_json FROM working_memory WHERE key LIKE $1`,
      [`${sentinelPrefix}%`],
    );
    const sentinels = new Map();
    for (const r of rows) {
      let rec = r.value_json;
      if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { rec = null; } }
      sentinels.set(String(r.key).slice(sentinelPrefix.length), rec);
    }

    const deadFlips = []; // 本轮翻 dead 的 job，按轮攒起来发一条 Bark
    let recovered = 0;
    for (const job of jobs) {
      const rec = sentinels.get(job.name) ?? null;
      const intervalSec = Number.isFinite(job.livenessIntervalSec) && job.livenessIntervalSec > 0
        ? job.livenessIntervalSec : DEFAULT_INTERVAL_SEC;
      // 纪律 1：自报优先，退回哨兵 at；不看 ok
      const lastRunAt = rec?.liveness_at ?? rec?.at ?? null;
      const lv = classifyDeclaredLiveness({ lastRunAt, intervalSec, now });
      const meta = {
        kind: 'scheduler_job', description: job.description ?? '', timeoutMs: job.timeoutMs ?? null,
        livenessIntervalSec: intervalSec, last_error: rec?.error ?? null,
      };
      // 纪律 2：SET 里只有机器列。纪律 3：WHERE 降噪（五条件）。RETURNING 带旧 liveness 供翻转告警
      //（RETURNING 里的子查询读的是本语句开始前的快照，拿到的是更新前的值，实测于 cecelia_scratch）。
      // 下标固定（测试按下标断言）：[0]wf_id [1]machine [2]meta [3]last_run_at [4]last_run_status
      // [5]baseline_interval_sec [6]liveness [7]silent_sec [8]warn_after_sec [9]dead_after_sec [10]liveness_at/updated_at
      const { rows: changed } = await pool.query(
        `INSERT INTO ops_workflows (source, wf_id, name, active, machine, meta,
           last_run_at, last_run_status, baseline_interval_sec, liveness, silent_sec,
           warn_after_sec, dead_after_sec, liveness_at, updated_at)
         VALUES ('${SCHEDULER_SOURCE}', $1, $1, FALSE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (source, wf_id) DO UPDATE SET
           name=EXCLUDED.name, active=FALSE, machine=EXCLUDED.machine, meta=EXCLUDED.meta,
           last_run_at=EXCLUDED.last_run_at, last_run_status=EXCLUDED.last_run_status,
           baseline_interval_sec=EXCLUDED.baseline_interval_sec, liveness=EXCLUDED.liveness,
           silent_sec=EXCLUDED.silent_sec, warn_after_sec=EXCLUDED.warn_after_sec,
           dead_after_sec=EXCLUDED.dead_after_sec, liveness_at=EXCLUDED.liveness_at, updated_at=EXCLUDED.updated_at
         WHERE ops_workflows.liveness IS DISTINCT FROM EXCLUDED.liveness
            OR ops_workflows.last_run_status IS DISTINCT FROM EXCLUDED.last_run_status
            OR ops_workflows.last_run_at IS NULL
            OR EXCLUDED.last_run_at - ops_workflows.last_run_at >= interval '10 minutes'
            OR EXCLUDED.silent_sec - ops_workflows.silent_sec >= 600
         RETURNING wf_id, liveness,
           (SELECT o.liveness FROM ops_workflows o WHERE o.source='${SCHEDULER_SOURCE}' AND o.wf_id=$1) AS prev_liveness`,
        [job.name, SCHEDULER_MACHINE, JSON.stringify(meta), lastRunAt, statusOf(rec), intervalSec,
          lv.liveness, lv.silent_sec, lv.warn_after_sec, lv.dead_after_sec, collectedAt],
      );
      const row = changed[0];
      if (!row) continue;
      // 只在翻转时告警：ok/warn/cold → dead 本轮攒起来一条 Bark；dead → ok/warn 恢复告一次
      if (row.liveness === 'dead' && row.prev_liveness !== 'dead') {
        deadFlips.push({ name: job.name, silentSec: lv.silent_sec, deadAfterSec: lv.dead_after_sec, intervalSec, lastRunAt });
      } else if (row.prev_liveness === 'dead' && (row.liveness === 'ok' || row.liveness === 'warn')) {
        recovered += 1;
        try {
          await raise('P2', `scheduler_job_recovered_${job.name}`, `🟢 调度 job ${job.name} 恢复（${row.liveness}）`);
        } catch (e) {
          console.warn(`[scheduler-liveness] 告警失败 ${job.name}: ${e.message}`);
        }
      }
    }

    // 纪律 4：失联按轮合并成一条 Bark（不逐条 raise('P1')）；Bark 无 token 静默返回 false 时兜底 raise
    if (deadFlips.length > 0) {
      const title = `🔴 调度 job 失联 ${deadFlips.length} 个`;
      const body = deadFlips
        .map((d) => `${d.name}：最后一轮 ${d.lastRunAt ?? '从未'}，静默 ${d.silentSec ?? '?'}s ≥ ${d.deadAfterSec}s（尺子 ${d.intervalSec}s）`)
        .join('\n');
      try {
        const sent = await bark(title, body);
        if (sent === false) {
          try {
            await raise('P1', 'scheduler_job_dead', body);
          } catch (e) {
            console.warn(`[scheduler-liveness] 告警失败: ${e.message}`);
          }
        }
      } catch (e) {
        console.warn(`[scheduler-liveness] Bark 发送失败: ${e.message}`);
      }
    }

    // 纪律 5：下线的 job 不留僵尸红灯——连带清空 silent_sec/liveness_at，避免"数据不足+停了 N 分钟"自相矛盾
    const jobNames = jobs.map((j) => j.name);
    await pool.query(
      `UPDATE ops_workflows SET liveness='cold', silent_sec=NULL, liveness_at=NULL, updated_at=NOW()
       WHERE source='${SCHEDULER_SOURCE}' AND wf_id <> ALL($1::text[]) AND liveness IS DISTINCT FROM 'cold'`,
      [jobNames],
    );

    await writeHeartbeat(pool, SCHEDULER_SOURCE, SCHEDULER_MACHINE, 'ok', null, null, collectedAt);
    return { ok: true, jobs: jobs.length, flippedDead: deadFlips.length, recovered };
  } catch (err) {
    try {
      const [status, code] = classifyError(err);
      await writeHeartbeat(pool, SCHEDULER_SOURCE, SCHEDULER_MACHINE, status, code, err.message, collectedAt);
    } catch (hbErr) {
      console.warn(`[scheduler-liveness] 错误心跳写入失败: ${hbErr.message}`);
    }
    return { ok: false, error: err.message };
  }
}
