/**
 * pollCiNode — ci_no_checks 处理修复
 *
 * Bug：目标 repo/PR 无 CI check 时 poll_ci 永远 pending → 30min 超时 → merge 不执行。
 * 修复：ci_no_checks + MERGEABLE，给 NO_CHECKS_GRACE_POLLS 轮 grace（等 CI 注册）后判 pass。
 */
import { describe, it, expect } from 'vitest';
import { pollCiNode, NO_CHECKS_GRACE_POLLS } from '../harness-task.graph.js';

describe('pollCiNode — ci_no_checks', () => {
  it('ci_no_checks + MERGEABLE + 达 grace 轮 → pass', async () => {
    const r = await pollCiNode(
      { pr_url: 'u', poll_count: NO_CHECKS_GRACE_POLLS - 1 },
      { sleepMs: 0, checkPr: () => ({ state: 'OPEN', mergeable: 'MERGEABLE', ciStatus: 'ci_no_checks' }) }
    );
    expect(r.ci_status).toBe('pass');
  });

  it('ci_no_checks + MERGEABLE + 未达 grace → 继续 pending（给 CI 注册时间）', async () => {
    const r = await pollCiNode(
      { pr_url: 'u', poll_count: 0 },
      { sleepMs: 0, checkPr: () => ({ state: 'OPEN', mergeable: 'MERGEABLE', ciStatus: 'ci_no_checks' }) }
    );
    expect(r.ci_status).toBe('pending');
    expect(r.poll_count).toBe(1);
  });

  it('ci_no_checks + 非 MERGEABLE（CONFLICTING）→ 不当 pass，继续 pending', async () => {
    const r = await pollCiNode(
      { pr_url: 'u', poll_count: NO_CHECKS_GRACE_POLLS + 5 },
      { sleepMs: 0, checkPr: () => ({ state: 'OPEN', mergeable: 'CONFLICTING', ciStatus: 'ci_no_checks' }) }
    );
    expect(r.ci_status).toBe('pending');
  });

  it('ci_passed 仍正常 pass（不受影响）', async () => {
    const r = await pollCiNode(
      { pr_url: 'u', poll_count: 0 },
      { sleepMs: 0, checkPr: () => ({ state: 'OPEN', mergeable: 'MERGEABLE', ciStatus: 'ci_passed' }) }
    );
    expect(r.ci_status).toBe('pass');
  });
});
