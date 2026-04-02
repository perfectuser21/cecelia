import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

/**
 * devloop-check.sh — check_divergence_count 门禁测试
 *
 * 验证 check_divergence_count 函数的语义：
 * - divergence_count=0：Evaluator 橡皮图章，返回非零（拒绝）
 * - divergence_count>=1：Evaluator 真正独立，返回 0（通过）
 */

const DEVLOOP_CHECK = resolve(__dirname, '../../../../packages/engine/lib/devloop-check.sh');

// v16.0.0: divergence_count 门禁已删除（Engine重构）
describe.skip('devloop-check.sh — check_divergence_count 函数', () => {
  it('A1: devloop-check.sh 文件必须存在', () => {
    expect(existsSync(DEVLOOP_CHECK), `${DEVLOOP_CHECK} 应存在`).toBe(true);
  });

  it('A2: 文件中必须包含 check_divergence_count 函数定义', () => {
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('check_divergence_count()');
  });

  it('A3: 文件中必须有 divergence_count 门禁调用逻辑', () => {
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('check_divergence_count');
    // 确保在 spec_review 后调用
    expect(content).toContain('spec_seal_divergence');
  });

  it('A4: check_divergence_count 0 → 返回非零（橡皮图章被拒绝）', () => {
    const script = `
      source "${DEVLOOP_CHECK}"
      check_divergence_count 0
      exit $?
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
  });

  it('A5: check_divergence_count 1 → 返回 0（独立思考通过）', () => {
    const script = `
      source "${DEVLOOP_CHECK}"
      check_divergence_count 1
      exit $?
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('A6: check_divergence_count 5 → 返回 0（多次分歧也通过）', () => {
    const script = `
      source "${DEVLOOP_CHECK}"
      check_divergence_count 5
      exit $?
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('A7: check_divergence_count 参数缺省 → 视为 0，返回非零', () => {
    const script = `
      source "${DEVLOOP_CHECK}"
      check_divergence_count
      exit $?
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
  });

  it('A8: 现有 step_1_spec/seal 关键词仍然存在（不破坏现有功能）', () => {
    const content = readFileSync(DEVLOOP_CHECK, 'utf8');
    expect(content).toContain('step_1_spec');
    expect(content).toContain('seal');
  });
});
