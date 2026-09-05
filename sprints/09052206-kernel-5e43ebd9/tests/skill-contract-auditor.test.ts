import { describe, it, expect } from 'vitest';
// TDD Red：实现落地前该模块不存在，import 解析失败 → 全部 FAIL（真红）。
// scan.mjs 由 generator 创建，导出确定性流水线纯函数供本测试与 CLI 复用。
import {
  rankFindings,
  parseSkillContract,
  persistJudgments,
  SkillContractParseError,
} from '../../../packages/workflows/skills/skill-contract-auditor/scan.mjs';

const mkFinding = (id: string, severity: string, extra: Record<string, unknown> = {}) => ({
  id,
  severity,
  surface: 'missing_precondition',
  title: `t-${id}`,
  detail: `d-${id}`,
  is_judgment_assumption: false,
  ...extra,
});

describe('rankFindings [BEHAVIOR]', () => {
  it('按 severity 降序 critical>high>medium>low 排序，第一条为最严重', () => {
    const out = rankFindings([
      mkFinding('a', 'low'),
      mkFinding('b', 'critical'),
      mkFinding('c', 'medium'),
      mkFinding('d', 'high'),
    ]);
    expect(out.findings.map((f: any) => f.severity)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(out.findings[0].id).toBe('b');
    expect(out.total_found).toBe(4);
    expect(out.truncated).toBe(false);
  });

  it('同 severity 保持输入稳定序', () => {
    const out = rankFindings([
      mkFinding('x1', 'high'),
      mkFinding('x2', 'high'),
      mkFinding('x3', 'high'),
    ]);
    expect(out.findings.map((f: any) => f.id)).toEqual(['x1', 'x2', 'x3']);
  });

  it('漏洞数大于 8 时截断到 8 且 truncated 为 true、total_found 记真实数', () => {
    const many = Array.from({ length: 10 }, (_, i) => mkFinding(`m${i}`, 'medium'));
    const out = rankFindings(many);
    expect(out.findings.length).toBe(8);
    expect(out.truncated).toBe(true);
    expect(out.total_found).toBe(10);
  });

  it('零漏洞返回空清单 total_found 为 0，不编造洞', () => {
    const out = rankFindings([]);
    expect(out.findings.length).toBe(0);
    expect(out.total_found).toBe(0);
    expect(out.truncated).toBe(false);
  });

  it('findings 元素 severity 非枚举值时报错，不静默排到末尾', () => {
    expect(() => rankFindings([mkFinding('bad', 'urgent')])).toThrow();
  });
});

describe('parseSkillContract [BEHAVIOR]', () => {
  it('合法技能契约解析成功返回 contract_id', () => {
    const parsed = parseSkillContract('# skill contract\ncontract_id: search_account\nCHECKS:\n- precondition: x\n');
    expect(parsed).toBeTruthy();
    expect(parsed.contract_id).toBe('search_account');
  });

  it('无法解析契约抛 SkillContractParseError 而非返回假空清单', () => {
    expect(() => parseSkillContract('')).toThrow(SkillContractParseError);
  });
});

describe('persistJudgments [BEHAVIOR]', () => {
  it('Brain 不可达时不抛错只告警返回 written 为 0', async () => {
    const failing = async () => {
      throw new Error('ECONNREFUSED');
    };
    const res = await persistJudgments(
      [mkFinding('j1', 'critical', { is_judgment_assumption: true })],
      { brainUrl: 'http://127.0.0.1:59999', sourceRef: 'skill-contract-auditor:test', fetchImpl: failing },
    );
    expect(res.written).toBe(0);
    expect(res.errors.length).toBeGreaterThanOrEqual(1);
  });

  it('只把 is_judgment_assumption 为 true 的洞发往 Brain', async () => {
    const calls: any[] = [];
    const okFetch = async (_url: string, opts: any) => {
      calls.push(JSON.parse(opts.body));
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };
    const res = await persistJudgments(
      [
        mkFinding('j1', 'critical', { is_judgment_assumption: true }),
        mkFinding('n1', 'high', { is_judgment_assumption: false }),
      ],
      { brainUrl: 'http://localhost:5221', sourceRef: 'skill-contract-auditor:test', fetchImpl: okFetch },
    );
    expect(res.written).toBe(1);
    expect(calls.length).toBe(1);
    expect(calls[0].category).toBe('judgment');
    expect(calls[0].made_by).toBe('cecelia');
    expect(calls[0].source_ref).toBe('skill-contract-auditor:test');
  });
});
