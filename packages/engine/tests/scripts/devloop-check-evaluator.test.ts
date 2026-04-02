import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const DEVLOOP_CHECK = path.resolve(__dirname, '../../lib/devloop-check.sh');

describe('devloop-check.sh — 条件 4.5 已移除（playwright_evaluator）', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');
  // 排除文件头部 changelog 注释
  const lines = content.split('\n');
  const codeStart = lines.findIndex((l, i) => i > 0 && !l.startsWith('#') && l.trim() !== '');
  const codeContent = lines.slice(codeStart).join('\n');

  it('不包含 playwright_evaluator_status 字段', () => {
    expect(codeContent).not.toContain('playwright_evaluator_status');
  });

  it('不包含 .dev-gate-evaluator seal 文件路径', () => {
    expect(codeContent).not.toContain('.dev-gate-evaluator.');
  });

  it('不包含条件 4.5 代码块', () => {
    expect(codeContent).not.toContain('===== 条件 4.5');
  });
});

describe('devloop-check.sh — 现有条件未被破坏', () => {
  const content = fs.readFileSync(DEVLOOP_CHECK, 'utf8');

  it('条件 1: step_1_spec 检查仍存在', () => {
    expect(content).toContain('条件 1: step_1_spec');
  });

  // v16.0.0: spec_review_status gate已删除（Engine重构）
  it.skip('条件 1.5: spec_review_status 检查仍存在', () => {
    expect(content).toContain('条件 1.5: spec_review_status');
  });

  it('条件 2: step_2_code 检查仍存在', () => {
    expect(content).toContain('条件 2: step_2_code');
  });

  // v16.0.0: code_review_gate_status gate已删除（Engine重构）
  it.skip('条件 2.5: code_review_gate_status 检查仍存在', () => {
    expect(content).toContain('条件 2.5: code_review_gate_status');
  });

  it('条件 2.6: DoD 完整性检查仍存在', () => {
    expect(content).toContain('条件 2.6: DoD 完整性检查');
  });

  // v16.0.0: drift check（条件2.7）已删除（Engine重构）
  it.skip('条件 2.7: drift check 仍存在', () => {
    expect(content).toContain('条件 2.7: drift check');
  });

  // v16.0.0: 条件文本格式已变更（Engine重构）
  it.skip('条件 3: PR 创建检查仍存在', () => {
    expect(content).toContain('条件 3: PR 是否已创建');
  });

  it('条件 4: CI 状态检查仍存在', () => {
    expect(content).toContain('条件 4: CI 状态');
  });

  // v16.0.0: 条件文本格式已变更（Engine重构）
  it.skip('条件 5: PR 合并检查仍存在', () => {
    expect(content).toContain('条件 5: PR 是否已合并');
  });

  it('cleanup_done 终止条件仍存在', () => {
    expect(content).toContain('cleanup_done');
  });

  it('devloop_check 函数签名不变', () => {
    expect(content).toContain('devloop_check()');
  });
});
