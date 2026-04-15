/**
 * harness-router.js
 *
 * Harness v4.0+ 路由逻辑（从 routes/execution.js 迁移）。
 *
 * 设计目的：
 *   - callback_queue 架构下 callback-worker 走 processExecutionCallback，
 *     它需要完整触发 harness 的下游路由（Layer 1-4），否则 pipeline 卡死。
 *   - 同一路由逻辑原本只存在于 HTTP /execution-callback 端点里，导致两条
 *     callback 路径的行为不对称。本模块把路由抽取为共享实现，
 *     routes/execution.js 和 callback-processor.js 都引用它。
 *
 * 行为保持：逐行迁移，所有 fallback（pr_url 多层提取、planner_branch git
 * fetch、verdict timeout parse 等）原样保留，不做语义变更。
 */

import { execSync } from 'child_process';
import {
  readVerdictWithRetry,
  persistVerdictTimeout,
  isBridgeSessionCrash,
  handleEvaluateSessionCrash,
} from './execution.js';

// ── 辅助函数（原本是 routes/execution.js 内部闭包） ───────────────────────

// 检查 PR 的 CI 状态：true=全通过 / false=有失败 / null=未知或 pending
async function checkPrCiStatus(prUrl) {
  if (!prUrl) return null;
  try {
    const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
    if (!prNumber) return null;
    const output = execSync(
      `gh pr checks ${prNumber} --json name,state 2>/dev/null || echo "[]"`,
      { encoding: 'utf-8', timeout: 15000 }
    ).trim();
    const checks = JSON.parse(output);
    if (!Array.isArray(checks) || checks.length === 0) return null;
    const failed = checks.some(c => c.state === 'FAILURE' || c.state === 'ERROR');
    const pending = checks.some(c => c.state === 'PENDING');
    if (failed) return false;
    if (pending) return null;
    return true;
  } catch {
    return null;
  }
}

// 从任意格式 result（对象/字符串/嵌套）中提取 verdict 字段
function extractVerdictFromResult(res, validVerdicts) {
  const _check = (v) => {
    if (!v) return null;
    const upper = v.toUpperCase();
    return (!validVerdicts || validVerdicts.includes(upper)) ? upper : null;
  };
  if (res === null || res === undefined) return null;
  if (typeof res === 'object') {
    const dv = res.verdict || (typeof res.result === 'object' ? res.result?.verdict : null);
    const dvChecked = _check(dv);
    if (dvChecked) return dvChecked;
    if (typeof res.result === 'string') {
      try {
        const parsed = JSON.parse(res.result);
        const pv = _check(parsed?.verdict);
        if (pv) return pv;
      } catch { /* not JSON */ }
      const matches = [...res.result.matchAll(/"verdict"\s*:\s*"([^"]+)"/gi)];
      if (matches.length > 0) return _check(matches[matches.length - 1][1]);
    }
  }
  if (typeof res === 'string') {
    try {
      const parsed = JSON.parse(res);
      const pv = _check(parsed?.verdict);
      if (pv) return pv;
    } catch { /* not JSON */ }
    const matches = [...res.matchAll(/"verdict"\s*:\s*"([^"]+)"/gi)];
    if (matches.length > 0) return _check(matches[matches.length - 1][1]);
  }
  return null;
}

// 从 result 中提取指定分支名（propose_branch / review_branch / contract_branch 等）
function extractBranchFromResult(resultVal, branchKey) {
  if (resultVal !== null && typeof resultVal === 'object') {
    const direct = resultVal[branchKey] || resultVal?.result?.[branchKey] || null;
    if (direct) return direct;
    if (typeof resultVal.result === 'string') {
      try { const p = JSON.parse(resultVal.result); if (p?.[branchKey]) return p[branchKey]; } catch {}
      const m = resultVal.result.match(new RegExp(`"${branchKey}"\\s*:\\s*"([^"]+)"`));
      if (m) return m[1];
    }
  }
  if (typeof resultVal === 'string') {
    const m = resultVal.match(new RegExp(`"${branchKey}"\\s*:\\s*"([^"]+)"`));
    if (m) return m[1];
  }
  return null;
}

/**
 * processHarnessRouting — Harness v4.0+ 下游路由入口。
 *
 * @param {object} ctx
 *   - task_id: 当前 harness task id
 *   - harnessType: 'harness_planner' | 'harness_contract_propose' | ...
 *   - harnessPayload: tasks.payload（对象）
 *   - result: callback result（字符串或对象）
 *   - pr_url: callback 携带的 pr_url
 *   - newStatus: 'completed' | 'failed'
 *   - harnessTask: { id, project_id, goal_id, title? }
 *   - pool: pg pool
 *   - createHarnessTask: async (params) => ...（actions.createTask，可含外层 payload 校验）
 * @returns {Promise<{handled: boolean}>}
 */
