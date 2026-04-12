/**
 * Harness Watcher — Brain-内联 CI 监控（Harness v4.0 三层架构）
 *
 * 职责：
 * 1. harness_ci_watch — 轮询 PR CI 状态
 *    - CI 全通过 → executeMerge(prUrl) + 创建 harness_report（CI 即 Evaluator）
 *    - CI 失败 → 更新任务为 failed，创建 harness_fix（含 ci_fail_context）
 *    - CI 进行中 → 保持 queued，下次 tick 继续
 *
 * 注意：harness_ci_watch 不派发给外部 agent，由 Brain tick 内联处理。
 * 设计原则：CI 通过即代表质量验收通过，直接 merge，无需独立 evaluator agent。
 */

import { checkPrStatus, classifyFailedChecks, executeMerge } from './shepherd.js';
import { execSync } from 'child_process';
import { createTask } from './actions.js';

const MAX_CI_WATCH_POLLS = 120;   // 最多轮询次数（每 5s tick → 最多 10 分钟）
const MAX_DEPLOY_WATCH_POLLS = 60; // 最多轮询次数（最多 5 分钟）
const POLL_INTERVAL_MS = 30000;   // GitHub API 节流窗口（30s）
const lastPollTime = new Map();    // 模块级：记录每个 ci_watch 任务上次 API 调用时间

/**
 * 处理所有待处理的 harness_ci_watch 任务
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ processed: number, ci_passed: number, ci_failed: number, ci_pending: number }>}
 */
