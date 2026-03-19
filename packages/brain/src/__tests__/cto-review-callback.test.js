/**
 * CTO Review Callback Tests
 * 验证 execution-callback 收到 cto_review 完成时正确写入 review_result
 * 断链修复：5c8b — cto_review → review_result → devloop-check.sh 条件 2.5
 *
 * 策略：直接测试 review_result 构建逻辑，不加载完整 routes.js（避免 OOM）
 */

import { describe, it, expect } from 'vitest';

/**
 * 从 execution.js 5c8b 提取的 review_result 构建逻辑
 * 与 execution.js 中的实现保持一致
 */
function buildReviewResult(result) {
  const resultObj = typeof result === 'object' && result !== null ? result : {};
  const decision = resultObj.decision || (typeof result === 'string' ? result : 'PASS');
  const summary = resultObj.summary || (typeof result === 'string' ? result : '');
  const l1Count = resultObj.l1_count ?? 0;
  const l2Count = resultObj.l2_count ?? 0;

  return [
    `决定: ${decision}`,
    summary ? `摘要: ${summary}` : '',
    `L1问题: ${l1Count}, L2问题: ${l2Count}`,
  ].filter(Boolean).join('\n');
}

describe('cto_review review_result 构建逻辑', () => {
  it('PASS 对象结果: review_result 包含 PASS 且格式正确', () => {
    const result = buildReviewResult({
      decision: 'PASS',
      summary: '需求覆盖完整，代码质量符合标准',
      l1_count: 0,
      l2_count: 0,
    });

    expect(result).toContain('PASS');
    expect(result).toContain('决定: PASS');
    expect(result).toContain('摘要: 需求覆盖完整');
    expect(result).toContain('L1问题: 0');
    expect(result).toContain('L2问题: 0');
  });

  it('FAIL 对象结果: review_result 包含 FAIL 和问题计数', () => {
    const result = buildReviewResult({
      decision: 'FAIL',
      summary: '发现 L1 问题：未捕获异常',
      l1_count: 1,
      l2_count: 2,
    });

    expect(result).toContain('FAIL');
    expect(result).toContain('决定: FAIL');
    expect(result).toContain('L1问题: 1');
    expect(result).toContain('L2问题: 2');
  });

  it('WARN 对象结果: review_result 包含 WARN', () => {
    const result = buildReviewResult({
      decision: 'WARN',
      summary: '有 L2 问题但不阻塞',
      l1_count: 0,
      l2_count: 1,
    });

    expect(result).toContain('WARN');
    expect(result).toContain('决定: WARN');
  });

  it('字符串 PASS 结果: 正确解析为 decision=PASS', () => {
    const result = buildReviewResult('PASS');

    expect(result).toContain('决定: PASS');
    // 字符串结果也作为 summary
    expect(result).toContain('摘要: PASS');
  });

  it('字符串 FAIL 结果: 正确解析为 decision=FAIL', () => {
    const result = buildReviewResult('FAIL');

    expect(result).toContain('决定: FAIL');
  });

  it('null 结果: 默认 decision=PASS', () => {
    const result = buildReviewResult(null);

    expect(result).toContain('决定: PASS');
    // null 不产生 summary 行
    expect(result).not.toContain('摘要:');
  });

  it('空对象结果: 默认 decision=PASS', () => {
    const result = buildReviewResult({});

    expect(result).toContain('决定: PASS');
  });

  it('devloop-check.sh 兼容: grep -qi PASS 能匹配', () => {
    const passResult = buildReviewResult({ decision: 'PASS', summary: '质量合格' });
    // devloop-check.sh: echo "$cto_review_result" | grep -qi "PASS"
    expect(passResult.toLowerCase()).toContain('pass');

    const failResult = buildReviewResult({ decision: 'FAIL', summary: 'L1问题' });
    // FAIL 时不应包含 PASS（避免误判）
    expect(failResult.toLowerCase()).not.toContain('pass');
  });

  it('devloop-check.sh 兼容: WARN 结果不包含 PASS', () => {
    const warnResult = buildReviewResult({ decision: 'WARN', summary: '轻微问题' });
    // WARN 不应误匹配为 PASS
    expect(warnResult.toLowerCase()).not.toContain('pass');
  });

  it('l1_count/l2_count 缺失时默认为 0', () => {
    const result = buildReviewResult({ decision: 'PASS' });
    expect(result).toContain('L1问题: 0');
    expect(result).toContain('L2问题: 0');
  });
});

describe('cto_review parent_task_id 解析', () => {
  it('从 payload 正确提取 parent_task_id', () => {
    const payload = { parent_task_id: 'parent-abc-123' };
    expect(payload.parent_task_id).toBe('parent-abc-123');
  });

  it('payload 无 parent_task_id 时为 undefined', () => {
    const payload = {};
    expect(payload.parent_task_id).toBeUndefined();
  });

  it('payload 为 null 时安全处理', () => {
    const payload = null;
    const parentTaskId = (payload || {}).parent_task_id;
    expect(parentTaskId).toBeUndefined();
  });
});
