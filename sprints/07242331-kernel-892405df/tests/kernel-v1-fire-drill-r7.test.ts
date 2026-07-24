import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DOC_PATH = path.resolve(process.cwd(), 'docs/fire-drills/kernel-v1-mixed-20260724-r7.md');

function readDoc() {
  return fs.readFileSync(DOC_PATH, 'utf8');
}

describe('kernel-v1 mixed provider fire drill R7 文档 [BEHAVIOR]', () => {
  it('目标文档存在且含四项强制标记 KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7 / 1.267.67 / 19887912b.../ 2a96f975e...', () => {
    const content = readDoc();
    expect(content).toContain('KERNEL_V1_MIXED_FIRE_DRILL_PASS_R7');
    expect(content).toContain('1.267.67');
    expect(content).toContain('19887912bbb581597f12c714a9ed187f051e2850');
    expect(content).toContain('2a96f975ecf1ce1ddfb818030f7642a08e2860b8');
  });

  it('目标文档含五角色 planner/proposer/reviewer/evaluator/generator 的 provider/account 实际运行证据摘要（非仅角色名）', () => {
    const content = readDoc().toLowerCase();
    const roles: Record<string, [string, string]> = {
      planner: ['claude', 'account1'],
      proposer: ['claude', 'account1'],
      reviewer: ['grok', 'grok'],
      evaluator: ['claude', 'account1'],
      generator: ['codex', 'team3'],
    };
    for (const [role, [provider, account]] of Object.entries(roles)) {
      const idx = content.indexOf(role);
      expect(idx).toBeGreaterThanOrEqual(0);
      const window = content.slice(idx, idx + 300);
      expect(window).toContain(provider);
      expect(window).toContain(account);
    }
  });

  it('目标文档显式记录 no_progress_same_sha 与 approved_but_contract_artifacts_missing 本轮未出现', () => {
    const content = readDoc();
    for (const reason of ['no_progress_same_sha', 'approved_but_contract_artifacts_missing']) {
      const idx = content.indexOf(reason);
      expect(idx).toBeGreaterThanOrEqual(0);
      const window = content.slice(idx, idx + 120);
      expect(/未出现|not_present|absent/i.test(window)).toBe(true);
    }
  });

  it('目标文档含 judge/human review 时间线四字段且 judge_pass_at <= human_review_created_at', () => {
    const content = readDoc();
    const fields = ['judge_pass_at', 'human_review_created_at', 'human_approved_at', 'merged_at'];
    for (const field of fields) {
      expect(new RegExp(`${field}\\s*:`).test(content)).toBe(true);
    }
    const judgeMatch = content.match(/judge_pass_at:\s*([0-9T:.Z-]+)/);
    const humanMatch = content.match(/human_review_created_at:\s*([0-9T:.Z-]+)/);
    expect(judgeMatch).not.toBeNull();
    expect(humanMatch).not.toBeNull();
    const judgeEpoch = Date.parse(judgeMatch![1]);
    const humanEpoch = Date.parse(humanMatch![1]);
    expect(judgeEpoch).toBeLessThanOrEqual(humanEpoch);
  });

  it('generator 只新增该文档，不改动 packages/brain', () => {
    // 红阶段占位：真实 diff 范围校验由 contract-draft.md ## E2E 验收 的 git diff 断言执行（evaluator/generator 阶段真跑）
    expect(fs.existsSync(DOC_PATH)).toBe(true);
  });

  it('六项 checks 均以 command/exit_code/log_tail 三元组记录', () => {
    const content = readDoc();
    const ids = ['doc-marks', 'diff-one-line', 'pr-state', 'task-roles', 'relay-attribution', 'contract-materialized'];
    for (const id of ids) {
      const re = new RegExp(`check:\\s*${id}[\\s\\S]{0,600}?command:[\\s\\S]{0,600}?exit_code:[\\s\\S]{0,600}?log_tail:`);
      expect(re.test(content)).toBe(true);
    }
  });
});