export async function processHarnessRouting({
  task_id,
  harnessType,
  harnessPayload,
  result,
  pr_url,
  newStatus,
  harnessTask,
  pool,
  createHarnessTask,
}) {
  if (!harnessType || !harnessType.startsWith('harness_')) {
    return { handled: false };
  }

  const plannerShort = (harnessPayload?.planner_task_id || task_id).substring(0, 8);

  // ── 主路由：原本在 if (newStatus === 'completed') 包裹内 ───────────────
  if (newStatus === 'completed') {
    try {
      // Fix 1: 对产生 verdict 的 harness 任务类型，将 verdict 持久化到 tasks.result
      const VERDICT_HARNESS_TYPES = new Set([
        'harness_contract_propose',
        'harness_contract_review',
        'harness_evaluate',
      ]);
      if (VERDICT_HARNESS_TYPES.has(harnessType)) {
        const extractedVerdict = extractVerdictFromResult(result, null);
        if (extractedVerdict) {
          try {
            const resultSummary = (result !== null && typeof result === 'object')
              ? (result.summary || result.findings || null)
              : (typeof result === 'string' ? result.slice(0, 1000) : null);
            await pool.query(
              `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
              [JSON.stringify({ verdict: extractedVerdict, result_summary: resultSummary }), task_id]
            );
            console.log(`[harness-router] verdict=${extractedVerdict} written to tasks.result for ${task_id}`);
          } catch (verdictWriteErr) {
            console.warn(`[harness-router] verdict write to tasks.result failed (non-fatal): ${verdictWriteErr.message}`);
          }
        }
      }

      // 将 harness 任务的 verdict 持久化到 tasks.result
      const persistHarnessVerdict = async (tid, verdictValue, extra = {}) => {
        try {
          const verdictPayload = JSON.stringify({ verdict: verdictValue, verdict_at: new Date().toISOString(), ...extra });
          await pool.query(
            `UPDATE tasks SET result = COALESCE(result, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [verdictPayload, tid]
          );
        } catch (pvErr) {
          console.warn(`[harness-router] persistHarnessVerdict failed (non-fatal): ${pvErr.message}`);
        }
      };

      // Feature 4: 检查 planner 是否已取消，避免已取消链路继续派生子任务
      const plannerTaskId = harnessPayload?.planner_task_id;
      if (plannerTaskId) {
        const plannerRow = await pool.query(
          'SELECT status FROM tasks WHERE id = $1',
          [plannerTaskId]
        );
        if (plannerRow.rows[0]?.status === 'cancelled') {
          console.log(`[harness-router] planner task ${plannerTaskId} is cancelled, skipping chain for ${task_id}`);
          return { handled: true, skipped: true, reason: 'planner_cancelled' };
        }
      }

      // Layer 1: harness_planner 完成 → 创建 contract_propose
      if (harnessType === 'harness_planner') {
        const sprintDir = harnessPayload.sprint_dir || 'sprints';
        let plannerBranch = null;
        if (result !== null && typeof result === 'object') {
          plannerBranch = result.branch || result?.result?.branch || null;
        } else if (typeof result === 'string') {
          const branchMatch = result.match(/"branch"\s*:\s*"([^"]+)"/);
          if (branchMatch) plannerBranch = branchMatch[1];
        }
        // plannerBranch fallback 1: 从 dev_records 查
        if (!plannerBranch) {
          try {
            const devRecRow = await pool.query('SELECT branch FROM dev_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [task_id]);
            if (devRecRow.rows[0]?.branch) {
              plannerBranch = devRecRow.rows[0].branch;
              console.log(`[harness-router] plannerBranch from dev_records: ${plannerBranch}`);
            }
          } catch {}
        }
        // plannerBranch fallback 2: 从 git 分支名匹配
        if (!plannerBranch) {
          try {
            const branches = execSync(
              `git branch -r --list "origin/cp-*" --sort=-committerdate | head -20`,
              { encoding: 'utf-8', timeout: 5000 }
            ).trim().split('\n').map(b => b.trim());
            const plannerIdPrefix = task_id.substring(0, 8);
            let match = branches.find(b => b.includes(plannerIdPrefix));
            if (!match) {
              match = branches.find(b => b.includes('planner-prd') || b.includes('harness-prd'));
            }
            if (match) {
              plannerBranch = match.replace('origin/', '');
              console.log(`[harness-router] plannerBranch fallback found: ${plannerBranch}`);
            }
          } catch (branchErr) {
            console.warn(`[harness-router] plannerBranch fallback failed: ${branchErr.message}`);
          }
        }
        if (!plannerBranch) {
          console.error(`[harness-router] plannerBranch is null for ${harnessType} ${task_id}, Proposer may fail to locate PRD`);
        }
        const proposeType = 'harness_contract_propose';
        // Proposer 去重：同 planner_task_id 已有 queued/in_progress Proposer 时跳过创建
        const existingProposer = await pool.query(
          `SELECT id FROM tasks
           WHERE task_type = $1
             AND payload->>'planner_task_id' = $2
             AND status IN ('queued', 'in_progress')
           LIMIT 1`,
          [proposeType, task_id]
        );
        if (existingProposer.rows.length > 0) {
          console.log(`[harness-router] 已有活跃 Proposer ${existingProposer.rows[0].id}（planner_task_id=${task_id}），跳过创建`);
        } else {
          await createHarnessTask({
            title: `[Contract] P1 — ${plannerShort}`,
            description: `Generator 读取 PRD，提出合同草案（功能范围+验证命令）。\nPRD task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: proposeType,
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: sprintDir,
              planner_task_id: task_id,
              planner_branch: plannerBranch,
              propose_round: 1,
              harness_mode: true
            }
          });
          console.log(`[harness-router] ${harnessType} ${task_id} → ${proposeType} created (planner_branch=${plannerBranch})`);
        }
      }

      // Layer 2a: contract_propose 完成 → contract_review
      if (harnessType === 'harness_contract_propose') {
        const proposeRound = harnessPayload.propose_round || 1;
        let proposeVerdict = extractVerdictFromResult(result, ['PROPOSED']);
        if (!proposeVerdict) {
          const proposeRawText = typeof result === 'string' ? result
            : (result != null && typeof result === 'object'
                ? (typeof result.result === 'string' ? result.result
                  : (result.summary || result.findings || ''))
                : '');
          if (proposeRawText && (/"verdict"\s*:\s*"PROPOSED"/i.test(proposeRawText) || /\bPROPOSED\b/.test(proposeRawText))) {
            proposeVerdict = 'PROPOSED';
          }
        }
        // Fallback：agent 完成但未输出 PROPOSED 关键字 → 假设已提交草案，让 Reviewer 验证
        if (!proposeVerdict) {
          console.warn(`[harness-router] ${harnessType} ${task_id} verdict=null，fallback→PROPOSED（Reviewer 将验证合同质量）`);
          proposeVerdict = 'PROPOSED';
        }
        if (proposeVerdict !== 'PROPOSED') {
          console.log(`[harness-router] ${harnessType} ${task_id} verdict=${proposeVerdict}，非 PROPOSED，不派 Reviewer`);
        } else {
          const reviewType = 'harness_contract_review';
          let proposeBranch = extractBranchFromResult(result, 'propose_branch');
          if (!proposeBranch) {
            try {
              const devRecRow = await pool.query('SELECT branch FROM dev_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [task_id]);
              proposeBranch = devRecRow.rows[0]?.branch || null;
              if (proposeBranch) console.log(`[harness-router] propose_branch from dev_records: ${proposeBranch}`);
            } catch {}
          }
          if (!proposeBranch) {
            try {
              const taskIdShort = task_id.substring(0, 8);
              const branches = execSync(`git branch -r --list "origin/cp-harness-propose-*" --sort=-committerdate | head -5`, { encoding: 'utf-8', timeout: 5000 })
                .trim().split('\n').map(b => b.trim());
              const match = branches.find(b => b.includes(taskIdShort));
              if (match) {
                proposeBranch = match.replace('origin/', '');
                console.log(`[harness-router] propose_branch from git: ${proposeBranch}`);
              }
            } catch {}
          }
          await createHarnessTask({
            title: `[Contract Review] R${proposeRound} — ${plannerShort}`,
            description: `Evaluator 挑战合同草案：验证命令够严格吗？覆盖边界情况吗？\npropose task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: reviewType,
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch,
              propose_task_id: task_id,
              propose_branch: proposeBranch,
              propose_round: proposeRound,
              harness_mode: true
            }
          });
          console.log(`[harness-router] ${harnessType} ${task_id} → ${reviewType} created (propose_branch=${proposeBranch})`);
        }
        // 写入 verdict + propose_branch 到 tasks.result
        if (proposeVerdict) {
          const proposeBranchForResult = extractBranchFromResult(result, 'propose_branch');
          await pool.query(
            'UPDATE tasks SET result = $1 WHERE id = $2',
            [JSON.stringify({ verdict: proposeVerdict, propose_round: proposeRound, propose_branch: proposeBranchForResult }), task_id]
          );
        }
      }

      // Layer 2b: contract_review 完成 → APPROVED/REVISION 路由
      if (harnessType === 'harness_contract_review') {
        let reviewVerdict = 'REVISION';
        if (result !== null && typeof result === 'object' && result.verdict) {
          reviewVerdict = result.verdict.toUpperCase() === 'APPROVED' ? 'APPROVED' : 'REVISION';
        } else {
          const reviewResultRaw = result != null && typeof result === 'object'
            ? (result.decision || result.result || result.summary || result.findings || '')
            : (typeof result === 'string' ? result : '');
          const reviewText = typeof reviewResultRaw === 'string' ? reviewResultRaw : JSON.stringify(reviewResultRaw);
          if (/"verdict"\s*:\s*"APPROVED"/i.test(reviewText) || /\bAPPROVED\b/.test(reviewText)) {
            reviewVerdict = 'APPROVED';
          }
        }
        const reviewBranch = extractBranchFromResult(result, 'review_branch');
        const contractBranch = extractBranchFromResult(result, 'contract_branch');
        console.log(`[harness-router] ${harnessType} verdict=${reviewVerdict} review_branch=${reviewBranch}`);
        await persistHarnessVerdict(task_id, reviewVerdict, { task_type: harnessType });

        if (reviewVerdict === 'APPROVED') {
          const generateType = 'harness_generate';
          let resolvedContractBranch = contractBranch;
          if (!resolvedContractBranch) {
            const taskIdShort = task_id.split('-')[0];
            const fallbackBranchName = `cp-harness-review-approved-${taskIdShort}`;
            try {
              const lsRemoteOutput = execSync(
                `git ls-remote --heads origin ${fallbackBranchName}`,
                { encoding: 'utf-8', timeout: 8000 }
              ).trim();
              if (lsRemoteOutput.includes(fallbackBranchName)) {
                resolvedContractBranch = fallbackBranchName;
                console.warn(`[RECOVERY][harness-router] ${harnessType} contract_branch=null，fallback 成功 → ${fallbackBranchName}。task_id=${task_id}`);
              }
            } catch (lsErr) {
              console.error(`[harness-router] git ls-remote fallback 失败: ${lsErr.message}`);
            }
            if (!resolvedContractBranch) {
              console.error(`[P0][harness-router] ${harnessType} APPROVED 但 contract_branch=null 且 fallback 分支 ${fallbackBranchName} 不存在 — 终止链式触发。task_id=${task_id}`);
              return { handled: true, skipped: true, reason: 'contract_branch_missing' };
            }
          }
          const workstreamCount = (() => {
            const extractWs = (obj) => {
              if (!obj) return null;
              if (obj.workstream_count) return parseInt(obj.workstream_count, 10);
              if (typeof obj.result === 'string') {
                try { const p = JSON.parse(obj.result); if (p.workstream_count) return parseInt(p.workstream_count, 10); } catch {}
                const m = obj.result.match(/"workstream_count"\s*:\s*(\d+)/);
                if (m) return parseInt(m[1], 10);
              }
              return null;
            };
            if (result != null && typeof result === 'object') { const v = extractWs(result); if (v) return v; }
            if (typeof result === 'string') {
              try { const p = JSON.parse(result); if (p.workstream_count) return parseInt(p.workstream_count, 10); } catch {}
              const m = result.match(/"workstream_count"\s*:\s*(\d+)/);
              if (m) return parseInt(m[1], 10);
            }
            return 1;
          })();
          const safeWsCount = Math.max(1, Math.min(workstreamCount, 6));
          await createHarnessTask({
            title: `[Generator] G1/${safeWsCount} — ${plannerShort}`,
            description: `合同已批准，Generator 按 Workstream 1/${safeWsCount} 写代码 + 创建 PR（串行首个）。\ncontract_review task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: generateType,
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch,
              contract_branch: resolvedContractBranch,
              workstream_index: 1,
              workstream_count: safeWsCount,
              harness_mode: true
            }
          });
          console.log(`[harness-router] ${harnessType} APPROVED → ${generateType} W1/${safeWsCount} created（串行，后续由完成回调链式触发）`);
        } else {
          const nextRound = (harnessPayload.propose_round || 1) + 1;
          const proposeType = 'harness_contract_propose';
          await createHarnessTask({
            title: `[Contract] P${nextRound} — ${plannerShort}`,
            description: `Generator 根据 Evaluator 反馈修改合同草案（第${nextRound}轮）。\nreview task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: proposeType,
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch,
              propose_round: nextRound,
              review_feedback_task_id: task_id,
              review_branch: reviewBranch,
              harness_mode: true
            }
          });
          console.log(`[harness-router] ${harnessType} REVISION → ${proposeType} R${nextRound} (review_branch=${reviewBranch})`);
        }
        // 写入 verdict + review_branch 到 tasks.result
        await pool.query(
          'UPDATE tasks SET result = $1 WHERE id = $2',
          [JSON.stringify({ verdict: reviewVerdict, review_branch: reviewBranch, contract_branch: contractBranch || null }), task_id]
        );
      }

      // Layer 3a: harness_generate 完成 → harness_evaluate（经 CI 检查）
      if (harnessType === 'harness_generate') {
        let prUrl = pr_url || null;
        if (!prUrl) {
          try {
            const dbPrRow = await pool.query('SELECT pr_url FROM tasks WHERE id=$1', [task_id]);
            prUrl = dbPrRow.rows[0]?.pr_url || null;
          } catch {}
        }
        if (!prUrl && result !== null && typeof result === 'object') {
          prUrl = result.pr_url || result?.result?.pr_url || null;
          if (!prUrl && typeof result.result === 'string') {
            try {
              const parsed = JSON.parse(result.result.trim());
              prUrl = parsed.pr_url || null;
            } catch {}
            if (!prUrl) {
              const m = result.result.match(/https:\/\/github\.com\/[^\s"']+\/pull\/\d+/);
              if (m) prUrl = m[0];
            }
            if (!prUrl) {
              const prNumMatch = result.result.match(/PR\s+#(\d+)/i) || result.result.match(/pull\/(\d+)/);
              if (prNumMatch) {
                try {
                  const repoUrl = execSync('git remote get-url origin', { encoding: 'utf-8', timeout: 5000 }).trim()
                    .replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
                  prUrl = `${repoUrl}/pull/${prNumMatch[1]}`;
                } catch {}
              }
            }
          }
        }
        if (!prUrl && typeof result === 'string') {
          const prMatch = result.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
          if (prMatch) prUrl = prMatch[0];
        }
        if (!prUrl) {
          try {
            const devRecRow = await pool.query('SELECT pr_url, branch FROM dev_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [task_id]);
            prUrl = devRecRow.rows[0]?.pr_url || null;
            if (!prUrl && devRecRow.rows[0]?.branch) {
              try {
                const ghOut = execSync(`gh pr list --head "${devRecRow.rows[0].branch}" --json url --limit 1`, { encoding: 'utf-8', timeout: 10000 }).trim();
                const ghPrs = JSON.parse(ghOut);
                if (ghPrs.length > 0) prUrl = ghPrs[0].url;
              } catch {}
            }
            if (prUrl) console.log(`[harness-router] pr_url recovered from dev_records/gh: ${prUrl}`);
          } catch {}
        }
        if (!prUrl) {
          try {
            const taskIdShort = task_id.substring(0, 8);
            const branches = execSync(`git branch -r --list "origin/cp-*" --sort=-committerdate | head -20`, { encoding: 'utf-8', timeout: 5000 })
              .trim().split('\n').map(b => b.trim().replace('origin/', ''));
            const matchBranch = branches.find(b => b.includes(taskIdShort));
            if (matchBranch) {
              const ghOut = execSync(`gh pr list --head "${matchBranch}" --json url --limit 1`, { encoding: 'utf-8', timeout: 10000 }).trim();
              const ghPrs = JSON.parse(ghOut);
              if (ghPrs.length > 0) {
                prUrl = ghPrs[0].url;
                console.log(`[harness-router] pr_url recovered from git branch ${matchBranch}: ${prUrl}`);
              }
            }
          } catch {}
        }
        if (!prUrl) {
          console.error(`[harness-router] harness_generate ${task_id} pr_url 缺失，创建 harness_fix 重试`);
          await createHarnessTask({
            title: `[Fix] Generator 结果丢失 — ${plannerShort}`,
            description: `Generator 完成但 pr_url 缺失（session 崩溃或输出解析失败），重新生成 PR。\n原始 harness_generate task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'harness_fix',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              dev_task_id: task_id,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch || null,
              contract_branch: harnessPayload.contract_branch || null,
              eval_round: 1,
              ci_fail_context: `[PR_URL_MISSING] harness_generate ${task_id} 完成但 pr_url 丢失，需重新创建 PR`,
              ci_fail_type: 'pr_url_missing',
              harness_mode: true,
            },
          });
          console.log(`[harness-router] harness_generate ${task_id} pr_url 缺失 → harness_fix 已创建`);
          return { handled: true, skipped: true, reason: 'pr_url_missing' };
        }
        // 串行 Workstream 链式触发
        const currentWsIdx = harnessPayload.workstream_index || 1;
        const totalWsCount = harnessPayload.workstream_count || 1;
        if (currentWsIdx < totalWsCount) {
          const nextWsIdx = currentWsIdx + 1;
          const existingWs = await pool.query(
            `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'harness_generate'
             AND payload->>'workstream_index' = $2 AND status IN ('queued','in_progress') LIMIT 1`,
            [harnessTask.project_id, String(nextWsIdx)]
          );
          if (existingWs.rows.length > 0) {
            console.log(`[harness-router] WS${nextWsIdx} already queued, skip creation`);
          } else {
            await createHarnessTask({
              title: `[Generator] G${nextWsIdx}/${totalWsCount} — ${plannerShort}`,
              description: `合同已批准，Generator 按 Workstream ${nextWsIdx}/${totalWsCount} 写代码 + 创建 PR（串行，WS${currentWsIdx} 已完成）。\ncontract_branch: ${harnessPayload.contract_branch}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              task_type: 'harness_generate',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch,
                contract_branch: harnessPayload.contract_branch,
                workstream_index: nextWsIdx,
                workstream_count: totalWsCount,
                harness_mode: true
              }
            });
            console.log(`[harness-router] WS${currentWsIdx}/${totalWsCount} 完成 → 串行触发 WS${nextWsIdx}/${totalWsCount}`);
          }
        }

        if (currentWsIdx === totalWsCount) {
          let ciCheckFailed = false;
          if (prUrl) {
            const ciPassed = await checkPrCiStatus(prUrl);
            if (ciPassed === false) {
              ciCheckFailed = true;
              console.log(`[harness-router] harness_generate ${task_id} CI failed → harness_fix`);
              await createHarnessTask({
                title: `[Fix] CI 失败 — ${plannerShort}`,
                description: `Generator PR CI 失败，自动修复。\npr_url: ${prUrl}`,
                priority: 'P1',
                project_id: harnessTask.project_id,
                goal_id: harnessTask.goal_id,
                task_type: 'harness_fix',
                trigger_source: 'execution_callback_harness',
                payload: {
                  sprint_dir: harnessPayload.sprint_dir,
                  dev_task_id: task_id,
                  planner_task_id: harnessPayload.planner_task_id,
                  planner_branch: harnessPayload.planner_branch || null,
                  contract_branch: harnessPayload.contract_branch || null,
                  pr_url: prUrl,
                  eval_round: 1,
                  ci_fail_type: 'ci_failed_after_generate',
                  harness_mode: true,
                },
              });
            }
          }
          if (!ciCheckFailed) {
            await createHarnessTask({
              title: `[Evaluator] E1 — ${plannerShort}`,
              description: `E2E 功能验收：部署服务 + API 验证 + 前端验证。\npr_url: ${prUrl}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              goal_id: harnessTask.goal_id,
              task_type: 'harness_evaluate',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                pr_url: prUrl,
                dev_task_id: task_id,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch || null,
                contract_branch: harnessPayload.contract_branch,
                project_id: harnessTask.project_id,
                eval_round: 1,
                harness_mode: true
              }
            });
            console.log(`[harness-router] harness_generate WS${currentWsIdx}/${totalWsCount}（最后） → harness_evaluate created (pr_url=${prUrl})`);
          }
        } else {
          console.log(`[harness-router] harness_generate WS${currentWsIdx}/${totalWsCount} 完成，等待后续 WS，暂不创建 report`);
        }
      }

      // Layer 3c: harness_fix 完成 → harness_evaluate（经 CI 检查）
      if (harnessType === 'harness_fix') {
        let prUrl = harnessPayload.pr_url || pr_url || null;
        if (!prUrl && result !== null && typeof result === 'object') {
          prUrl = result.pr_url || result?.result?.pr_url || null;
        }
        if (!prUrl && typeof result === 'string') {
          const prMatch = result.match(/https:\/\/github\.com\/[^\s"]+\/pull\/\d+/);
          if (prMatch) prUrl = prMatch[0];
        }
        if (!prUrl) {
          try {
            const devRecRow = await pool.query('SELECT pr_url, branch FROM dev_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [task_id]);
            prUrl = devRecRow.rows[0]?.pr_url || null;
            if (!prUrl && devRecRow.rows[0]?.branch) {
              try {
                const ghOut = execSync(`gh pr list --head "${devRecRow.rows[0].branch}" --json url --limit 1`, { encoding: 'utf-8', timeout: 10000 }).trim();
                const ghPrs = JSON.parse(ghOut);
                if (ghPrs.length > 0) prUrl = ghPrs[0].url;
              } catch {}
            }
            if (prUrl) console.log(`[harness-router] harness_fix: pr_url recovered from dev_records/gh: ${prUrl}`);
          } catch {}
        }
        const evalRound = harnessPayload.eval_round || 1;
        let fixCiCheckFailed = false;
        if (prUrl) {
          const ciPassed = await checkPrCiStatus(prUrl);
          if (ciPassed === false && evalRound < 5) {
            fixCiCheckFailed = true;
            console.log(`[harness-router] harness_fix ${task_id} CI still failing → harness_fix retry (eval_round=${evalRound + 1})`);
            await createHarnessTask({
              title: `[Fix] CI 失败 R${evalRound + 1} — ${plannerShort}`,
              description: `Fix 后 CI 仍然失败，继续修复。\npr_url: ${prUrl}`,
              priority: 'P1',
              project_id: harnessTask.project_id,
              goal_id: harnessTask.goal_id,
              task_type: 'harness_fix',
              trigger_source: 'execution_callback_harness',
              payload: {
                sprint_dir: harnessPayload.sprint_dir,
                dev_task_id: harnessPayload.dev_task_id || task_id,
                planner_task_id: harnessPayload.planner_task_id,
                planner_branch: harnessPayload.planner_branch || null,
                contract_branch: harnessPayload.contract_branch || null,
                pr_url: prUrl,
                eval_round: evalRound + 1,
                ci_fail_type: 'ci_failed_after_fix',
                harness_mode: true,
              },
            });
          }
        }
        if (!fixCiCheckFailed) {
          await createHarnessTask({
            title: `[Evaluator] E${evalRound + 1} — ${plannerShort}`,
            description: `Fix 后 E2E 重新验收。\npr_url: ${prUrl}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'harness_evaluate',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              pr_url: prUrl,
              dev_task_id: harnessPayload.dev_task_id || task_id,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch || null,
              contract_branch: harnessPayload.contract_branch,
              eval_round: evalRound + 1,
              harness_mode: true
            }
          });
          console.log(`[harness-router] harness_fix ${task_id} → harness_evaluate created (eval_round=${evalRound + 1}, pr_url=${prUrl})`);
        }
      }

      // Layer 3d: harness_evaluate 完成 → PASS→merge+deploy+report / FAIL→fix
      if (harnessType === 'harness_evaluate') {
        const evalRound = harnessPayload.eval_round || 1;
        let prUrl = harnessPayload.pr_url || pr_url || null;
        if (!prUrl && result !== null && typeof result === 'object') {
          prUrl = result.pr_url || null;
        }
        if (!prUrl && harnessPayload.dev_task_id) {
          try {
            const devRecRow = await pool.query('SELECT pr_url, branch FROM dev_records WHERE task_id=$1 ORDER BY created_at DESC LIMIT 1', [harnessPayload.dev_task_id]);
            prUrl = devRecRow.rows[0]?.pr_url || null;
            if (!prUrl && devRecRow.rows[0]?.branch) {
              try {
                const ghOut = execSync(`gh pr list --head "${devRecRow.rows[0].branch}" --json url --limit 1`, { encoding: 'utf-8', timeout: 10000 }).trim();
                const ghPrs = JSON.parse(ghOut);
                if (ghPrs.length > 0) prUrl = ghPrs[0].url;
              } catch {}
            }
            if (prUrl) console.log(`[harness-router] harness_evaluate: pr_url recovered: ${prUrl}`);
          } catch {}
        }

        // Bridge 崩溃检测
        if (isBridgeSessionCrash(result)) {
          const crashResult = await handleEvaluateSessionCrash({
            pool,
            taskId: task_id,
            plannerShort,
            harnessTask,
            harnessPayload,
            createHarnessTask,
          });
          console.log(`[harness-router] harness_evaluate: session crash handled, action=${crashResult.action}`);
          return { handled: true, skipped: true, reason: 'bridge_session_crash' };
        }

        // 提取 verdict: 带重试的 DB 读取
        let evalVerdict = null;
        const { verdict: retryVerdict, timedOut } = await readVerdictWithRetry(pool, task_id);
        if (timedOut) {
          try {
            const cbRow = await pool.query(
              `SELECT result_json FROM callback_queue WHERE task_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [task_id]
            );
            const reportText = cbRow.rows[0]?.result_json?.result;
            if (typeof reportText === 'string') {
              const verdictMatch = reportText.match(/(?:裁决|verdict)[\s:：]*\**[:：]?\s*\**([A-Z]+)/i);
              const parsedVerdict = verdictMatch?.[1]?.toUpperCase();
              if (parsedVerdict === 'PASS') {
                evalVerdict = 'PASS';
                console.log(`[harness-router] harness_evaluate: timeout fallback parsed PASS from report`);
              } else if (parsedVerdict === 'FAIL' || parsedVerdict === 'PARTIAL') {
                evalVerdict = 'FAIL';
                console.log(`[harness-router] harness_evaluate: timeout fallback parsed ${parsedVerdict} → FAIL from report`);
              }
            }
          } catch (err) {
            console.warn(`[harness-router] timeout fallback parse failed: ${err.message}`);
          }

          if (!evalVerdict) {
            await persistVerdictTimeout(pool, task_id);
            console.warn(`[harness-router] harness_evaluate: verdict_timeout for ${task_id} — pipeline paused, no auto-fix`);
            return { handled: true, skipped: true, reason: 'verdict_timeout' };
          }
        }
        if (retryVerdict) {
          evalVerdict = retryVerdict;
          console.log(`[harness-router] harness_evaluate: verdict from DB retry: ${evalVerdict}`);
        }
        if (!evalVerdict) {
          if (result !== null && typeof result === 'object') {
            if (result.verdict?.toUpperCase() === 'PASS') evalVerdict = 'PASS';
          }
          if (typeof result === 'string') {
            if (/"verdict"\s*:\s*"PASS"/i.test(result)) evalVerdict = 'PASS';
          }
          if (!evalVerdict) evalVerdict = 'FAIL';
        }

        console.log(`[harness-router] harness_evaluate ${task_id} verdict=${evalVerdict} eval_round=${evalRound}`);

        if (evalVerdict === 'PASS') {
          // Step 1: Merge PR
          if (prUrl) {
            try {
              execSync(`gh pr merge "${prUrl}" --squash --delete-branch`, { encoding: 'utf-8', timeout: 30000 });
              console.log(`[harness-router] Evaluator PASS → PR merged: ${prUrl}`);
            } catch (mergeErr) {
              console.warn(`[harness-router] PR merge failed, attempting rebase: ${mergeErr.message}`);
              try {
                const prBranch = execSync(`gh pr view "${prUrl}" --json headRefName -q '.headRefName'`, { encoding: 'utf-8', timeout: 10000 }).trim();
                execSync(`git fetch origin && git checkout ${prBranch} && git rebase origin/main && git push -f origin ${prBranch}`, { encoding: 'utf-8', timeout: 30000 });
                execSync(`gh pr merge "${prUrl}" --squash --delete-branch`, { encoding: 'utf-8', timeout: 30000 });
                console.log(`[harness-router] PR rebased and merged: ${prUrl}`);
              } catch (rebaseErr) {
                console.error(`[harness-router] PR rebase+merge failed: ${rebaseErr.message}`);
                await createHarnessTask({
                  title: `[Fix] Merge 冲突 — ${plannerShort}`,
                  task_type: 'harness_fix',
                  trigger_source: 'execution_callback_harness',
                  payload: {
                    ...harnessPayload,
                    ci_fail_context: 'merge_conflict_after_evaluator_pass',
                    eval_round: evalRound,
                  },
                });
                console.log(`[harness-router] merge conflict → harness_fix created`);
                return { handled: true, skipped: true, reason: 'merge_conflict' };
              }
            }
          }

          // Step 2: Deploy
          try {
            execSync('bash scripts/post-merge-deploy.sh', {
              cwd: execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim(),
              encoding: 'utf-8',
              timeout: 120000
            });
            console.log(`[harness-router] post-merge deploy completed`);
          } catch (deployErr) {
            console.warn(`[harness-router] deploy warning (non-fatal): ${deployErr.message}`);
          }

          // Step 3: Smoke test
          try {
            const healthResp = execSync('curl -sf http://localhost:5221/api/brain/health', { encoding: 'utf-8', timeout: 10000 });
            const health = JSON.parse(healthResp);
            if (health.status !== 'healthy') {
              console.warn(`[harness-router] smoke test warning: Brain status=${health.status}`);
            } else {
              console.log(`[harness-router] smoke test PASS — Brain healthy`);
            }
          } catch (smokeErr) {
            console.warn(`[harness-router] smoke test failed (non-fatal): ${smokeErr.message}`);
          }

          // Step 4: 创建 Report
          await createHarnessTask({
            title: `[Report] ${plannerShort}`,
            description: `Evaluator PASS → merged → deployed → 生成报告。\npr_url: ${prUrl}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'harness_report',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              pr_url: prUrl,
              dev_task_id: harnessPayload.dev_task_id,
              planner_task_id: harnessPayload.planner_task_id,
              contract_branch: harnessPayload.contract_branch,
              project_id: harnessTask.project_id,
              eval_round: evalRound,
              harness_mode: true
            }
          });
          console.log(`[harness-router] Evaluator PASS → merged → deployed → harness_report created`);
        } else {
          // FAIL → 无上限一直 Fix 直到 PASS
          const failedFeatures = result?.failed_features || [];
          await createHarnessTask({
            title: `[Fix] Evaluator-R${evalRound} — ${plannerShort}`,
            description: `Evaluator FAIL (round ${evalRound})，需要修复。\n失败项: ${failedFeatures.join(', ') || '见 eval-round.md'}\npr_url: ${prUrl}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'harness_fix',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              dev_task_id: harnessPayload.dev_task_id,
              planner_task_id: harnessPayload.planner_task_id,
              planner_branch: harnessPayload.planner_branch || null,
              contract_branch: harnessPayload.contract_branch || null,
              pr_url: prUrl,
              eval_round: evalRound,
              ci_fail_context: `evaluator_verdict_fail_round_${evalRound}`,
              failed_features: failedFeatures,
              harness_mode: true,
            },
          });
          console.log(`[harness-router] harness_evaluate FAIL → harness_fix created (eval_round=${evalRound})`);
        }
      }

      // harness_report 失败自动重试（result=null 表示 session 崩溃）
      if (harnessType === 'harness_report') {
        if (result === null) {
          const retry_count = harnessPayload.retry_count || 0;
          if (retry_count >= 3) {
            console.error(`[harness-router] harness_report ${task_id} 崩溃次数已达上限（retry_count=${retry_count} >= 3），标记 pipeline 失败，停止重试`);
            return { handled: true, skipped: true, reason: 'report_retry_exhausted' };
          }
          await createHarnessTask({
            title: `[Report] Retry-${retry_count + 1} — ${plannerShort}`,
            description: `harness_report 会话崩溃（result=null），自动重试 #${retry_count + 1}。\n原始 harness_report task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            task_type: 'harness_report',
            trigger_source: 'execution_callback_harness',
            payload: {
              sprint_dir: harnessPayload.sprint_dir,
              pr_url: harnessPayload.pr_url,
              dev_task_id: harnessPayload.dev_task_id,
              planner_task_id: harnessPayload.planner_task_id,
              retry_count: retry_count + 1,
              harness_mode: true
            }
          });
          console.log(`[harness-router] harness_report ${task_id} → 重试任务已创建 (retry_count=${retry_count + 1})`);
        }
      }
    } catch (harnessErr) {
      console.error(`[harness-router] harness loop error (non-fatal): ${harnessErr.message}`, harnessErr.stack);
    }
  }

  // ── harness_report_failed_retry: AI Failed 时也重试 ─────────────────────
  // 原逻辑位于 routes/execution.js 2564-2599（外层 completed gate 内，属于死代码；
  // 迁移到此处后独立 gate 到 newStatus==='failed'，callback-processor 会以 failed
  // 路径调用本函数，该分支才真正生效）。
  if (newStatus === 'failed') {
    try {
      if (harnessType === 'harness_report') {
        const failedPayload = harnessPayload || {};
        const retryCount = failedPayload.retry_count || 0;
        if (retryCount < 3) {
          await createHarnessTask({
            title: `[Report] FailRetry-${retryCount + 1} — ${(failedPayload.planner_task_id || task_id).substring(0, 8)}`,
            description: `harness_report AI Failed（非 crash），自动重试 #${retryCount + 1}。\n原始 task_id: ${task_id}`,
            priority: 'P1',
            project_id: harnessTask.project_id,
            goal_id: harnessTask.goal_id,
            task_type: 'harness_report',
            trigger_source: 'execution_callback_harness',
            payload: {
              ...failedPayload,
              retry_count: retryCount + 1,
              harness_mode: true
            }
          });
          console.log(`[harness-router] harness_report_failed_retry: task ${task_id} → retry #${retryCount + 1} created`);
        } else {
          console.error(`[harness-router] harness_report_failed_retry: task ${task_id} retry exhausted (${retryCount} >= 3)`);
        }
      }
    } catch (failRetryErr) {
      console.error(`[harness-router] harness_report_failed_retry error: ${failRetryErr.message}`);
    }
  }

  return { handled: true };
}
