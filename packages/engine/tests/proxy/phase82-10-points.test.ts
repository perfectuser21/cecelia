import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROXY_PATH = resolve(__dirname, '../../skills/dev/steps/autonomous-research-proxy.md');

describe('Phase 8.2 proxy 10-point deepening', () => {
  const content = readFileSync(PROXY_PATH, 'utf8');

  const anchors = [
    'WP-1',
    'EP-1',
    'TDD-1',
    'FAD-1',
    'SD-1',
    'RCR-REQ-1',
    'DPA-1',
    'DPA-2',
    'UGW-1',
    'UGW-2',
  ];

  for (const anchor of anchors) {
    it(`contains anchor: ${anchor}`, () => {
      expect(content).toContain(anchor);
    });
  }

  it('declares Phase 8.2 section header', () => {
    expect(content).toContain('Phase 8.2 — 剩余 10 点规则');
  });

  it('contains Appendix A prompts for Phase 8.2', () => {
    ['A.WP-1', 'A.EP-1', 'A.DPA-1', 'A.DPA-2'].forEach((p) => {
      expect(content).toContain(p);
    });
  });

  it('UGW-1 declares Cecelia fixed worktree path', () => {
    expect(content).toContain('/Users/administrator/worktrees/cecelia/');
  });

  it('EP-1 declares .concerns-<branch>.md output', () => {
    expect(content).toMatch(/\.concerns-.{0,20}\.md/);
  });

  it('SD-1 declares ci_fix_count >= 3 hard trigger', () => {
    expect(content).toMatch(/ci_fix_count\s*>=\s*3/);
  });

  it('TDD-1 declares commit type rules', () => {
    expect(content).toContain('feat:');
    expect(content).toContain('[CONFIG]');
  });
});
