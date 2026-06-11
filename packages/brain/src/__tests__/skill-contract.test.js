/**
 * skill-contract.test.js
 *
 * Skill 不变量快照测试 — 守护 packages/workflows/skills/ 下 4 个核心 SKILL.md
 * 不被静默修改/删除关键行为规则。
 *
 * 更新约定：修改任意 SKILL.md 时，同一 PR 必须同步更新本文件对应的检测逻辑，
 * 否则 CI 会红（这是有意设计，不是误报）。
 *
 * 覆盖不变量（共 7 项，见 contract-draft.md Step 4）：
 *   1. evaluator B-1.6 步骤（环境预检 + localhost 重写）
 *   2. evaluator B-1.7 步骤（弱 oracle/作弊扫描）
 *   3. evaluator B-1.8 步骤（Golden Path 覆盖核对）
 *   4. evaluator/generator 全文无 ws_id / contract-dod-ws 残留
 *   5. generator 全文无可执行 gh pr merge 命令
 *   6. reviewer 7 维度名与 harness-shared.js ReviewerOutputSchema 字段逐字一致
 *   7. proposer 含领域验证规则段
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/brain/src/__tests__/ → 4 层 up → 仓库根
const REPO_ROOT = resolve(__dirname, '../../../..');

const SKILLS = {
  evaluator: resolve(REPO_ROOT, 'packages/workflows/skills/harness-evaluator/SKILL.md'),
  reviewer:  resolve(REPO_ROOT, 'packages/workflows/skills/harness-contract-reviewer/SKILL.md'),
  generator: resolve(REPO_ROOT, 'packages/workflows/skills/harness-generator/SKILL.md'),
  proposer:  resolve(REPO_ROOT, 'packages/workflows/skills/harness-contract-proposer/SKILL.md'),
};

// ReviewerOutputSchema 7 个字段（与 harness-shared.js 逐字对齐，接口约定）
const REVIEWER_SCHEMA_FIELDS = [
  'dod_machineability',
  'scope_match_prd',
  'test_is_red',
  'internal_consistency',
  'risk_registered',
  'verification_oracle_completeness',
  'ci_workflow_alignment',
];

// ── 辅助函数 ───────────────────────────────────────────────────────────────

/**
 * 检测 evaluator SKILL.md 是否包含指定步骤关键字。
 * 返回 { ok: boolean, missing: string[] }
 */
function checkEvaluatorSteps(content) {
  const required = [
    { key: 'B-1.6', label: 'B-1.6' },
    { key: 'B-1.7', label: 'B-1.7' },
    { key: 'B-1.8', label: 'B-1.8' },
    { key: 'env_missing', label: 'env_missing' },
  ];
  const missing = required.filter(({ key }) => !content.includes(key)).map(({ label }) => label);
  return { ok: missing.length === 0, missing };
}

/**
 * 检测文本是否含 ws_id 或 contract-dod-ws 残留（旧 workstream 拆分遗迹）。
 * 只检查 YAML frontmatter 之后的正文（排除 changelog 历史描述里对这些字符串的提及）。
 * 返回 { ok: boolean, found: string[] }
 */
function checkNoWsResiduals(content) {
  // 跳过 YAML frontmatter（两个 --- 之间的内容）
  const afterFrontmatter = content.replace(/^---[\s\S]*?---\s*/, '');
  const patterns = ['ws_id', 'contract-dod-ws'];
  const found = patterns.filter((p) => afterFrontmatter.includes(p));
  return { ok: found.length === 0, found };
}

/**
 * 检测 generator SKILL.md 是否含可执行的 gh pr merge 命令行（排除注释说明）。
 * 返回 { ok: boolean, lines: string[] }
 */
function checkNoGhPrMerge(content) {
  const lines = content.split('\n');
  // 可执行命令行：不以 # / > / | / <!-- 开头，且含 gh pr merge
  const execLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.includes('gh pr merge')) return false;
    // 排除注释、markdown 引用、表格行（包含 | 但不是 shell 管道）
    if (/^\s*(#|>|<!--|\|)/.test(line)) return false;
    // 排除以 // 开头（JS 注释）
    if (/^\s*\/\//.test(line)) return false;
    // 排除 markdown 列表项（changelog 描述文字，如 "  - 7.5.0: ... gh pr merge ..."）
    if (/^\s*-\s/.test(line)) return false;
    return true;
  });
  return { ok: execLines.length === 0, lines: execLines };
}

/**
 * 检测 reviewer SKILL.md 是否包含 ReviewerOutputSchema 所有 7 个字段名。
 * 返回 { ok: boolean, missing: string[] }
 */
function checkReviewerFields(content) {
  const missing = REVIEWER_SCHEMA_FIELDS.filter((f) => !content.includes(f));
  return { ok: missing.length === 0, missing };
}

/**
 * 检测 proposer SKILL.md 是否包含领域验证规则段。
 * 返回 { ok: boolean, missing: string[] }
 */
