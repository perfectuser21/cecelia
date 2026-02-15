/**
 * Auto-Fix Module (P2)
 *
 * 职责：
 * 1. 判断 RCA 结果是否应该自动修复
 * 2. 从 RCA 生成 PRD 文件
 * 3. 派发到 /dev 执行修复
 * 4. 跟踪修复进度并验证结果
 *
 * 原理：
 * - 高信心度 RCA (confidence > 0.7) → 自动派发到 /dev
 * - 生成 PRD 包含：root_cause, proposed_fix, action_plan
 * - 要求 /dev 输出：测试 + 证据（日志/追踪）
 * - 验证：CI + Gate 全绿 + 测试通过
 */

import pool from './db.js';
import { createTask } from './actions.js';

/**
 * Check if RCA result should trigger auto-fix
 *
 * @param {Object} rcaResult - RCA analysis result
 * @param {number} rcaResult.confidence - Confidence score (0-1)
 * @param {string} rcaResult.proposed_fix - Proposed fix
 * @returns {boolean} true if should auto-fix
 */
export function shouldAutoFix(rcaResult) {
  // Only auto-fix if:
  // 1. Confidence > 0.7 (high confidence)
  // 2. Proposed fix is concrete (not "need more info")
  // 3. Not already being fixed (check in_progress dev tasks)

  if (!rcaResult || typeof rcaResult.confidence !== 'number') {
    return false;
  }

  if (rcaResult.confidence < 0.7) {
    console.log(`[AutoFix] Skip: confidence too low (${(rcaResult.confidence * 100).toFixed(0)}%)`);
    return false;
  }

  if (!rcaResult.proposed_fix || rcaResult.proposed_fix.length < 20) {
    console.log('[AutoFix] Skip: proposed_fix too vague');
    return false;
  }

  // Check for "need more info" keywords
  const needMoreInfoKeywords = [
    'need more',
    'need additional',
    'cannot determine',
    'unclear',
    'insufficient evidence',
    'more investigation'
  ];

  const proposedFixLower = rcaResult.proposed_fix.toLowerCase();
  for (const keyword of needMoreInfoKeywords) {
    if (proposedFixLower.includes(keyword)) {
      console.log(`[AutoFix] Skip: fix contains "${keyword}"`);
      return false;
    }
  }

  return true;
}

/**
 * Generate PRD from RCA result
 *
 * @param {Object} failure - Original failure object
 * @param {Object} rcaResult - RCA analysis result
 * @returns {string} PRD content
 */
export function generateFixPrd(failure, rcaResult) {
  const prd = `# PRD: Auto-Fix for ${failure.reason_code || 'System Failure'}

## 来源 / Context

**自动生成**：Cecelia Brain Monitoring Loop 检测到故障，Cortex RCA 分析后自动派发修复任务。

**故障信息**：
- Reason Code: ${failure.reason_code || 'UNKNOWN'}
- Layer: ${failure.layer || 'N/A'}
- Step: ${failure.step_name || 'N/A'}
- Task ID: ${failure.task_id || 'N/A'}
- Run ID: ${failure.run_id || 'N/A'}

## 功能描述 / Goal

**根本原因**：
${rcaResult.root_cause || 'N/A'}

**修复方案**：
${rcaResult.proposed_fix || 'N/A'}

**执行计划**：
${rcaResult.action_plan || 'N/A'}

## 成功标准 / Acceptance Criteria

- [ ] 代码修改完成（根据上述执行计划）
- [ ] 添加测试覆盖相同错误场景
- [ ] 测试通过（证明问题已解决）
- [ ] 添加证据（日志/追踪/截图证明修复有效）
- [ ] CI + DevGate 全绿
- [ ] 更新 LEARNINGS.md 记录修复经验

## 证据要求 / Evidence Required

**必须提供**：
1. 修复前：复现问题的测试用例
2. 修复后：测试通过的证据（日志/截图）
3. 代码变更：修改了哪些文件/函数
4. 验证：CI 通过 + 手动测试结果

## Technical Details

**RCA 信心分数**：${(rcaResult.confidence * 100).toFixed(0)}%

**RCA 证据**：
${rcaResult.evidence || 'N/A'}

## Risks

- 修复可能引入新问题 → 必须有测试覆盖
- 修复可能不完全 → 需要监控后续是否复发
- 修复可能影响其他功能 → CI 必须通过

## 自动派发标记

**此任务由 Cecelia Brain 自动派发**，请确保：
1. 理解 RCA 分析内容
2. 执行计划可行
3. 测试充分
4. 证据完整

如有疑问，查看 rca_cache 表了解完整分析结果。
`;

  return prd;
}

/**
 * Dispatch fix task to /dev skill
 *
 * @param {Object} failure - Original failure object
 * @param {Object} rcaResult - RCA analysis result
 * @param {string} signature - Error signature
 * @returns {Promise<string>} Task ID
 */
export async function dispatchToDevSkill(failure, rcaResult, signature) {
  // Generate PRD
  const prdContent = generateFixPrd(failure, rcaResult);

  // Create task
  const taskData = {
    title: `Auto-Fix: ${failure.reason_code || 'System Failure'} (RCA ${signature})`,
    description: prdContent,
    task_type: 'dev',
    priority: 'P1', // Auto-fixes are high priority but not P0
    status: 'queued',
    skill: '/dev',
    prd_content: prdContent,
    tags: JSON.stringify(['auto-fix', 'rca', signature])
  };

  const taskId = await createTask(taskData);

  console.log(`[AutoFix] Created task ${taskId} for signature=${signature}`);

  // TODO: Dispatch to executor (currently just queued, tick will pick it up)

  return taskId;
}

/**
 * Get auto-fix statistics
 *
 * @returns {Promise<Object>} Stats object
 */
export async function getAutoFixStats() {
  const query = `
    SELECT
      COUNT(*) AS total_auto_fixes,
      COUNT(*) FILTER (WHERE status = 'completed') AS completed_fixes,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_fixes,
      COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress_fixes,
      COUNT(*) FILTER (WHERE status = 'queued') AS queued_fixes
    FROM tasks
    WHERE tags::jsonb ? 'auto-fix'
  `;

  const result = await pool.query(query);
  return result.rows[0];
}
