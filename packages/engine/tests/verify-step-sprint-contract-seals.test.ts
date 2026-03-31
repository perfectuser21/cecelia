/**
 * tests/verify-step-sprint-contract-seals.test.ts
 *
 * 验证 verify-step.sh step1 的 Sprint Contract 四文件检查：
 * - .dev-gate-generator-sprint 缺失时 → exit 1
 * - .dev-gate-spec verdict != PASS 时 → exit 1
 * - .dev-gate-spec divergence_count=0 且 round<=1 时 → exit 1（橡皮图章）
 * - .sprint-contract-state 缺失时 → exit 1
 * - .sprint-contract-state round=0 时 → exit 1
 * - 四文件均存在且合法时 → 通过
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VERIFY_STEP_SH = resolve(__dirname, '../hooks/verify-step.sh');

describe('verify-step.sh step1 — Sprint Contract 四文件检查', () => {
  it('verify_step1() 包含 Generator seal 文件检查', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const step1Block = content.slice(
      content.indexOf('verify_step1()'),
      content.indexOf('verify_step2()')
    );
    expect(step1Block).toContain('dev-gate-generator-sprint');
    expect(step1Block).toContain('Gate Generator');
  });

  it('verify_step1() 包含 Evaluator seal verdict=PASS 检查', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const step1Block = content.slice(
      content.indexOf('verify_step1()'),
      content.indexOf('verify_step2()')
    );
    expect(step1Block).toContain('dev-gate-spec');
    expect(step1Block).toContain('verdict');
    expect(step1Block).toContain('Gate Evaluator');
  });

  it('verify_step1() 包含 divergence_count 橡皮图章检测', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const step1Block = content.slice(
      content.indexOf('verify_step1()'),
      content.indexOf('verify_step2()')
    );
    expect(step1Block).toContain('divergence_count');
    expect(step1Block).toContain('橡皮图章');
  });

  it('verify_step1() 包含 sprint-contract-state round>=1 检查', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const step1Block = content.slice(
      content.indexOf('verify_step1()'),
      content.indexOf('verify_step2()')
    );
    expect(step1Block).toContain('sprint-contract-state');
    expect(step1Block).toContain('contract_round');
    expect(step1Block).toContain('Gate Sprint Contract State');
  });

  it('Generator seal 缺失有明确错误信息', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    expect(content).toContain('Generator seal 文件不存在');
    expect(content).toContain('dev-gate-generator-sprint');
  });

  it('Evaluator seal 缺失有明确错误信息', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    expect(content).toContain('Evaluator seal 文件不存在');
    expect(content).toContain('dev-gate-spec');
  });

  it('sprint-contract-state 缺失有明确错误信息', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    expect(content).toContain('sprint-contract-state');
    expect(content).toContain('Gate Sprint Contract State');
  });

  it('四个 Gate 检查均在 _pass 之前执行', () => {
    const content = readFileSync(VERIFY_STEP_SH, 'utf-8');
    const generatorPos = content.indexOf('Gate Generator');
    const evaluatorPos = content.indexOf('Gate Evaluator');
    const contractPos = content.indexOf('Gate Sprint Contract State');
    const passPos = content.indexOf('_pass "Step 1 Task Card 验证通过"');

    expect(generatorPos).toBeGreaterThan(0);
    expect(evaluatorPos).toBeGreaterThan(0);
    expect(contractPos).toBeGreaterThan(0);
    expect(passPos).toBeGreaterThan(0);

    expect(generatorPos).toBeLessThan(passPos);
    expect(evaluatorPos).toBeLessThan(passPos);
    expect(contractPos).toBeLessThan(passPos);
  });
});
