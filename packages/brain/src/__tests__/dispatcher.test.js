/**
 * dispatcher.test.js — 1:1 单测 stub（lint-test-pairing 要求精确名匹配）
 *
 * 实际功能 test 在 dispatcher-default-graph / dispatcher-initiative-lock /
 * dispatcher-quota-cooling.test.js + initiative-lock.test.js（mock query 验 SQL）。
 * 本文件仅为满足 lint-test-pairing 命名约束（每 src 文件对应同名 test）。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));

describe('dispatcher.js — module load smoke', () => {
  it('import dispatchNextTask 不抛', async () => {
    const mod = await import('../dispatcher.js');
    expect(typeof mod.dispatchNextTask).toBe('function');
  });

});
