/**
 * Harness v3.1 Sprint 循环断链测试
 *
 * 覆盖 9 个链路转接点：
 * 1. sprint_planner DONE → sprint_contract_propose P1
 * 2. sprint_contract_propose PROPOSED → sprint_contract_review R1
 * 3. sprint_contract_review APPROVED → sprint_generate
 * 4. sprint_contract_review REVISION → sprint_contract_propose P2（无上限，对抗直到 APPROVED）
 * 5. sprint_generate DONE → sprint_evaluate R1
 * 6. sprint_evaluate PASS → sprint_report
 * 7. sprint_evaluate FAIL → sprint_fix R2
 * 8. sprint_fix DONE → sprint_evaluate（eval_round 递增）
 * 9. sprint_evaluate result=null → 不创建后续任务（AI Failed 处理）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock pool
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// mock actions.createTask
const mockCreateTask = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'new-task-id' }));
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));


/**
 * 模拟 Harness v3.1 断链核心逻辑（对照 execution.js）
 */
async function simulateHarnessCallback(taskData, result) {
  const { createTask } = await import('../actions.js');
  const pool = (await import('../db.js')).default;

  const harnessPayload = taskData.payload || {};

  // Layer 1: sprint_planner DONE → sprint_contract_propose P1
  if (taskData.task_type === 'sprint_planner') {
    await createTask({
      title: '[Contract] P1',
      description: 'Generator 提出合同草案（第1轮）',
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_contract_propose',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        planner_task_id: taskData.id,
        propose_round: 1,
        harness_mode: true
      }
    });
    return;
  }

  // Layer 2a: sprint_contract_propose PROPOSED → sprint_contract_review
  // GAN 守卫：只有 verdict=PROPOSED 才派 Reviewer
  // 对齐生产代码 execution.js 的 extractVerdictFromResult + 纯文本 fallback
  if (taskData.task_type === 'sprint_contract_propose') {
    const proposeRound = harnessPayload.propose_round || 1;
    // 结构化提取
    let proposeVerdict = null;
    if (result !== null && typeof result === 'object') {
      const dv = result.verdict || result?.result?.verdict;
      if (dv && dv.toUpperCase() === 'PROPOSED') proposeVerdict = 'PROPOSED';
    }
    // 纯文本 fallback（cecelia-run 可能传纯文本字符串）
    if (!proposeVerdict) {
      const rawText = typeof result === 'string' ? result
        : (result != null && typeof result === 'object'
            ? (typeof result.result === 'string' ? result.result
              : (result.summary || result.findings || ''))
            : '');
      if (rawText && (/"verdict"\s*:\s*"PROPOSED"/i.test(rawText) || /\bPROPOSED\b/.test(rawText))) {
        proposeVerdict = 'PROPOSED';
      }
    }
    if (proposeVerdict !== 'PROPOSED') {
      return;
    }
    await createTask({
      title: `[Contract Review] R${proposeRound}`,
      description: `Evaluator 挑战合同草案（第${proposeRound}轮）`,
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_contract_review',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        planner_task_id: harnessPayload.planner_task_id,
        propose_round: proposeRound,
        propose_task_id: taskData.id,
        harness_mode: true
      }
    });
    return;
  }

  // Layer 2b: sprint_contract_review APPROVED/REVISION 路由
  // 对齐生产代码：结构化提取 + 纯文本 fallback
  if (taskData.task_type === 'sprint_contract_review') {
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

    if (reviewVerdict === 'APPROVED') {
      await createTask({
        title: '[Generator] 写代码',
        description: '合同已批准，Generator 按 sprint-contract.md 写代码。',
        priority: 'P1',
        project_id: taskData.project_id,
        goal_id: taskData.goal_id,
        task_type: 'sprint_generate',
        trigger_source: 'execution_callback_harness',
        payload: {
          sprint_dir: harnessPayload.sprint_dir,
          planner_task_id: harnessPayload.planner_task_id,
          harness_mode: true
        }
      });
    } else {
      // REVISION：继续对抗，无轮次上限
      const nextRound = (harnessPayload.propose_round || 1) + 1;
      await createTask({
        title: `[Contract] P${nextRound}`,
        description: `Generator 根据 Evaluator 反馈修改合同草案（第${nextRound}轮）。`,
        priority: 'P1',
        project_id: taskData.project_id,
        goal_id: taskData.goal_id,
        task_type: 'sprint_contract_propose',
        trigger_source: 'execution_callback_harness',
        payload: {
          sprint_dir: harnessPayload.sprint_dir,
          planner_task_id: harnessPayload.planner_task_id,
          propose_round: nextRound,
          review_feedback_task_id: taskData.id,
          harness_mode: true
        }
      });
    }
    return;
  }

  // Layer 3a: sprint_generate DONE → sprint_evaluate R1
  if (taskData.task_type === 'sprint_generate') {
    await createTask({
      title: '[Evaluator] R1',
      description: 'Evaluator 执行 sprint-contract.md 里的验证命令',
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_evaluate',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        dev_task_id: harnessPayload.dev_task_id,
        eval_round: 1,
        harness_mode: true
      }
    });
    return;
  }

  // Layer 3b: sprint_evaluate PASS/FAIL 路由
  if (taskData.task_type === 'sprint_evaluate') {
    // AI Failed 处理：result 为 null 不创建后续任务
    if (result === null) {
      return;
    }

    const resultObj = typeof result === 'object' && result !== null ? result : {};
    const verdict = resultObj.verdict || 'FAIL';

    if (verdict === 'PASS') {
      // PASS → sprint_report
      const existing = await pool.query(
        `SELECT id FROM tasks WHERE project_id = $1 AND task_type = 'sprint_report' LIMIT 1`,
        [taskData.project_id]
      );
      if (existing.rows.length === 0) {
        await createTask({
          title: '[Report] Sprint 报告',
          description: 'Harness 完成，生成最终报告。',
          priority: 'P1',
          project_id: taskData.project_id,
          goal_id: taskData.goal_id,
          task_type: 'sprint_report',
          trigger_source: 'execution_callback_harness',
          payload: {
            sprint_dir: harnessPayload.sprint_dir,
            harness_mode: true
          }
        });
      }
    } else {
      // FAIL → sprint_fix（eval_round 递增）
      const nextEvalRound = (harnessPayload.eval_round || 1) + 1;
      await createTask({
        title: `[Fix] Sprint 修复 R${nextEvalRound}`,
        description: 'Evaluator 发现问题，Generator 修复。',
        priority: 'P1',
        project_id: taskData.project_id,
        goal_id: taskData.goal_id,
        task_type: 'sprint_fix',
        trigger_source: 'execution_callback_harness',
        payload: {
          sprint_dir: harnessPayload.sprint_dir,
          dev_task_id: harnessPayload.dev_task_id,
          eval_round: nextEvalRound,
          harness_mode: true
        }
      });
    }
    return;
  }

  // Layer 3c: sprint_fix DONE → sprint_evaluate（eval_round 递增）
  if (taskData.task_type === 'sprint_fix') {
    const evalRound = harnessPayload.eval_round || 1;
    await createTask({
      title: `[Evaluator] 重测 R${evalRound}`,
      description: 'sprint_fix 完成，重新评估。',
      priority: 'P1',
      project_id: taskData.project_id,
      goal_id: taskData.goal_id,
      task_type: 'sprint_evaluate',
      trigger_source: 'execution_callback_harness',
      payload: {
        sprint_dir: harnessPayload.sprint_dir,
        dev_task_id: harnessPayload.dev_task_id,
        eval_round: evalRound,
        harness_mode: true
      }
    });
  }
}

