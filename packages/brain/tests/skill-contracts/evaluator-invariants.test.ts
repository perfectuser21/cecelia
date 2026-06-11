import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../../');
const SKILLS_DIR = path.join(WORKSPACE_ROOT, 'packages/workflows/skills');
const ROUTER_SCRIPT = path.join(WORKSPACE_ROOT, 'packages/brain/scripts/ci/changed-test-router.mjs');
const GATE_SCRIPT = path.join(WORKSPACE_ROOT, 'packages/brain/scripts/ci/check-contract-exists.mjs');

// 支持篡改 fixture 测试：通过 EVALUATOR_SKILL_FIXTURE 环境变量指定替代路径
const EVALUATOR_SKILL_PATH = process.env['EVALUATOR_SKILL_FIXTURE']
  || path.join(SKILLS_DIR, 'harness-evaluator/SKILL.md');

const REVIEWER_SKILL_PATH = path.join(SKILLS_DIR, 'harness-contract-reviewer/SKILL.md');
const GENERATOR_SKILL_PATH = path.join(SKILLS_DIR, 'harness-generator/SKILL.md');
const PROPOSER_SKILL_PATH = path.join(SKILLS_DIR, 'harness-contract-proposer/SKILL.md');

// ─── Step 1: 路由脚本输出 ────────────────────────────────────────────────

describe('changed-test-router — skill 文件路由 [BEHAVIOR]', () => {
  it('路由脚本文件存在', () => {
    expect(fs.existsSync(ROUTER_SCRIPT)).toBe(true);
  });

  it('--files harness-evaluator/SKILL.md 输出包含 skill-contracts 路径', () => {
    const output = execSync(
      `node "${ROUTER_SCRIPT}" --files "packages/workflows/skills/harness-evaluator/SKILL.md"`,
      { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
    );
    expect(output).toMatch(/packages\/brain\/tests\/skill-contracts/);
  });

  it('输出不得仅为通用 brain/tests 通配（须具体到 skill-contracts）', () => {
    const output = execSync(
      `node "${ROUTER_SCRIPT}" --files "packages/workflows/skills/harness-generator/SKILL.md"`,
      { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
    );
    // 必须包含 skill-contracts 路径，不能只输出 packages/brain/tests/*.test.js 通配
    expect(output).toMatch(/skill-contracts/);
    expect(output).not.toMatch(/^\s*packages\/brain\/tests\/\*\*\/\*/m);
  });
});

// ─── Step 2: evaluator SKILL.md 不变量（含篡改 fixture 支持） ───────────────

describe('evaluator SKILL.md 关键不变量 [BEHAVIOR]', () => {
  let content: string;

  it('SKILL.md 可读', () => {
    content = fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(100);
  });

  it('含 env_missing 红线（Step B-1.6 核心不变量）', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    expect(content).toContain('env_missing');
  });

  it('含 B-1.6 步骤（环境预检 + localhost 重写）', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    expect(content).toMatch(/B-1\.6/);
  });

  it('含 B-1.7 步骤（弱 oracle / 作弊扫描）', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    expect(content).toMatch(/B-1\.7/);
  });

  it('含 B-1.8 步骤（Golden Path 覆盖核对）', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    expect(content).toMatch(/B-1\.8/);
  });

  it('全文无 ws_id 残留（v1.15.0 已清理）', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    // changelog 行可以提到 ws_id（记录"已清理"），但实际指令段不应再出现
    const linesWithWsId = content
      .split('\n')
      .filter(line => line.includes('ws_id') && !line.startsWith('  - '));
    expect(linesWithWsId).toHaveLength(0);
  });

  it('全文无 contract-dod-ws 残留', () => {
    content = content || fs.readFileSync(EVALUATOR_SKILL_PATH, 'utf8');
    const linesWithOldFormat = content
      .split('\n')
      .filter(line => line.includes('contract-dod-ws') && !line.startsWith('  - '));
    expect(linesWithOldFormat).toHaveLength(0);
  });
});

// ─── Step 2: reviewer SKILL.md — 7 维名与 ReviewerOutputSchema 逐字一致 ────

