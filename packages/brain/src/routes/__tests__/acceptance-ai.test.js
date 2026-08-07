// acceptance-ai.js 的配对单测（lint-test-pairing 配对文件）。
// 端点行为的全链路覆盖在 __tests__/integration/acceptance-ai-results.integration.test.js（真库）。
// 本文件覆盖两个纯函数的域判据——它们是 A4③⑥⑦ 的服务端承载，域漂移必须显式红。
import { describe, it, expect } from 'vitest';
import { AI_VERDICTS, validateAiReason, missingMandatoryScenarios } from '../acceptance-ai.js';

const SETS = {
  byKey: new Map([
    ['S2-c1', { verifiable_by: 'human_only' }],
    ['S6-c3', { verifiable_by: 'machine_db' }],
  ]),
  mandatoryScenarioCodes: ['SC-A', 'SC-B', 'SC-C'],
};

describe('acceptance-ai 纯函数域判据', () => {
  it('AI_VERDICTS 恰为中文三值（与人列枚举演进独立）', () => {
    expect(AI_VERDICTS).toEqual(['通过', '不通过', '无法验证']);
  });

  it('scenario_not_triggered 任何格一律拒收（A4⑥⑦ 合法域空集）', () => {
    for (const check_key of ['S2-c1', 'S6-c3']) {
      const r = validateAiReason({ check_key, reason: 'scenario_not_triggered' }, SETS);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('reason_domain_empty');
    }
  });

  it('reason=human_only 只允许出现在 human_only 格（A4③）', () => {
    expect(validateAiReason({ check_key: 'S2-c1', reason: 'human_only' }, SETS)).toBeNull();
    const bad = validateAiReason({ check_key: 'S6-c3', reason: 'human_only' }, SETS);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('reason_not_allowed_for_cell');
  });

  it('故障类 reason 任何格放行；规程外格号 400', () => {
    for (const reason of ['page_unreachable', 'login_failed', 'timeout']) {
      expect(validateAiReason({ check_key: 'S6-c3', reason }, SETS)).toBeNull();
    }
    expect(validateAiReason({ check_key: 'X9-c9', reason: 'timeout' }, SETS).body.error).toBe('unknown_check_key');
  });

  it('missingMandatoryScenarios：detail 缺字段按全集缺失（fail-closed）', () => {
    expect(missingMandatoryScenarios(null, SETS)).toEqual(['SC-A', 'SC-B', 'SC-C']);
    expect(missingMandatoryScenarios({ scenarios_observed: ['SC-B'] }, SETS)).toEqual(['SC-A', 'SC-C']);
    expect(missingMandatoryScenarios({ scenarios_observed: ['SC-A', 'SC-B', 'SC-C'] }, SETS)).toEqual([]);
  });
});
