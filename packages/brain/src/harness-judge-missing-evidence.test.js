/**
 * harness-judge-missing-evidence.test.js — evidence_insufficient 结构化缺证清单（本 sprint）。
 *
 * 覆盖 buildMissingEvidence 合成逻辑 + callDeepSeekJudge 解析裁判自报 missing_evidence。
 */
import { describe, it, expect } from 'vitest';
import { buildMissingEvidence, callDeepSeekJudge } from './harness-judge.js';

describe('buildMissingEvidence — 缺证清单合成', () => {
  it('汇总机械闸 reasons + coverage 缺步/未过步 + 裁判自报，去重非空', () => {
    const out = buildMissingEvidence({
      mech: { reasons: ['behavior_tests 为空', 'behavior_tests 为空'] },
      cov: {
        missing: [{ index: 1, step: 'PG 建库' }],
        failed: [{ index: 2, step: 'PG 查行', evidence: 'exit=1' }],
      },
      judgeResult: { missing_evidence: ['缺 psql exit code'] },
    });
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain('behavior_tests 为空');
    expect(out).toContain('缺 psql exit code');
    expect(out.some((s) => s.includes('PG 建库'))).toBe(true);
    expect(out.some((s) => s.includes('PG 查行') && s.includes('exit=1'))).toBe(true);
    // 去重：重复的机械闸 reason 只出现一次
    expect(out.filter((s) => s === 'behavior_tests 为空')).toHaveLength(1);
  });

  it('判 evidence_insufficient 却一条缺证都没有 → 兜底占位，保证非空数组（Invariant）', () => {
    const out = buildMissingEvidence({});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/未产出结构化缺证条目/);
  });
});

describe('callDeepSeekJudge — 解析裁判自报 missing_evidence', () => {
  it('裁判 JSON 含 missing_evidence 数组 → 规范化落入结果', async () => {
    const judgeJson = JSON.stringify({
      verdict: 'FAIL',
      failure_class: 'evidence_insufficient',
      coverage: [],
      missing_evidence: ['  缺 psql 建/查隔离库 stdout  ', '', '缺退出码'],
      feedback: '证据不足',
    });
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: judgeJson } }] }),
      text: async () => judgeJson,
    });
    const result = await callDeepSeekJudge(
      { contractE2E: 'x', goldenPathSteps: [], agentVerdict: 'PASS' },
      { config: { apiKey: 'k', baseUrl: 'http://judge.test', model: 'm' }, fetchFn: fakeFetch },
    );
    expect(result.failure_class).toBe('evidence_insufficient');
    // trim + 去空
    expect(result.missing_evidence).toEqual(['缺 psql 建/查隔离库 stdout', '缺退出码']);
  });

  it('裁判 JSON 无 missing_evidence → 结果为空数组（不 crash）', async () => {
    const judgeJson = JSON.stringify({ verdict: 'PASS', coverage: [] });
    const fakeFetch = async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: judgeJson } }] }),
      text: async () => judgeJson,
    });
    const result = await callDeepSeekJudge(
      { contractE2E: 'x', goldenPathSteps: [], agentVerdict: 'PASS' },
      { config: { apiKey: 'k', baseUrl: 'http://judge.test', model: 'm' }, fetchFn: fakeFetch },
    );
    expect(result.missing_evidence).toEqual([]);
  });
});