describe('reviewer SKILL.md — 7 维度名与 ReviewerOutputSchema 对齐 [BEHAVIOR]', () => {
  const EXPECTED_DIMENSIONS = [
    'dod_machineability',
    'scope_match_prd',
    'test_is_red',
    'internal_consistency',
    'risk_registered',
    'verification_oracle_completeness',
    'ci_workflow_alignment',
  ];

  let content: string;

  it('reviewer SKILL.md 可读', () => {
    content = fs.readFileSync(REVIEWER_SKILL_PATH, 'utf8');
    expect(content.length).toBeGreaterThan(100);
  });

  for (const dim of EXPECTED_DIMENSIONS) {
    it(`reviewer SKILL.md 含维度名 "${dim}"（与 ReviewerOutputSchema 逐字一致）`, () => {
      content = content || fs.readFileSync(REVIEWER_SKILL_PATH, 'utf8');
      expect(content).toContain(dim);
    });
  }
});

// ─── Step 2: generator SKILL.md — 全文无可执行 gh pr merge ──────────────────

describe('generator SKILL.md — 无可执行 gh pr merge 命令 [BEHAVIOR]', () => {
  it('全文无裸 `gh pr merge`（非注释/非警告行）', () => {
    const content = fs.readFileSync(GENERATOR_SKILL_PATH, 'utf8');
    // 允许：changelog 行（以 "  - " 开头）和禁止说明行（含 "禁止" / "不得"）
    // 不允许：实际可执行的 gh pr merge 命令
    const executableLines = content
      .split('\n')
      .filter(line => {
        if (!line.includes('gh pr merge')) return false;
        // changelog / 禁止说明 → 允许
        if (line.match(/^\s+- /)) return false;
        if (line.includes('禁止') || line.includes('不得') || line.includes('🚫')) return false;
        if (line.startsWith('#') || line.startsWith('//')) return false;
        return true;
      });
    expect(executableLines).toHaveLength(0);
  });
});

// ─── Step 2: proposer SKILL.md — 含领域验证规则段 ──────────────────────────

describe('proposer SKILL.md — 含领域验证规则段 [BEHAVIOR]', () => {
  it('含「领域验证规则」章节标题', () => {
    const content = fs.readFileSync(PROPOSER_SKILL_PATH, 'utf8');
    expect(content).toContain('领域验证规则');
  });

  it('领域验证规则段含视频 ffprobe 要求', () => {
    const content = fs.readFileSync(PROPOSER_SKILL_PATH, 'utf8');
    expect(content).toContain('ffprobe');
  });

  it('领域验证规则段含 DB 时间窗要求', () => {
    const content = fs.readFileSync(PROPOSER_SKILL_PATH, 'utf8');
    expect(content).toMatch(/created_at.*interval|interval.*created_at/);
  });
});

// ─── Step 4: check-contract-exists.mjs — gate 逻辑 ──────────────────────────

describe('check-contract-exists.mjs — 合同存在性 gate [BEHAVIOR]', () => {
  it('gate 脚本文件存在', () => {
    expect(fs.existsSync(GATE_SCRIPT)).toBe(true);
  });

  it('缺合同 diff → 非零退出且输出含 contract-draft.md', () => {
    let threw = false;
    let output = '';
    try {
      output = execSync(
        `printf "sprints/06120215-ci-defense-r2/src/index.ts\\n" | node "${GATE_SCRIPT}"`,
        { cwd: WORKSPACE_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch (err: any) {
      threw = true;
      output = (err.stdout || '') + (err.stderr || '');
    }
    expect(threw).toBe(true);
    expect(output).toContain('contract-draft.md');
  });

  it('完整 diff（含 contract-draft.md）→ 0 退出', () => {
    expect(() => {
      execSync(
        `printf "sprints/06120215-ci-defense-r2/contract-draft.md\\nsprints/06120215-ci-defense-r2/src/index.ts\\n" | node "${GATE_SCRIPT}"`,
        { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
      );
    }).not.toThrow();
  });

  it('非 sprints/ 路径变更 → gate 放行（不误报）', () => {
    expect(() => {
      execSync(
        `printf "packages/brain/src/server.js\\n" | node "${GATE_SCRIPT}"`,
        { cwd: WORKSPACE_ROOT, encoding: 'utf8' }
      );
    }).not.toThrow();
  });
});
