import { headedTaskMutation, registerHeadedTakeoverRoute } from './task-headed-takeover.js';
import { rateLimit } from 'express-rate-limit';
import { TASK_MUTATION_RATE_LIMIT_OPTIONS } from './task-mutation-rate-limit.js';
import { COMPANY_KR_SQL_GUARD } from '../lib/company-kr-metrics.js';
import pool from '../db.js';
import { emit as emitEvent } from '../event-bus.js';
import { pushHandoffAtom } from '../handoff.js';
import { prepareHandoffForWrite } from '../lib/relay-baton.js';
import { blockTask } from '../task-updater.js';
import { resolveAllowedTransitions } from '../lib/task-status-transitions.js';
import { afterTerminalTransition, isRelayTerminalStatus } from '../lib/task-terminal.js';
import { getTaskType } from '../lib/task-type-registry.js';
import { authoringMutationError } from '../workflow-authoring/task-guard.js';

export function registerTaskStatusRoutes(router) {


/**
 * PATCH /api/brain/tasks/:task_id
 * 更新任务状态（Engine 调用）
 */
registerHeadedTakeoverRoute(router,{pool});

router.patch('/tasks/:task_id', rateLimit(TASK_MUTATION_RATE_LIMIT_OPTIONS), headedTaskMutation(pool,async (req, res, pool) => {
  try {
    const { task_id } = req.params;
    const { status, result } = req.body;

    // Require status or result（result 纯补写合法 — issue a638f840 report Step1 场景）
    if (!status && result === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: status or result',
        code: 'MISSING_FIELD'
      });
    }

    // result 必须是普通对象（jsonb || 合并语义）
    if (result !== undefined && (result === null || typeof result !== 'object' || Array.isArray(result))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid result: must be a JSON object',
        code: 'INVALID_RESULT'
      });
    }

    const reservedError = authoringMutationError(null, { result });
    if (reservedError) return res.status(409).json(reservedError);

    // Validate status value if provided
    if (status) {
      // completed_no_pr 补进来（任务简报未列此处，PR1 走查发现）：这道闸卡在转移表校验
      // 之前，target status 不在这个白名单里会先 400 INVALID_STATUS 短路——不补的话
      // openclaw-agent 面永远到不了 completed_no_pr，转移表和下面的 409 分流都是死代码。
      const allowedStatuses = ['in_progress', 'completed', 'completed_no_pr', 'failed'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status value',
          code: 'INVALID_STATUS',
          allowed: allowedStatuses
        });
      }
    }

    // Get current task
    const taskResult = await pool.query(
      `SELECT id, status, claimed_by, executor_kind, task_type,
              payload->>'orchestrator' AS orchestrator,
              payload->>'review_required' AS review_required_raw,
              review_status, pr_url, pr_merged_at, payload, result
       FROM tasks WHERE id = $1`,
      [task_id]
    );
    if (taskResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
        code: 'TASK_NOT_FOUND'
      });
    }

    const task = taskResult.rows[0];
    const authoringError = authoringMutationError(task, { status });
    if (authoringError) return res.status(409).json(authoringError);
    const currentStatus = task.status;
    // 看门狗误阻断后的有头恢复必须先走原子 claim。否则 PATCH 会把空 owner
    // 自动填成 session:engine-patch，真正执行者随后 claim 得到 409。
    if (status === 'in_progress' && currentStatus === 'blocked'
      && (task.payload?.headed_manual === true || task.payload?.headed_manual === 'true')
      && !task.claimed_by) {
      return res.status(409).json({
        success: false,
        code: 'CLAIM_REQUIRED_FOR_BLOCKED_RECOVERY',
        error: '有头任务恢复前须先 POST /tasks/:id/claim，由真实执行者认领',
      });
    }

    // handoff 下一步四类（主理人 2026-10-11 决策）：写入前把 next_steps 规范成带 kind 的对象，
    // 未标/认不出/旧值条目按有头/无头默认归类，响应里回报每条被当成了什么（handoff_next_steps）。
    let handoffFeedback = null;
    if (result && result.handoff && typeof result.handoff === 'object' && !Array.isArray(result.handoff)) {
      const prepared = prepareHandoffForWrite(task, result.handoff);
      result.handoff = prepared.handoff;
      handoffFeedback = prepared.feedback;
    }

    // status === currentStatus → 幂等 no-op：跳过 transition 校验与事件，仅应用 result 等字段
    // no-op 不重触发 promoteRegression/KR 重算——补写场景 promote 已由 callback 4 终态路径承接（spec 有意设计，非遗漏）
    const isStatusNoop = Boolean(status) && status === currentStatus;

    // Validate status transition if status is being changed
    if (status && !isStatusNoop) {
      // 转移表已抽到 lib/task-status-transitions.js。
      // 0921 事故：这张表原先内联在此处且只枚举 8 个状态，生产实际用到 15 个——
      // 没枚举到的取 undefined、被判否后以 allowed:[] 返回，和"设计上的终态"
      // 长得一模一样，于是 2483 条任务（blocked 287 / cancelled 1485 / archived 673 /
      // completed_no_pr 38 / quota_exhausted）活干完了也写不回账本（issue a4991491）。
      const { known, allowed } = resolveAllowedTransitions(currentStatus);

      if (!known) {
        // 和"这是终态"必须可分辨：漏枚举是缺陷，不是策略。
        return res.status(409).json({
          success: false,
          error: `Task status '${currentStatus}' has no declared transitions`,
          code: 'UNKNOWN_TASK_STATUS',
          current_status: currentStatus,
          requested_status: status,
          allowed: [],
          hint: '该状态未在 lib/task-status-transitions.js 声明；补进 TASK_STATUSES + TRANSITIONS',
        });
      }

      if (!allowed.includes(status)) {
        return res.status(409).json({
          success: false,
          error: 'Invalid status transition',
          code: 'INVALID_TRANSITION',
          current_status: currentStatus,
          requested_status: status,
          allowed,
        });
      }
    }

    // 非产 PR 的执行面（openclaw-agent）不许写 completed：完成闸按 PR 语义设计，
    // 这类任务的销账态是 completed_no_pr。只限该执行面——talk/research 等存量类型
    // 今天 PATCH completed 合法，不动。
    if (status === 'completed' && !isStatusNoop && getTaskType(task.task_type)?.surface === 'openclaw-agent') {
      return res.status(409).json({
        success: false,
        error: `task_type '${task.task_type}' 不产 PR，完成态必须写 completed_no_pr`,
        code: 'USE_COMPLETED_NO_PR',
        current_status: currentStatus,
        requested_status: status,
        hint: "PATCH {\"status\":\"completed_no_pr\"}",
      });
    }

    // 完成态前置条件硬闸（三案实证漏洞，2026-07-19）
    // 阻止 review 未通过/PR 未合并绕过验证直接写 completed。
    // harness_initiative(skill-relay) 任务已有专属的"收账权收归"机制(finalizeHarnessTask，
    // 决策dc18d43d，见下方紧接的代码块)独立核验外部真相并优雅降级——这两条硬闸规则不覆盖
    // 它，避免抢在前面短路已有的降级逻辑（07-19 回归实测：会导致该机制的测试从
    // 200 accepted:false 变成本处硬 422，是真实冲突不是理论风险）。
    const isSkillRelayHarness = task.task_type === 'harness_initiative' && task.orchestrator === 'skill-relay';
    if (status === 'completed' && !isStatusNoop && !isSkillRelayHarness) {
      // Rule 1: review_required=true → review_status 必须是明确 approved（拒绝或未知均不得完成）
      if (task.review_required_raw === 'true' && task.review_status !== 'approved') {
        // liveness probe 误杀回归（07-19 实锤）：若不把任务转出 in_progress，
        // 容器进程退出后 probeTaskLiveness()（只扫 status='in_progress'）会把
        // "合法等待审核"误判成"进程死了"，触发 requeueTask 完整重新派发——
        // 产出多个重复 PR。转 blocked 后 liveness probe 不会再碰到它；
        // review 通过后由外部流程重新 PATCH completed，届时此闸放行。
        await blockTask(task_id, { reason: 'review_not_approved', detail: 'review_status 非 approved，等待人工审核通过' });
        return res.status(422).json({
          success: false,
          error: 'review_required=true 但 review_status 非 approved — 需先通过审核',
          code: 'REVIEW_NOT_APPROVED',
          current_review_status: task.review_status || null,
        });
      }

      // Rule 2: pr_url 非空 → pr_merged_at 必须非空（PR 已合并）
      if (task.pr_url && !task.pr_merged_at) {
        // 同上：转 blocked 避免 liveness probe 误杀重跑（dc69c8df 任务实测复现，
        // 4106→4108→4112 三个重复 PR）。PR 真正合并后 engine-pr-watchdog 的
        // 终态 PATCH 会重新尝试，此时 pr_merged_at 有值，本闸放行。
        await blockTask(task_id, { reason: 'pr_not_merged', detail: `pr_url=${task.pr_url} 已设置但尚未合并` });
        return res.status(422).json({
          success: false,
          error: 'pr_url 已设置但 pr_merged_at 为空 — PR 需先合并',
          code: 'PR_NOT_MERGED',
          pr_url: task.pr_url,
        });
      }
    }

    // 收账权收归（决策 dc18d43d）：harness_initiative(skill-relay) completed 一律申请，
    // Brain 核验外部真相不过 → 降级中间态（保持原状态 + 写 generator_done），200 accepted:false。
    let harnessDemoted = false;
    let harnessDemoteReason = null;
    let harnessUngated = false;
    let harnessUngatedReason = null;
    if (status === 'completed' && !isStatusNoop
        && task.task_type === 'harness_initiative' && task.orchestrator === 'skill-relay') {
      const { finalizeHarnessTask } = await import('../lib/harness-finalize.js');
      // 把本次请求里带的 pr_url 传下去：engine-pr-watchdog 的终态回写是
      // PATCH {status:'completed', result:{pr_url}}，闸此前只看库里的字段，
      // 协议两头对不上导致任务干完也回不去账本（issue a4991491）。
      // 只是线索——finalize 仍会 gh pr view 核到 MERGED 才认。
      const requestedPrUrl = req.body?.result?.pr_url ?? req.body?.pr_url ?? null;
      const fin = await finalizeHarnessTask(task_id, { pool, requestedPrUrl });
      if (fin.applies && !fin.allow) { harnessDemoted = true; harnessDemoteReason = fin.reason; }
      // 未验收合并：放行但留疤 + 不自动提升回归（照 relay-watchdog 的策略）
      if (fin.applies && fin.allow && fin.ungated) {
        harnessUngated = true;
        harnessUngatedReason = fin.failureReason;
      }
    }

    // Build dynamic UPDATE query
    const setClauses = ['updated_at = NOW()'];
    const params = [];
    let paramIdx = 1;

    if (status && !isStatusNoop && !harnessDemoted) {
      const changedAt = new Date().toISOString();
      const historyEntry = { from: currentStatus, to: status, changed_at: changedAt, source: 'engine' };
      setClauses.push(`status = $${paramIdx++}`);
      params.push(status);
      setClauses.push(`status_history = status_history || $${paramIdx++}::jsonb`);
      params.push(JSON.stringify([historyEntry]));
      // Clear claim on terminal states — prevents zombie locks where claimed_by residue
      // blocks selectNextDispatchableTask (which filters claimed_by IS NULL)
      if (status === 'failed' || status === 'completed' || status === 'completed_no_pr') {
        setClauses.push('claimed_by = NULL');
        setClauses.push('claimed_at = NULL');
      }
      // 认领协议统一（T4）: in_progress 时自动写 claimed_by + executor_kind
      // 防止 dispatcher selectNextDispatchableTask(claimed_by IS NULL 过滤)重复抢跑
      if (status === 'in_progress') {
        const sessionId = req.headers['x-session-id'] || 'engine-patch';
        setClauses.push(`claimed_by = COALESCE(claimed_by, $${paramIdx++})`);
        params.push(`session:${sessionId}`);
        setClauses.push(`claimed_at = COALESCE(claimed_at, NOW())`);
        // 仅在 executor_kind 为 NULL 时打标，不覆盖 Brain 已设置的 kind
        if (task.executor_kind === null || task.executor_kind === undefined) {
          setClauses.push(`executor_kind = $${paramIdx++}`);
          params.push('headed-session');
        }
      }
    }

    // 生命周期时间戳属于状态事实，不依赖本次是否发生状态迁移：
    // 同状态幂等回写也要能修复历史上已经终态但时间戳为空的数据。
    if (status === 'in_progress') {
      setClauses.push('started_at = COALESCE(started_at, NOW())');
    }
    if (status === 'completed' || status === 'completed_no_pr') {
      setClauses.push('started_at = COALESCE(started_at, completed_at, NOW())');
      setClauses.push('completed_at = COALESCE(completed_at, NOW())');
    }

    if (result !== undefined) {
      setClauses.push(`result = COALESCE(result, '{}'::jsonb) || $${paramIdx++}::jsonb`);
      params.push(JSON.stringify(result));
    }

    params.push(task_id);
    const updateResult = await pool.query(
      `UPDATE tasks SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
       RETURNING status, updated_at, started_at, completed_at`,
      params
    );

    const updatedTask = updateResult.rows[0];

    // relay handoff 登记缺口修复（08-04）：skill-relay 直接 PATCH result.handoff 不走
    // saveHandoff，导致零 handoff atom。此处 API 侧兜底：result.handoff 为有效对象时
    // 推一条 capture_atom（pushHandoffAtom 与 saveHandoff 同口径；空/非法对象返回 null；
    // 吞错不阻断 PATCH 响应）。
    if (result && result.handoff !== undefined) {
      try {
        await pushHandoffAtom(pool, task_id, result.handoff);
      } catch (handoffAtomErr) {
        console.warn(`[tasks-patch] pushHandoffAtom failed (non-fatal): ${handoffAtomErr.message}`);
      }
    }

    // 接力棒（2026-09-23）：任务收口时确保有 handoff（没有就合成并标 synthesized），
    // 再把 handoff.next_steps 落成下一棒（task→queued 子任务挂同根；decision→待拍板）。
    // 统一走 lib/task-terminal.js 的终态钩子（09-25 收口：completed_no_pr 也接棒）。
    // 两个触发口：① 本次转可接棒终态；② 已终态的任务补写 result.handoff（watchdog 顺序）。
    let relay = null;
    const becameRelayTerminal = isRelayTerminalStatus(status) && !isStatusNoop && !harnessDemoted;
    const handoffArrivedOnTerminal = Boolean(result?.handoff) && isRelayTerminalStatus(updatedTask?.status);
    if (becameRelayTerminal || handoffArrivedOnTerminal) {
      const hook = await pool.afterCommit(pool => afterTerminalTransition(pool, task_id, updatedTask?.status || status, { sessionId: req.headers['x-session-id'] || null }));
      relay = hook?.relay ?? null;
    }

    if (status && !isStatusNoop && !harnessDemoted) {
      await emitEvent('task_status_changed', {
        task_id,
        from: currentStatus,
        to: status,
        source: 'engine',
        timestamp: new Date().toISOString()
      });

      // 任务完成时自动触发 KR 进度重算
      if (status === 'completed') {
        // T2. harness merged 终态 → 累积 FR 冻结（fail-open；harness-report Step 1 走此路径）
        // 未验收合并不享受自动提升 —— 这是 relay-watchdog 已定策略里真正的惩罚所在
        // （放行是因为 PR 客观已合并拦不住，惩罚落在"不提升"而不是锁死账本）。
        if (harnessUngated) {
          console.warn(`[tasks-patch] task=${task_id} ${harnessUngatedReason} → 跳过 regression 自动提升`);
        } else {
          try {
            const { promoteRegressionOnHarnessMerged } = await import('../lib/callback-postprocess.js');
            await promoteRegressionOnHarnessMerged(task_id, result || null, req.body.pr_url || null, pool);
          } catch (promoteErr) {
            console.warn(`[tasks-patch] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${promoteErr.message}`);
          }
        }
        try {
          const initiativeRow = await pool.query(
            'SELECT okr_initiative_id FROM tasks WHERE id = $1',
            [task_id]
          );
          const okr_initiative_id = initiativeRow.rows[0]?.okr_initiative_id;
          if (okr_initiative_id) {
            // 找到该 initiative 所属的 KR
            const krRow = await pool.query(`
              SELECT p.kr_id
              FROM okr_initiatives i
              JOIN okr_scopes s ON s.id = i.scope_id
              JOIN okr_projects p ON p.id = s.project_id
              WHERE i.id = $1
            `, [okr_initiative_id]);
            const kr_id = krRow.rows[0]?.kr_id;
            if (kr_id) {
              // 重算进度（复用 okr-hierarchy 路由逻辑，直接调 DB）
              const statsResult = await pool.query(`
                SELECT
                  COUNT(t.id) FILTER (WHERE t.status = 'completed') AS completed_count,
                  COUNT(t.id) AS total_count
                FROM okr_projects p2
                JOIN okr_scopes s2 ON s2.project_id = p2.id
                JOIN okr_initiatives i2 ON i2.scope_id = s2.id
                LEFT JOIN tasks t ON t.okr_initiative_id = i2.id
                WHERE p2.kr_id = $1
              `, [kr_id]);
              const { completed_count, total_count } = statsResult.rows[0];
              const completedNum = parseInt(completed_count, 10) || 0;
              const totalNum = parseInt(total_count, 10) || 0;
              const targetRow = await pool.query('SELECT target_value FROM key_results WHERE id = $1', [kr_id]);
              const target_value = parseFloat(targetRow.rows[0]?.target_value || 0);
              const newValue = totalNum > 0
                ? Math.round((completedNum / totalNum) * target_value * 100) / 100
                : 0;
              await pool.query(
                `UPDATE key_results SET current_value = $1, updated_at = now() WHERE id = $2 AND ${COMPANY_KR_SQL_GUARD}`,
                [newValue, kr_id]
              );
            }
          }
        } catch (krErr) {
          // KR 进度回写失败不影响主流程
          console.warn('[tasks] KR progress recalc failed:', krErr.message);
        }
      }
    }

    res.json({
      // 被降级时不许再报 success:true —— 请求的状态变更没发生，
      // 报成功就是"写被丢弃却发成功回执"（issue 9cce296f 那一族）。
      // HTTP 仍是 200 且保留 accepted:false：既有调用方按这个契约判（见
      // harness-completion-authority.test.js），改 HTTP 码会连带打翻它们。
      success: !harnessDemoted,
      ...(harnessDemoted ? { accepted: false, reason: harnessDemoteReason } : {}),
      ...(relay ? { relay } : {}),
      ...(handoffFeedback ? { handoff_next_steps: handoffFeedback } : {}),
      ...(harnessUngated ? { ungated_merge: true, failure_reason: harnessUngatedReason } : {}),
      task_id,
      status: updatedTask.status,
      updated_at: updatedTask.updated_at,
      started_at: updatedTask.started_at,
      completed_at: updatedTask.completed_at
    });
  } catch (err) {
    console.error('Failed to update task:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to update task',
      code: 'DATABASE_ERROR',
      details: err.message
    });
  }
}));
}