describe('Harness v3.1 Sprint Loop — 13 个链路转接点', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. sprint_planner DONE → sprint_contract_propose P1
  it('1. sprint_planner DONE → 创建 sprint_contract_propose P1', async () => {
    const task = {
      id: 'planner-1',
      task_type: 'sprint_planner',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', harness_mode: true }
    };

    await simulateHarnessCallback(task, { prd_path: 'sprints/sprint-prd.md' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_contract_propose');
    expect(call.priority).toBe('P1');
    expect(call.payload.propose_round).toBe(1);
    expect(call.payload.planner_task_id).toBe('planner-1');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 2. sprint_contract_propose PROPOSED → sprint_contract_review R1
  it('2. sprint_contract_propose PROPOSED → 创建 sprint_contract_review R1', async () => {
    const task = {
      id: 'propose-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'PROPOSED', contract_draft_path: 'sprints/contract-draft.md' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_contract_review');
    expect(call.payload.propose_round).toBe(1);
    expect(call.payload.propose_task_id).toBe('propose-1');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 3. sprint_contract_review APPROVED → sprint_generate
  it('3. sprint_contract_review APPROVED → 创建 sprint_generate', async () => {
    const task = {
      id: 'review-1',
      task_type: 'sprint_contract_review',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'APPROVED', contract_path: 'sprints/sprint-contract.md' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_generate');
    expect(call.payload.sprint_dir).toBe('sprints');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 4. sprint_contract_review REVISION → sprint_contract_propose P2（propose_round++）
  it('4. sprint_contract_review REVISION → 创建 sprint_contract_propose P2（propose_round++）', async () => {
    const task = {
      id: 'review-1',
      task_type: 'sprint_contract_review',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'REVISION', issues_count: 2 });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_contract_propose');
    expect(call.payload.propose_round).toBe(2);
    expect(call.payload.review_feedback_task_id).toBe('review-1');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 5. sprint_generate DONE → sprint_evaluate R1
  it('6. sprint_generate DONE → 创建 sprint_evaluate R1', async () => {
    const task = {
      id: 'gen-1',
      task_type: 'sprint_generate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', dev_task_id: 'dev-1', harness_mode: true }
    };

    await simulateHarnessCallback(task, { summary: 'done' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_evaluate');
    expect(call.payload.eval_round).toBe(1);
    expect(call.payload.sprint_dir).toBe('sprints');
    expect(call.payload.dev_task_id).toBe('dev-1');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 7. sprint_evaluate PASS → sprint_report
  it('7. sprint_evaluate PASS → 创建 sprint_report', async () => {
    const task = {
      id: 'eval-1',
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', dev_task_id: 'dev-1', eval_round: 1, harness_mode: true }
    };

    mockQuery.mockResolvedValueOnce({ rows: [] }); // 无已有 sprint_report

    await simulateHarnessCallback(task, { verdict: 'PASS' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_report');
    expect(call.payload.sprint_dir).toBe('sprints');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 8. sprint_evaluate FAIL → sprint_fix R2
  it('8. sprint_evaluate FAIL → 创建 sprint_fix（eval_round 递增）', async () => {
    const task = {
      id: 'eval-1',
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', dev_task_id: 'dev-1', eval_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'FAIL', feedback: '验证命令失败' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_fix');
    expect(call.payload.eval_round).toBe(2);
    expect(call.payload.dev_task_id).toBe('dev-1');
    expect(call.payload.sprint_dir).toBe('sprints');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 9. sprint_fix DONE → sprint_evaluate（eval_round 正确递增）
  it('9. sprint_fix DONE → 创建 sprint_evaluate（eval_round 正确递增）', async () => {
    const task = {
      id: 'fix-1',
      task_type: 'sprint_fix',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', dev_task_id: 'dev-1', eval_round: 2, harness_mode: true }
    };

    await simulateHarnessCallback(task, { summary: 'fixed' });

    expect(mockCreateTask).toHaveBeenCalledTimes(1);
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_evaluate');
    expect(call.payload.eval_round).toBe(2);
    expect(call.payload.sprint_dir).toBe('sprints');
    expect(call.payload.dev_task_id).toBe('dev-1');
    expect(call.payload.harness_mode).toBe(true);
  });

  // 10. sprint_evaluate result=null → 不创建后续任务（AI Failed 处理）
  it('10. sprint_evaluate result=null → 不创建后续任务（AI Failed 处理）', async () => {
    const task = {
      id: 'eval-1',
      task_type: 'sprint_evaluate',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', dev_task_id: 'dev-1', eval_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, null);

    expect(mockCreateTask).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  // GAN 守卫测试：Proposer 失败时不派 Reviewer
  // 11. verdict=null（Proposer 被 quarantine）→ 不创建 review 任务
  it('11. sprint_contract_propose verdict=null → 不创建 review 任务（quarantine 场景）', async () => {
    const task = {
      id: 'propose-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, null);

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  // 12. verdict=undefined（result 对象无 verdict 字段）→ 不创建 review 任务
  it('12. sprint_contract_propose verdict=undefined → 不创建 review 任务', async () => {
    const task = {
      id: 'propose-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { error: 'auth_failed' });

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  // 13. verdict=FAILED（Proposer 明确失败）→ 不创建 review 任务
  it('13. sprint_contract_propose verdict=FAILED → 不创建 review 任务', async () => {
    const task = {
      id: 'propose-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, { verdict: 'FAILED', error: 'generation_error' });

    expect(mockCreateTask).not.toHaveBeenCalled();
  });

  // 纯文本 verdict 提取测试（cecelia-run 传纯文本字符串场景）
  // 14. result 是纯文本字符串 "PROPOSED" → 应创建 review 任务
  it('14. sprint_contract_propose result=纯文本"PROPOSED" → 创建 sprint_contract_review', async () => {
    const task = {
      id: 'propose-pt-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    // cecelia-run 可能直接把 stdout 作为纯文本字符串传回
    await simulateHarnessCallback(task, 'verdict: PROPOSED\n\n## Sprint Contract Draft...');

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_contract_review');
    expect(call.payload.propose_round).toBe(1);
  });

  // 15. result 是 Claude SDK JSON 对象（result.result 为纯文本）→ 应创建 review 任务
  it('15. sprint_contract_propose result={result:"...PROPOSED..."} → 创建 sprint_contract_review', async () => {
    const task = {
      id: 'propose-sdk-1',
      task_type: 'sprint_contract_propose',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 2, harness_mode: true }
    };

    // Claude CLI --output-format json 典型输出格式
    const claudeCliResult = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'verdict: PROPOSED\n\nThe sprint contract draft has been written to sprints/sprint-contract.md.',
      session_id: 'abc123',
      total_cost_usd: 0.01
    };

    await simulateHarnessCallback(task, claudeCliResult);

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_contract_review');
    expect(call.payload.propose_round).toBe(2);
  });

  // 16. sprint_contract_review result 是纯文本 "APPROVED" → 应派 Generator
  it('16. sprint_contract_review result=纯文本"APPROVED" → 创建 sprint_generate', async () => {
    const task = {
      id: 'review-pt-1',
      task_type: 'sprint_contract_review',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    await simulateHarnessCallback(task, 'The contract looks good. APPROVED.');

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_generate');
  });

  // 17. sprint_contract_review result.result 含 "APPROVED" → 应派 Generator
  it('17. sprint_contract_review result={result:"...APPROVED..."} → 创建 sprint_generate', async () => {
    const task = {
      id: 'review-sdk-1',
      task_type: 'sprint_contract_review',
      project_id: 'ini-1',
      goal_id: 'kr-1',
      payload: { sprint_dir: 'sprints', planner_task_id: 'planner-1', propose_round: 1, harness_mode: true }
    };

    const claudeCliResult = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '"verdict": "APPROVED"\n\nAll validation commands are rigorous.',
      session_id: 'def456',
      total_cost_usd: 0.02
    };

    await simulateHarnessCallback(task, claudeCliResult);

    expect(mockCreateTask).toHaveBeenCalledOnce();
    const call = mockCreateTask.mock.calls[0][0];
    expect(call.task_type).toBe('sprint_generate');
  });
});