export async function processHarnessCiWatchers(pool) {
  const result = { processed: 0, ci_passed: 0, ci_failed: 0, ci_pending: 0, errors: 0 };

  let rows;
  try {
    const qr = await pool.query(`
      SELECT id, title, payload, project_id, goal_id, retry_count
      FROM tasks
      WHERE task_type = 'harness_ci_watch'
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 10
    `);
    rows = qr.rows;
  } catch (err) {
    console.error('[harness-watcher] DB query failed (non-fatal):', err.message);
    return result;
  }

  console.log(`[harness-watcher] CI watch: found ${rows.length} queued tasks`);
  if (rows.length === 0) return result;

  for (const task of rows) {
    result.processed++;
    const payload = task.payload || {};
    const prUrl = payload.pr_url;
    const pollCount = payload.poll_count || 0;

    if (!prUrl) {
      console.error(`[harness-watcher] harness_ci_watch ${task.id} has no pr_url, marking failed`);
      await pool.query(
        `UPDATE tasks SET status = 'failed', error_message = 'no pr_url in payload' WHERE id = $1`,
        [task.id]
      );
      result.errors++;
      continue;
    }

    // 超过最大轮询次数 → 超时，链路继续（不中断）
    if (pollCount >= MAX_CI_WATCH_POLLS) {
      console.log(`[harness-watcher] harness_ci_watch ${task.id} timed out after ${pollCount} polls, creating harness_evaluate with ci_timeout=true`);
      await pool.query(
        `UPDATE tasks
         SET status = 'completed',
             completed_at = NOW(),
             payload = COALESCE(payload, '{}'::jsonb) || '{"ci_timeout": true}'::jsonb
         WHERE id = $1`,
        [task.id]
      );
      const evalRound = payload.eval_round || 1;
      await createTask({
        title: `[Evaluator] R${evalRound} (CI Timeout)`,
        description: `CI watch 超时（${pollCount} polls），链路继续，Evaluator 自行验证 PR diff。\nharness_ci_watch task_id: ${task.id}`,
        priority: 'P1',
        project_id: task.project_id,
        goal_id: task.goal_id,
        task_type: 'harness_evaluate',
        trigger_source: 'harness_watcher',
        payload: {
          ci_timeout: true,
          sprint_dir: payload.sprint_dir,
          planner_task_id: payload.planner_task_id,
          planner_branch: payload.planner_branch,
          pr_url: prUrl,
          dev_task_id: payload.dev_task_id,
          eval_round: evalRound,
          harness_mode: true,
        },
      });
      result.ci_passed++;
      continue;
    }

    // 节流：同一任务 30s 内不重复调用 GitHub API
    if (Date.now() - (lastPollTime.get(task.id) || 0) < POLL_INTERVAL_MS) {
      result.ci_pending++;
      continue;
    }
    lastPollTime.set(task.id, Date.now());

    try {
      const prInfo = checkPrStatus(prUrl);

      if (prInfo.ciStatus === 'ci_passed' || prInfo.ciStatus === 'merged') {
        // CI 全通过 → 直接 merge + 创建 harness_report（CI 即 Evaluator，无需独立 evaluate agent）
        await pool.query(
          `UPDATE tasks SET status = 'completed', completed_at = NOW(),
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('ci_conclusion', 'passed', 'poll_count', $2)
           WHERE id = $1`,
          [task.id, pollCount]
        );
        // auto-merge
        if (prUrl && prInfo.ciStatus !== 'merged') {
          try {
            executeMerge(prUrl);
            console.log(`[harness-watcher] CI passed → auto-merge triggered for ${prUrl}`);
          } catch (mergeErr) {
            console.warn(`[harness-watcher] auto-merge failed (non-fatal): ${mergeErr.message}`);
          }
        }
        // 创建 harness_report
        const plannerShort = (payload.planner_task_id || task.id).slice(0, 8);
        await createTask({
          title: `[Report] ${plannerShort}`,
          description: `CI 通过 + PR 已合并。生成 Harness 完成报告。\nharness_ci_watch task_id: ${task.id}`,
          priority: 'P1',
          project_id: task.project_id,
          goal_id: task.goal_id,
          task_type: 'harness_report',
          trigger_source: 'harness_watcher',
          payload: {
            sprint_dir: payload.sprint_dir,
            pr_url: prUrl,
            planner_task_id: payload.planner_task_id,
            contract_branch: payload.contract_branch,
            harness_mode: true,
          },
        });
        console.log(`[harness-watcher] CI passed for ${task.id} → merge + harness_report created`);
        result.ci_passed++;

      } else if (prInfo.ciStatus === 'ci_failed') {
        // CI 失败 → 创建 harness_fix
        const failType = classifyFailedChecks(prInfo.failedChecks);
        const ciContext = `[CI-FAIL] PR ${prUrl} CI 失败，类型: ${failType}，失败 checks: ${prInfo.failedChecks.join(', ')}`;
        await pool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW(),
            payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'ci_conclusion', 'failed', 'ci_fail_type', $2::text, 'poll_count', $3::int
            )
           WHERE id = $1`,
          [task.id, failType, pollCount]
        );
        const evalRound = payload.eval_round || 1;
        await createTask({
          title: `[Fix] CI-R${evalRound} (${failType})`,
          description: `CI 失败（${failType}），Generator 修复后重新提交。\n${ciContext}`,
          priority: 'P1',
          project_id: task.project_id,
          goal_id: task.goal_id,
          task_type: 'harness_fix',
          trigger_source: 'harness_watcher',
          payload: {
            sprint_dir: payload.sprint_dir,
            dev_task_id: payload.dev_task_id,
            planner_task_id: payload.planner_task_id,
            contract_branch: payload.contract_branch,
            eval_round: evalRound,
            ci_fail_context: ciContext,
            ci_fail_type: failType,
            harness_mode: true,
          },
        });
        console.log(`[harness-watcher] CI failed for ${task.id} (${failType}) → harness_fix created`);
        result.ci_failed++;

      } else if (prInfo.ciStatus === 'ci_pending') {
        // CI 还在跑 → 更新 poll_count，保持 queued
        await pool.query(
          `UPDATE tasks
           SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('poll_count', $2, 'last_ci_check', $3)
           WHERE id = $1`,
          [task.id, pollCount + 1, new Date().toISOString()]
        );
        result.ci_pending++;

      } else if (prInfo.state === 'CLOSED') {
        // PR 被关闭 → 停止等待
        await pool.query(
          `UPDATE tasks SET status = 'cancelled', error_message = 'PR closed' WHERE id = $1`,
          [task.id]
        );
        console.log(`[harness-watcher] PR closed for ${task.id}`);
      }
    } catch (err) {
      console.error(`[harness-watcher] CI watch error for ${task.id} (non-fatal): ${err.message}`);
      // 更新 poll_count 并继续
      await pool.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('poll_count', $2, 'last_error', $3)
         WHERE id = $1`,
        [task.id, pollCount + 1, err.message.slice(0, 200)]
      ).catch(() => {});
      result.errors++;
    }
  }

  return result;
}

/**
 * 处理所有待处理的 harness_deploy_watch 任务
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ processed: number, deploy_passed: number, deploy_failed: number, deploy_pending: number }>}
 */
