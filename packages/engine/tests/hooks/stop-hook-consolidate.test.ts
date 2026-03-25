/**
 * stop-hook-consolidate.test.ts
 * 验证 stop.sh v14.2.0 — 普通对话路径触发 conversation-consolidator
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const STOP_SH = resolve(__dirname, '../../hooks/stop.sh');

describe('stop.sh v14.2.0 — consolidation 触发', () => {
  it('stop.sh 文件存在', () => {
    expect(existsSync(STOP_SH)).toBe(true);
  });

  it('包含 consolidate 端点调用', () => {
    const content = readFileSync(STOP_SH, 'utf8');
    expect(content).toContain('consolidate');
  });

  it('consolidate 调用使用 POST 方法', () => {
    const content = readFileSync(STOP_SH, 'utf8');
    expect(content).toContain('POST');
    expect(content).toContain('consolidate');
  });

  it('consolidate 调用有超时限制（max-time）', () => {
    const content = readFileSync(STOP_SH, 'utf8');
    expect(content).toContain('max-time');
  });

  it('consolidate 调用有 || true 防失败阻塞', () => {
    const content = readFileSync(STOP_SH, 'utf8');
    const consolidateSection = content.split('consolidate')[1] || '';
    // 在 consolidate 之后的区域包含 || true 或 2>&1 || true
    expect(content).toMatch(/consolidate[\s\S]*?\|\|\s*true/);
  });

  it('consolidate 在 exit 0 路径中（普通对话模式）', () => {
    const content = readFileSync(STOP_SH, 'utf8');
    // consolidate 调用应出现在 exit 0 之前
    const consolidateIdx = content.indexOf('consolidate');
    const exit0Idx = content.lastIndexOf('exit 0');
    expect(consolidateIdx).toBeGreaterThan(0);
    expect(exit0Idx).toBeGreaterThan(consolidateIdx);
  });

  it('语法检查通过', () => {
    const { execSync } = require('child_process');
    expect(() => execSync(`bash -n "${STOP_SH}"`)).not.toThrow();
  });
});
