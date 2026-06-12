import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');

// SKILLS_DIR 环境变量注入（守卫3篡改测试依赖此接口，禁止硬编码绝对路径）
const SKILLS_DIR = process.env.SKILLS_DIR ?? resolve(REPO_ROOT, 'packages/workflows/skills');

function readSkill(skillName: string): string {
  return readFileSync(resolve(SKILLS_DIR, skillName, 'SKILL.md'), 'utf8');
}

// ─── harness-evaluator ────────────────────────────────────────────────────────

describe('harness-evaluator SKILL 不变量', () => {
  const content = readSkill('harness-evaluator');

  it('含 env_missing 不变量（B-1.6 环境预检红线，守卫3关键）', () => {
    expect(content).toContain('env_missing');
  });

  it('含 Step B-1.6 环境预检步骤', () => {
    expect(content).toMatch(/Step B-1\.6/);
  });

  it('含 Step B-1.7 弱 oracle 扫描步骤', () => {
    expect(content).toMatch(/Step B-1\.7/);
  });

  it('含 Step B-1.8 Golden Path 覆盖核对步骤', () => {
    expect(content).toMatch(/Step B-1\.8/);
  });

  it('主体无 ws_id 残留（仅 changelog 行豁免）', () => {
    const nonChangelogLines = content.split('\n').filter(
      l => !l.match(/^\s*-\s+\d+\.\d+\.\d+:/)
    );
    const hasWsId = nonChangelogLines.some(l => /\bws_id\b/.test(l));
    expect(hasWsId).toBe(false);
  });

  it('主体无 contract-dod-ws 残留（仅 changelog 行豁免）', () => {
    const nonChangelogLines = content.split('\n').filter(
      l => !l.match(/^\s*-\s+\d+\.\d+\.\d+:/)
    );
    const hasOld = nonChangelogLines.some(l => /contract-dod-ws/.test(l));
    expect(hasOld).toBe(false);
  });
});

// ─── harness-contract-reviewer ───────────────────────────────────────────────

describe('harness-contract-reviewer SKILL 不变量（与 ReviewerOutputSchema 接口约定）', () => {
  const content = readSkill('harness-contract-reviewer');

  const RUBRIC_DIMENSIONS = [
    'dod_machineability',
    'scope_match_prd',
    'test_is_red',
    'internal_consistency',
    'risk_registered',
    'verification_oracle_completeness',
    'ci_workflow_alignment',
  ] as const;

  for (const dim of RUBRIC_DIMENSIONS) {
    it(`含 rubric 维度 ${dim}`, () => {
      expect(content).toContain(dim);
    });
  }

  it('含全 7 维度评分输出示例（确认 Brain ReviewerOutputSchema 接口对齐）', () => {
    expect(content).toMatch(/rubric_scores/);
  });
});

// ─── harness-generator ───────────────────────────────────────────────────────

describe('harness-generator SKILL 不变量', () => {
  const content = readSkill('harness-generator');

  it('不含可执行的 gh pr merge 命令（v7.5.0 红线：merge 由 mergePrNode 执行）', () => {
    // gh pr merge 只允许出现在"禁止/🚫"语境，不允许作为可执行步骤
    const lines = content.split('\n');
    const executableMergeLines = lines.filter(l => {
      // 含 gh pr merge 且不在禁止/说明上下文中
      if (!l.includes('gh pr merge')) return false;
      // 豁免：纯注释、changelog、🚫 红线、"禁止"说明
      if (/^\s*[-*#>]/.test(l)) return false;   // markdown list/header/blockquote/comment
      if (/禁止|🚫|红线|不.*merge|merge.*禁|changelog|删除/.test(l)) return false;
      // 剩余：可执行命令行
      return true;
    });
    expect(executableMergeLines).toHaveLength(0);
  });

  it('含 CI 全绿循环退出逻辑（Step 7.5）', () => {
    expect(content).toMatch(/CI.*全绿|全绿.*CI/);
  });
});

// ─── harness-contract-proposer ───────────────────────────────────────────────

describe('harness-contract-proposer SKILL 不变量', () => {
  const content = readSkill('harness-contract-proposer');

  it('含领域验证规则段（全局强制，与 evaluator 死规则呼应）', () => {
    expect(content).toMatch(/领域验证规则/);
  });

  it('含视频领域 ffprobe oracle 规则', () => {
    expect(content).toContain('ffprobe');
  });

  it('含作弊反例清单（Reviewer 各维度防御）', () => {
    expect(content).toMatch(/作弊反例|反例清单/);
  });
});
