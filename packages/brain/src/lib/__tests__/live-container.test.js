/**
 * live-container.js — 活容器探测单测。
 *
 * evaluate 重入幂等：spawn 前查同 (task, fix_round) 是否已有活容器，有则复用、跳过重 spawn。
 * 覆盖：docker ps 命中前缀 → 返回容器名；空 → null；异前缀过滤；execFile 注入。
 */
import { describe, it, expect, vi } from 'vitest';
import { findLiveEvaluateContainer } from '../live-container.js';

const PREFIX = 'harness-evaluate-task123-r4-';

describe('findLiveEvaluateContainer', () => {
  it('docker ps 命中同前缀活容器 → 返回该容器名供复用', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: `${PREFIX}live9999\n` });
    const r = await findLiveEvaluateContainer(PREFIX, { execFile });
    expect(r).toBe(`${PREFIX}live9999`);
    // 用 docker ps name 前缀过滤
    expect(execFile).toHaveBeenCalledWith(
      'docker',
      ['ps', '--filter', `name=${PREFIX}`, '--format', '{{.Names}}'],
      expect.objectContaining({ timeout: 10_000 })
    );
  });

  it('无活容器 → null（首次进入，正常 spawn）', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: '\n' });
    expect(await findLiveEvaluateContainer(PREFIX, { execFile })).toBeNull();
  });

  it('多个命中 → 返回第一个', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: `${PREFIX}aaaa\n${PREFIX}bbbb\n` });
    expect(await findLiveEvaluateContainer(PREFIX, { execFile })).toBe(`${PREFIX}aaaa`);
  });

  it('docker 返回异前缀（不同 round/类型）→ 过滤掉，null', async () => {
    const execFile = vi.fn().mockResolvedValue({
      stdout: 'harness-evaluate-task123-r0-old\nharness-generate-task123-x\n',
    });
    expect(await findLiveEvaluateContainer(PREFIX, { execFile })).toBeNull();
  });

  it('stdout 空/undefined → null（不抛）', async () => {
    const execFile = vi.fn().mockResolvedValue({ stdout: undefined });
    expect(await findLiveEvaluateContainer(PREFIX, { execFile })).toBeNull();
  });

  it('execFile 抛错 → 向上抛（由 caller fail-open 处理）', async () => {
    const execFile = vi.fn().mockRejectedValue(new Error('docker daemon down'));
    await expect(findLiveEvaluateContainer(PREFIX, { execFile })).rejects.toThrow('docker daemon down');
  });
});