export async function processHarnessDeployWatchers(pool) {
  const result = { processed: 0, deploy_passed: 0, deploy_failed: 0, deploy_pending: 0, errors: 0 };

  let rows;
  try {
    const qr = await pool.query(`
      SELECT id, title, payload, project_id, goal_id
      FROM tasks
      WHERE task_type = 'harness_deploy_watch'
        AND status = 'queued'
      ORDER BY created_at ASC
      LIMIT 5
    `);
    rows = qr.rows;
  } catch (err) {
    console.error('[harness-watcher] Deploy watch DB query failed (non-fatal):', err.message);
    return result;
  }

  if (rows.length === 0) return result;
  console.log(`[harness-watcher] Deploy watch: checking ${rows.length} tasks...`);

  for (const task of rows) {
    result.processed++;
    const payload = task.payload || {};
    const prUrl = payload.pr_url;
    const pollCount = payload.poll_count || 0;

    if (pollCount >= MAX_DEPLOY_WATCH_POLLS) {
      console.warn(`[harness-watcher] harness_deploy_watch ${task.id} timed out, creating report anyway`);
      await pool.query(`UPDATE tasks SET status = 'completed', completed_at = NOW() WHERE id = $1`, [task.id]);
      await _createHarnessReport(task, payload, 'deploy_timeout');
      result.deploy_passed++;
      continue;
    }

    try {
      const deployStatus = _checkDeployStatus();

      if (deployStatus === 'success') {
        await pool.query(
          `UPDATE tasks SET status = 'completed', completed_at = NOW(),
            payload = COALESCE(payload, '{}'::jsonb) || '{"deploy_conclusion": "success"}'::jsonb
           WHERE id = $1`,
          [task.id]
        );
        await _createHarnessReport(task, payload, 'deploy_success');
        console.log(`[harness-watcher] Deploy passed for ${task.id} → harness_report created`);
        result.deploy_passed++;

      } else if (deployStatus === 'failure') {
        await pool.query(
          `UPDATE tasks SET status = 'failed', completed_at = NOW(),
            payload = COALESCE(payload, '{}'::jsonb) || '{"deploy_conclusion": "failed"}'::jsonb
           WHERE id = $1`,
          [task.id]
        );
        // Deploy 失败：创建 report（标注 deploy 失败，不循环修复）
        await _createHarnessReport(task, payload, 'deploy_failed');
        console.warn(`[harness-watcher] Deploy FAILED for ${task.id} → report created with failure note`);
        result.deploy_failed++;

      } else {
        // 进行中
        await pool.query(
          `UPDATE tasks
           SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('poll_count', $2, 'last_deploy_check', $3)
           WHERE id = $1`,
          [task.id, pollCount + 1, new Date().toISOString()]
        );
        result.deploy_pending++;
      }
    } catch (err) {
      console.error(`[harness-watcher] Deploy watch error for ${task.id} (non-fatal): ${err.message}`);
      await pool.query(
        `UPDATE tasks
         SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('poll_count', $2, 'last_error', $3)
         WHERE id = $1`,
        [task.id, pollCount + 1, err.message.slice(0, 200)]
      ).catch(() => {});
      result.errors++;
    }
  }

  return result;
}

/**
 * 检查最近的 deploy 工作流状态
 * @returns {'success' | 'failure' | 'pending'}
 */
function _checkDeployStatus() {
  try {
    const output = execSync(
      `gh run list --workflow "deploy.yml" --branch main --limit 3 --json status,conclusion,createdAt`,
      { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const runs = JSON.parse(output);
    if (!runs || runs.length === 0) return 'pending';

    const latest = runs[0];
    if (latest.status === 'completed') {
      return latest.conclusion === 'success' ? 'success' : 'failure';
    }
    return 'pending';
  } catch (err) {
    // no deploy workflow → 视为成功（无需部署验证）
    const errMsg = err.stderr?.toString() || err.message || '';
    if (errMsg.includes('could not find any workflows') || errMsg.includes('no workflow') || errMsg.includes('not found')) {
      console.log('[harness-watcher] _checkDeployStatus: no deploy workflow found, treating as success');
      return 'success';
    }
    // 真错误（网络/认证/gh CLI 缺失）→ 返回 pending 让调用方重试
    console.error(`[harness-watcher] _checkDeployStatus error (will retry): ${errMsg}`);
    return 'pending';
  }
}

async function _createHarnessReport(task, payload, deployNote) {
  await createTask({
    title: `[Report] Harness 完成报告`,
    description: `Harness v4.0 完成。生成报告：PRD 目标、GAN 对抗轮次、修复清单、CI/Deploy 状态、成本统计。\ndeploy_note: ${deployNote}`,
    priority: 'P1',
    project_id: task.project_id,
    goal_id: task.goal_id,
    task_type: 'harness_report',
    trigger_source: 'harness_watcher',
    payload: {
      sprint_dir: payload.sprint_dir,
      planner_task_id: payload.planner_task_id,
      eval_round: payload.eval_round || 1,
      deploy_note: deployNote,
      harness_mode: true,
    },
  });
}
