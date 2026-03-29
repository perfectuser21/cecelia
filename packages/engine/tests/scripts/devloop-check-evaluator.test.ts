import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 条件 4.5: playwright_evaluator_status（seal 文件验证）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('包含条件 4.5 注释标记', () => {
    expect(content).toContain('条件 4.5: playwright_evaluator_status');
  });

  it('包含 playwright_evaluator_status 字段读取', () => {
    expect(content).toContain('playwright_evaluator_status');
    expect(content).toContain('grep "^playwright_evaluator_status:"');
  });

  it('包含 .dev-gate-evaluator seal 文件路径', () => {
    expect(content).toContain('.dev-gate-evaluator.');
  });

  it('seal 文件验证使用 jq 读取 verdict', () => {
    const idx = content.indexOf('===== 条件 4.5: playwright_evaluator_status');
    expect(idx).toBeGreaterThan(-1);
    const section = content.substring(idx, idx + 2000);
    expect(section).toContain('verdict');
    expect(section).toContain('jq -r');
  });

  it('seal FAIL 时返回 blocked', () => {
    const idx = content.indexOf('===== 条件 4.5: playwright_evaluator_status');
    expect(idx).toBeGreaterThan(-1);
    const section = content.substring(idx, idx + 2000);
    expect(section).toContain('"FAIL"');
    expect(section).toContain('blocked');
    expect(section).toContain('playwright_evaluator');
  });

  it('自认证检测：无 seal 文件但 .dev-mode 有 pass → blocked', () => {
    const idx = content.indexOf('===== 条件 4.5: playwright_evaluator_status');
    expect(idx).toBeGreaterThan(-1);
    const section = content.substring(idx, idx + 2000);
    // 检查自认证检测逻辑
    expect(section).toContain('pass');
    expect(section).toContain('自认证');
  });

  it('条件 4.5 位于条件 4（CI）和条件 5（PR merged）之间', () => {
    const ci_idx = content.indexOf('===== 条件 4: CI 状态');
    const eval_idx = content.indexOf('===== 条件 4.5: playwright_evaluator_status');
    const pr_merged_idx = content.indexOf('===== 条件 5: PR 是否已合并');

    expect(ci_idx).toBeGreaterThan(-1);
    expect(eval_idx).toBeGreaterThan(-1);
    expect(pr_merged_idx).toBeGreaterThan(-1);

    // 顺序：CI(4) < evaluator(4.5) < PR merged(5)
    expect(eval_idx).toBeGreaterThan(ci_idx);
    expect(eval_idx).toBeLessThan(pr_merged_idx);
  });
});

describe('devloop-check.sh — 现有条件未被破坏', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('条件 1: step_1_spec 检查仍存在', () => {
    expect(content).toContain('条件 1: step_1_spec');
  });

  it('条件 1.5: spec_review_status 检查仍存在', () => {
    expect(content).toContain('条件 1.5: spec_review_status');
  });

  it('条件 2: step_2_code 检查仍存在', () => {
    expect(content).toContain('条件 2: step_2_code');
  });

  it('条件 2.5: code_review_gate_status 检查仍存在', () => {
    expect(content).toContain('条件 2.5: code_review_gate_status');
  });

  it('条件 2.6: DoD 完整性检查仍存在', () => {
    expect(content).toContain('条件 2.6: DoD 完整性检查');
  });

  it('条件 2.7: drift check 仍存在', () => {
    expect(content).toContain('条件 2.7: drift check');
  });

  it('条件 3: PR 创建检查仍存在', () => {
    expect(content).toContain('条件 3: PR 是否已创建');
  });

  it('条件 4: CI 状态检查仍存在', () => {
    expect(content).toContain('条件 4: CI 状态');
  });

  it('条件 5: PR 合并检查仍存在', () => {
    expect(content).toContain('条件 5: PR 是否已合并');
  });

  it('cleanup_done 终止条件仍存在', () => {
    expect(content).toContain('cleanup_done');
  });

  it('devloop_check 函数签名不变', () => {
    expect(content).toContain('devloop_check()');
  });
});

describe('devloop-check.sh — seal 文件模式一致性', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('条件 4.5 与条件 1.5 使用相同的 seal 验证模式', () => {
    // 条件 1.5 的 seal 模式
    const spec_idx = content.indexOf('===== 条件 1.5: spec_review_status');
    const spec_section = content.substring(spec_idx, spec_idx + 2000);

    // 条件 4.5 的 seal 模式
    const eval_idx = content.indexOf('===== 条件 4.5: playwright_evaluator_status');
    const eval_section = content.substring(eval_idx, eval_idx + 2000);

    // 两者都使用 jq -r '.verdict' 读取
    expect(spec_section).toContain("jq -r '.verdict");
    expect(eval_section).toContain("jq -r '.verdict");

    // 两者都检查 FAIL verdict
    expect(spec_section).toContain('"FAIL"');
    expect(eval_section).toContain('"FAIL"');

    // 两者都有自认证检测
    expect(spec_section).toContain('自认证');
    expect(eval_section).toContain('自认证');
  });
});
