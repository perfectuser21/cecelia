/**
 * evidence.test.js — 证据留存规范配对测试(lint-test-pairing)
 * 案卷:09-05 A/B 实验截图按步号复用文件名,5 轮只剩最后一轮(r79 同类病)——
 * 文件名强制 trial+timestamp,禁覆盖。
 */
import { describe, it, expect } from 'vitest';
import { buildEvidenceFilename, parseEvidenceFilename, assertNoOverwrite } from '../evidence.js';

describe('buildEvidenceFilename / parseEvidenceFilename 往返', () => {
  it('生成名含 grid+trial+timestamp,且可被 parse 还原', () => {
    const at = new Date('2026-09-06T02:00:00.000Z');
    const name = buildEvidenceFilename({ grid: 'og3', trial: 7, at });
    expect(name).toMatch(/og3/);
    expect(name).toMatch(/7/);
    const parsed = parseEvidenceFilename(name);
    expect(parsed).toBeTruthy();
    expect(String(parsed.grid)).toBe('og3');
    expect(Number(parsed.trial)).toBe(7);
  });
  it('缺 trial/timestamp 的旧式覆盖型文件名 → 关键字段解析为 null(不可入库)', () => {
    for (const bad of ['a0.png', 'screenshot.png']) {
      const p = parseEvidenceFilename(bad);
      expect(p.trial).toBeNull();
      expect(p.timestamp).toBeNull();
    }
  });
});

describe('assertNoOverwrite 禁覆盖', () => {
  it('同名已存在 → 抛错(失败必留原因,不静默覆盖)', () => {
    const at = new Date('2026-09-06T02:00:00.000Z');
    const name = buildEvidenceFilename({ grid: 'og1', trial: 1, at });
    expect(() => assertNoOverwrite([name], name)).toThrow();
  });
  it('不同 trial 不冲突', () => {
    const at = new Date('2026-09-06T02:00:00.000Z');
    const a = buildEvidenceFilename({ grid: 'og1', trial: 1, at });
    const b = buildEvidenceFilename({ grid: 'og1', trial: 2, at });
    expect(() => assertNoOverwrite([a], b)).not.toThrow();
  });
});
