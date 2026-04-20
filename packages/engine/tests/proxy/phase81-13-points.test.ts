import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROXY_PATH = resolve(__dirname, '../../skills/dev/steps/autonomous-research-proxy.md');

describe('Phase 8.1 proxy 13-point deepening', () => {
  const content = readFileSync(PROXY_PATH, 'utf8');

  const anchors = [
    'B-1 视觉陪伴',
    'B-2 scope decomposition',
    'B-3 clarifying questions',
    'B-4 design review',
    'B-5 spec approval',
    'B-6 spec self-review',
    'SDD-1 implementer 问题',
    'SDD-2 spec reviewer',
    'SDD-3 code quality reviewer',
    'RCR-1 澄清 unclear',
    'RCR-2 外部冲突',
    'RCR-3 YAGNI check',
    'RCR-4 推回 reviewer',
  ];

  for (const anchor of anchors) {
    it(`contains anchor: ${anchor}`, () => {
      expect(content).toContain(anchor);
    });
  }

  it('declares Structured Review Block section', () => {
    expect(content).toContain('Structured Review Block');
  });

  it('declares data source ordering 用户的话 > 现有代码 > OKR', () => {
    expect(content).toContain('用户的话 > 现有代码 > OKR');
  });

  it('declares 不读 decisions rule', () => {
    expect(content).toMatch(/不(用|读).{0,20}decisions/);
  });

  it('contains Appendix A Research Subagent prompts', () => {
    expect(content).toContain('Appendix A');
    ['A.B-2', 'A.B-3', 'A.SDD-1', 'A.SDD-2', 'A.SDD-3'].forEach((p) => {
      expect(content).toContain(p);
    });
  });
});
