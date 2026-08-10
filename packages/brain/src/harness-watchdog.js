/**
 * harness-watchdog.js — Brain 进程级 harness initiative 兜底 watchdog。
 *
 * Spec: docs/superpowers/specs/2026-05-06-harness-langgraph-reliability-design.md §W3
 *
 * 设计理由：
 *   `runHarnessInitiativeRouter` 进程内 setTimeout 触发 abort 是第一道防线，
 *   但若 Brain 进程重启 / setTimeout 被 GC / invoke 卡死不响应 signal，
 *   逾期 initiative 会永远悬空。所以 tick 注册 5min/次扫描兜底：
 *
 *   - 扫 `initiative_runs WHERE phase IN ('A_planning','B_task_loop','C_final_e2e')
 *     AND deadline_at < NOW() AND completed_at IS NULL`
 *   - 标 phase=failed, failure_reason=watchdog_overdue, completed_at=NOW()
 *   - 不删 checkpoint（留诊断）
 *   - 可选 notifier 写 P1 alert（飞书/DB）
 *
 * Spec §W3 反复强调的不变量：
 *   - 不要静默吞错 — failed 路径必须留 failure_reason 文本
 *   - notifier 是 optional dep — 兼容 Brain dev 环境无飞书 token
 *   - 不主动 DELETE FROM checkpoints — 避免误删 in-flight 任务
 */
import pool from './db.js';
import { execSync } from 'child_process';
import { patchKernelRunById } from './orchestrator/kernel-run-store.js';

/**
 * 扫描所有 in-flight initiative_runs，标 deadline_at 已过未完成的为 watchdog_overdue。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {{ send: (msg: object) => Promise<void> }} [opts.notifier]
 * @returns {Promise<{ flagged: string[], scanned: number }>}
 */