function checkProposerDomainRules(content) {
  const required = [
    { key: '领域验证', label: '领域验证规则段' },
    { key: 'ffprobe', label: '视频 ffprobe 条款' },
  ];
  const missing = required.filter(({ key }) => !content.includes(key)).map(({ label }) => label);
  return { ok: missing.length === 0, missing };
}

// ── 正向测试（当前快照合规） ────────────────────────────────────────────────

describe('skill-contract 正向测试 — 当前 SKILL.md 快照合规', () => {

  describe('evaluator SKILL.md', () => {
    it('含 B-1.6 环境预检步骤', () => {
      const content = readFileSync(SKILLS.evaluator, 'utf8');
      expect(content).toContain('B-1.6');
    });

    it('含 B-1.7 弱 oracle/作弊扫描步骤', () => {
      const content = readFileSync(SKILLS.evaluator, 'utf8');
      expect(content).toContain('B-1.7');
    });

    it('含 B-1.8 Golden Path 覆盖核对步骤', () => {
      const content = readFileSync(SKILLS.evaluator, 'utf8');
      expect(content).toContain('B-1.8');
    });

    it('含 env_missing 死规则（工具缺失即 FAIL，禁止降级）', () => {
      const content = readFileSync(SKILLS.evaluator, 'utf8');
      expect(content).toContain('env_missing');
    });

    it('全文无 ws_id / contract-dod-ws 残留', () => {
      const content = readFileSync(SKILLS.evaluator, 'utf8');
      const result = checkNoWsResiduals(content);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`evaluator SKILL.md 含旧 workstream 残留: ${result.found.join(', ')}`);
      }
    });
  });

  describe('generator SKILL.md', () => {
    it('全文无可执行的 gh pr merge 命令（v7.5 — merge 由 mergePrNode 执行）', () => {
      const content = readFileSync(SKILLS.generator, 'utf8');
      const result = checkNoGhPrMerge(content);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(
          `generator SKILL.md 含可执行 gh pr merge 命令（共 ${result.lines.length} 行）：\n` +
          result.lines.slice(0, 3).join('\n'),
        );
      }
    });
  });

  describe('reviewer SKILL.md', () => {
    it('含 ReviewerOutputSchema 全部 7 个维度字段名（接口约定）', () => {
      const content = readFileSync(SKILLS.reviewer, 'utf8');
      const result = checkReviewerFields(content);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`reviewer SKILL.md 缺 7 维字段: ${result.missing.join(', ')}`);
      }
    });

    for (const field of REVIEWER_SCHEMA_FIELDS) {
      it(`含 ReviewerOutputSchema 字段 "${field}"`, () => {
        const content = readFileSync(SKILLS.reviewer, 'utf8');
        expect(content).toContain(field);
      });
    }
  });

  describe('proposer SKILL.md', () => {
    it('含领域验证规则段（强制视频/发布/DB/UI oracle）', () => {
      const content = readFileSync(SKILLS.proposer, 'utf8');
      const result = checkProposerDomainRules(content);
      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(`proposer SKILL.md 缺: ${result.missing.join(', ')}`);
      }
    });
  });

});

// ── 反向测试（篡改 fixture 应触发检测失败） ─────────────────────────────────

describe('skill-contract 反向测试 — 篡改 fixture 被检测逻辑识别', () => {

  it('checkEvaluatorSteps: 删掉 env_missing 段的 fixture → ok=false，missing 含 env_missing', () => {
    // 模拟删除了 env_missing 关键字的 evaluator SKILL.md 副本
    const original = readFileSync(SKILLS.evaluator, 'utf8');
    const tampered = original
      .replace(/env_missing/g, '__REMOVED__')  // 删掉 env_missing
      .replace(/\bB-1\.6\b/g, '__REMOVED__');  // 同时删掉 B-1.6 步骤头

    const result = checkEvaluatorSteps(tampered);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('env_missing');
  });

  it('checkNoWsResiduals: 含 ws_id 的 fixture → ok=false，found 含 ws_id', () => {
    const tampered = 'some content\n# 旧接口 ws_id=1 workstream\nmore content';
    const result = checkNoWsResiduals(tampered);
    expect(result.ok).toBe(false);
    expect(result.found).toContain('ws_id');
  });

  it('checkNoGhPrMerge: 含可执行 gh pr merge 行的 fixture → ok=false', () => {
    const tampered = 'some content\ngh pr merge --auto "$PR_NUMBER"\nmore content';
    const result = checkNoGhPrMerge(tampered);
    expect(result.ok).toBe(false);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it('checkReviewerFields: 删掉 dod_machineability 的 fixture → ok=false，missing 含该字段', () => {
    const original = readFileSync(SKILLS.reviewer, 'utf8');
    const tampered = original.replace(/dod_machineability/g, '__REMOVED__');
    const result = checkReviewerFields(tampered);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('dod_machineability');
  });

  it('checkProposerDomainRules: 删掉领域验证段的 fixture → ok=false', () => {
    const original = readFileSync(SKILLS.proposer, 'utf8');
    const tampered = original.replace(/领域验证/g, '__REMOVED__');
    const result = checkProposerDomainRules(tampered);
    expect(result.ok).toBe(false);
  });

});