export async function scanStuckHarness({
  pool: dbPool = pool,
  notifier,
  patchRun = patchKernelRunById,
} = {}) {
  const overdue = await dbPool.query(`
    SELECT id, initiative_id, current_task_id, contract_id, deadline_at, phase
    FROM initiative_runs
    WHERE phase IN ('A_planning', 'B_task_loop', 'C_final_e2e')
      AND orchestrator_version = 'v2'
      AND current_task_id IS NOT NULL
      AND deadline_at IS NOT NULL
      AND deadline_at < NOW()
      AND completed_at IS NULL
    ORDER BY deadline_at ASC
    LIMIT 50
  `);

  const flagged = [];
  for (const row of overdue.rows) {
    try {
      await patchRun(dbPool, {
        runId: row.id,
        phase: 'failed',
        failureReason: 'watchdog_overdue',
      });
      flagged.push(row.initiative_id);
      console.warn(
        `[harness-watchdog] flagged initiative=${row.initiative_id} ` +
        `phase=${row.phase} deadline=${row.deadline_at?.toISOString?.() || row.deadline_at}`
      );

      if (notifier && typeof notifier.send === 'function') {
        try {
          await notifier.send({
            priority: 'P1',
            title: `Harness watchdog: initiative ${row.initiative_id} overdue`,
            body: `phase=${row.phase} deadline_at=${row.deadline_at}`,
          });
        } catch (notifyErr) {
          console.warn(
            `[harness-watchdog] notifier failed (non-fatal) for ${row.initiative_id}: ${notifyErr.message}`
          );
        }
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] mark failed (initiative=${row.initiative_id}) (non-fatal): ${err.message}`
      );
    }
  }
  return { flagged, scanned: overdue.rows.length };
}

/**
 * resumeStalledHarnessDrivers — OPEN-2 看门狗：重排「驱动器已死」的 parked harness 任务。
 *
 * 根因：harness_initiative parent graph 在 planner interrupt 后由 planner-callback 的
 * 一次性 in-memory invoke 同步驱动到 END。驱动器丢失（brain 重启/部署/异常）后，任务 park
 * 在非-END checkpoint。dispatcher 只 claim queued、唯一 re-driver startup-sync 仅 boot 跑
 * → 任务死等下次重启。本看门狗把它做成 tick 级周期版。
 *
 * 安全设计（杜绝双驱动 / 误杀合法等待）：
 *   - 区段 B（phase='B_task_loop'，run_sub_task 阻塞区）用**心跳判据**：只重排
 *     driver_heartbeat_at 陈旧/NULL 的任务（活驱动每 30s 刷心跳 → 新鲜=活，别动）。
 *   - 区段 A（phase IN A_contract/A_planning，planner/GAN）用**活动复合判据**（见下方
 *     P1 扩面注释）——A 阶段心跳天然陈旧，必须靠 run_events/updated_at 综合判活。
 *     （旧版"排除 A_planning"的不变量已废弃：那导致 A 阶段卡死永远没人管，见 P1 扩面。）
 *   - 心跳判据细节：活驱动（run_sub_task
 *     的 _waitForSubGraphCompletion）每 ~30s 刷心跳 → 心跳新鲜必然=活驱动在 pump（不动）。
 *   - 重排 = status→queued + resume_from_checkpoint=true（executor 走 resume 续 checkpoint）
 *     + 清 claim 三件套（否则 dispatcher 的 claimed_by IS NULL 永远选不出 → 死锁）。
 *   - UPDATE 带 `AND status='in_progress'` 原子守卫，防两个并发 tick 双翻。
 *   - 重排任务在 dispatcher 侧豁免并发 cap（见 dispatcher.js::shouldApplyHarnessCap），
 *     否则其它活跑占满 cap 时自愈被 cap 锁死。
 *
 * 根因 3（2026-06-10）：staleMinutes 默认 3→10。心跳每 ~30s 刷一轮，但 driver 在
 * poll 间隙会做长同步操作（gh pr view 验 merged、docker inspect liveness、contract
 * import git fetch/push、spawn prep），多个慢调用叠加可断流数分钟；3min 阈值会把活
 * driver 误判 parked → 重排 → 并发双驱动（06-06 GAN heartbeat 事故同根因系）。
 *
 * ── P1 扩面（2026-06-13）：覆盖 planner/GAN(A) 阶段静默卡死 ──
 * 教训：liveness 巡检的覆盖面必须 = 故障面。旧版只捞 phase='B_task_loop'，于是
 * planner/GAN(A) 阶段回调丢失致图永久 interrupt-waiting（run b37f04a4 / 7c3a35a5）
 * 永远没人管，"全自动"就破在最后这一步。
 *
 * 但 A 阶段不能套用 B 的心跳判据：driver_heartbeat_at 只在 graph stream 推进时刷
 * （executor.writeDriverHeartbeat）；planner interrupt 后 stream 结束、驱动器返回，
 * 等容器 callback 这段窗口 brain 内**本就无驱动器** → 心跳结构性陈旧/NULL，无法区分
 * "合法等容器" vs "回调丢失永久卡死"。故 A 阶段改用**活动复合判据**：
 *   phase IN ('A_contract','A_planning') 且
 *   GREATEST(driver_heartbeat_at, initiative_runs.updated_at, initiative_run_events.ts)
 *   全部静默超 staleMinutesA（活 GAN/planner 容器每轮回调写 run_events → 新鲜=活，别动）。
 * 命中 → **fresh-start 重排**（剥离 resume_from_checkpoint，让 executor 走
 * `existing && !resumeRequested` 分支重跑 planner 并递增 execution_attempts），并以
 * COALESCE(execution_attempts,0) < MAX_INITIATIVE_FRESH_STARTS 为上限（坏任务不无限重试；
 * 超限不再重排，由 executor terminal-fail 收尾）。A 阶段无活驱动 → fresh-start 无双驱动风险。
 *
 * @param {object} [opts]
 * @param {import('pg').Pool} [opts.pool]
 * @param {number} [opts.staleMinutes=10]   B 阶段心跳陈旧阈值（分钟）
 * @param {number} [opts.staleMinutesA=20]  A 阶段活动静默阈值（分钟）
 * @param {number} [opts.maxFreshStarts]    A 阶段 fresh-start 上限（默认 = executor.MAX_INITIATIVE_FRESH_STARTS）
 * @param {(cmd: string) => string} [opts.execFn]  shell 执行函数（供测试注入 mock），
 *   默认 execSync 包装。区段C 判死前用它探测容器是否仍在跑
 *   （docker ps -q --filter "name=cecelia-relay-<task前8字符>"），
 *   与 harness-relay-watchdog.js:resumeStalledRelayRuns 同款模式。
 * @returns {Promise<{ resumed: string[], scanned: number }>}
 */
export async function resumeStalledHarnessDrivers({
  pool: dbPool = pool,
  staleMinutes = 10,
  staleMinutesA = 20,
  maxFreshStarts,
  execFn = (cmd) => execSync(cmd, { encoding: 'utf8', timeout: 8000, stdio: 'pipe' }),
} = {}) {
  const resumed = [];
  let scanned = 0;

  // ── 区段 B：心跳陈旧 + phase='B_task_loop'（run_sub_task 阻塞区）→ resume_from_checkpoint ──
  // 既有逻辑保持不变（守护 #3356/#3361 等恢复路径）。
  const stalledB = await dbPool.query(
    `SELECT t.id
       FROM tasks t
       JOIN initiative_runs ir ON ir.initiative_id = t.id
      WHERE t.task_type = 'harness_initiative'
        AND t.status = 'in_progress'
        AND t.payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'
        AND ir.phase = 'B_task_loop'
        AND ir.completed_at IS NULL
        AND (t.driver_heartbeat_at IS NULL
             OR t.driver_heartbeat_at < NOW() - ($1 || ' minutes')::interval)
      ORDER BY t.driver_heartbeat_at ASC NULLS FIRST
      LIMIT 20`,
    [String(staleMinutes)]
  );
  scanned += stalledB.rows.length;

  for (const row of stalledB.rows) {
    try {
      const upd = await dbPool.query(
        `UPDATE tasks SET
           status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           started_at = NULL,
           payload = COALESCE(payload, '{}'::jsonb) || '{"resume_from_checkpoint": true}'::jsonb,
           updated_at = NOW()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length > 0) {
        resumed.push(row.id);
        console.warn(
          `[harness-watchdog] resumed stalled driver: task=${row.id} ` +
          `(driver_heartbeat stale >${staleMinutes}min, phase=B_task_loop → re-queue resume_from_checkpoint)`
        );
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] resume stalled driver failed (task=${row.id}) (non-fatal): ${err.message}`
      );
    }
  }

  // ── 区段 A：planner/GAN(A) 阶段活动静默 + 未超 fresh-start 上限 → fresh-start 重排 ──
  let maxFresh = maxFreshStarts;
  if (maxFresh == null) {
    // 复用 executor 的 SSOT 上限；懒加载避免把 executor 整个依赖图拉进 watchdog/单测。
    try {
      ({ MAX_INITIATIVE_FRESH_STARTS: maxFresh } = await import('./executor.js'));
    } catch {
      maxFresh = 3;
    }
  }

  // skill-relay 不写下方三个活性信号（心跳/run updated_at/run_events），静默≠卡死；其兜底归 harness-relay-watchdog（docker ps 存活 + PR 核验）。区段B 同样排除（防 LangGraph 遗留 B_task_loop 僵尸行误判），区段C 保留（relay spawn 失败无 run 行时由它捞回）。
  const stalledA = await dbPool.query(
    `SELECT t.id, COALESCE(t.execution_attempts, 0) AS execution_attempts
       FROM tasks t
      WHERE t.task_type = 'harness_initiative'
        AND t.status = 'in_progress'
        AND COALESCE(t.execution_attempts, 0) < $2::int
        AND t.payload->>'orchestrator' IS DISTINCT FROM 'skill-relay'
        AND EXISTS (
              SELECT 1 FROM initiative_runs ir
               WHERE ir.initiative_id = t.id
                 AND ir.phase IN ('A_contract', 'A_planning')
                 AND ir.completed_at IS NULL)
        AND NOT EXISTS (
              SELECT 1 FROM initiative_runs ir2
               WHERE ir2.initiative_id = t.id
                 AND ir2.phase IN ('B_task_loop', 'C_final_e2e')
                 AND ir2.completed_at IS NULL)
        AND GREATEST(
              COALESCE(EXTRACT(EPOCH FROM t.driver_heartbeat_at), 0),
              COALESCE((SELECT MAX(EXTRACT(EPOCH FROM ir3.updated_at))
                          FROM initiative_runs ir3 WHERE ir3.initiative_id = t.id), 0),
              COALESCE((SELECT MAX(e.ts)
                          FROM initiative_run_events e WHERE e.initiative_id = t.id), 0)
            ) < EXTRACT(EPOCH FROM NOW()) - ($1::int * 60)
      ORDER BY t.id
      LIMIT 20`,
    [Number(staleMinutesA), Number(maxFresh)]
  );
  scanned += stalledA.rows.length;

  for (const row of stalledA.rows) {
    try {
      // fresh-start：剥离 resume_from_checkpoint，executor `existing && !resumeRequested`
      // 分支会 bump attemptN + 递增 execution_attempts + 重跑 planner（重新 spawn 容器）。
      const upd = await dbPool.query(
        `UPDATE tasks SET
           status = 'queued',
           claimed_by = NULL,
           claimed_at = NULL,
           started_at = NULL,
           payload = (COALESCE(payload, '{}'::jsonb) - 'resume_from_checkpoint'),
           updated_at = NOW()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length > 0) {
        resumed.push(row.id);
        console.warn(
          `[harness-watchdog] resumed stalled planner/GAN driver: task=${row.id} ` +
          `(phase=A 活动静默 >${staleMinutesA}min, execution_attempts=${row.execution_attempts}/${maxFresh} ` +
          `→ fresh-start re-spawn planner)`
        );
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] resume stalled planner/GAN driver failed (task=${row.id}) (non-fatal): ${err.message}`
      );
    }
  }

  // ── 区段 C：从未真正开始（fabf6bd6）——claim 成功、status=in_progress，但连
  // initiative_runs 行都没有，说明 graph 从未被 invoke（dispatcher 侧异常吞掉了）。
  // 区段 A/B 都靠 JOIN/EXISTS initiative_runs 判活，这类任务对它们完全不可见。
  // 没有 checkpoint 可续 → 不是 resume，直接标 failed 释放 claim，让上游/用户重新点火。
  const neverStartedThresholdMin = staleMinutesA; // 复用 A 阶段阈值，不新增参数
  const neverStarted = await dbPool.query(
    `SELECT t.id
       FROM tasks t
      WHERE t.task_type = 'harness_initiative'
        AND t.status = 'in_progress'
        AND NOT EXISTS (SELECT 1 FROM initiative_runs ir WHERE ir.initiative_id = t.id)
        AND t.claimed_at IS NOT NULL
        AND t.claimed_at < NOW() - ($1 || ' minutes')::interval
      ORDER BY t.claimed_at ASC
      LIMIT 20`,
    [String(neverStartedThresholdMin)]
  );
  scanned += neverStarted.rows.length;

  for (const row of neverStarted.rows) {
    try {
      // 容器存活探测（07-19 bug fix）：慢启动/前台接管容器可能仍在正常干活，
      // 只是还没来得及写 initiative_runs 首行——命名规约与 relay-watchdog 一致
      // （cecelia-relay-<task前8字符>）。docker 命令失败时 fail-open：保留现有
      // 判死逻辑，不因探测本身出问题而漏判真正死亡的任务。
      const short8 = String(row.id).replace(/-/g, '').slice(0, 8);
      let containerAlive = false;
      try {
        const running = execFn(`docker ps -q --filter "name=cecelia-relay-${short8}"`).trim();
        containerAlive = Boolean(running);
      } catch { /* docker 不可用，fail-open 走判死路径 */ }

      if (containerAlive) {
        console.log(
          `[harness-watchdog] never-started 候选 task=${row.id} 容器仍在跑（docker ps 命中），跳过本轮判死`
        );
        continue;
      }

      const upd = await dbPool.query(
        // 决策 e8f6134f 交付物2：terminal 失败必写 result.failure_class（受控枚举）+failure_detail，
        // 供 GET /harness/failure-stats 按根因计量（never-started 归 watchdog_deadline）。
        `UPDATE tasks SET
           status = 'failed',
           claimed_by = NULL,
           claimed_at = NULL,
           error_message = 'harness_initiative never started graph (no initiative_runs row, claimed_at stale)',
           result = COALESCE(result, '{}'::jsonb) || jsonb_build_object(
             'failure_class', 'watchdog_deadline',
             'failure_detail', 'harness_initiative never started graph (no initiative_runs row, claimed_at stale)'
           ),
           updated_at = NOW()
         WHERE id = $1 AND status = 'in_progress'
         RETURNING id`,
        [row.id]
      );
      if (upd.rows.length > 0) {
        resumed.push(row.id);
        console.warn(
          `[harness-watchdog] marked never-started harness task failed: task=${row.id} ` +
          `(no initiative_runs row, claimed_at stale >${neverStartedThresholdMin}min)`
        );
      }
    } catch (err) {
      console.error(
        `[harness-watchdog] mark never-started failed (task=${row.id}) (non-fatal): ${err.message}`
      );
    }
  }

  return { resumed, scanned };
}

export default { scanStuckHarness, resumeStalledHarnessDrivers };
