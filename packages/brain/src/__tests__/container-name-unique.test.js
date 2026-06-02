/**
 * 回归：容器名必须唯一（含随机后缀），根除同 task 多轮 GAN 容器撞名（exit 125）。
 * 之前容器名只按 taskId 算（cecelia-task-{id}），同 task 每轮复用同名 + --rm 异步删除
 * → 撞名 125 → proposer 没启动；为修 125 加的 rm -f 又误杀活容器（137）。
 * 根治：容器名加唯一后缀，名字互不相同，不撞名，无需 cleanup。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import * as dockerExecutor from '../docker-executor.js';

describe('容器名唯一化（根除 exit 125 撞名 / 137 误杀）', () => {
  const containerName = dockerExecutor.__test__.containerName;

  it('前缀稳定 cecelia-task-{taskId12}（quarantine 前缀匹配契约）', () => {
    expect(containerName('39c1c97e-4fbf-46bf-a686-x')).toMatch(/^cecelia-task-39c1c97e4fbf-/);
  });

  it('同 taskId 多次调用名字唯一（不再撞名）', () => {
    const names = new Set(Array.from({ length: 20 }, () => containerName('t-abc-def')));
    expect(names.size).toBe(20);
  });

  it('docker name 长度合法（≤63）', () => {
    expect(containerName('39c1c97e-4fbf-46bf-a686-cdac9c40c3c8').length).toBeLessThanOrEqual(63);
  });

  it('GAN 图已删除 docker rm 清理 hack（唯一名后不需要，且 rm -f 会误杀活容器）', () => {
    const src = readFileSync(new URL('../workflows/harness-gan.graph.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/cleanupContainer/);
    expect(src).not.toMatch(/\['rm',\s*'-f'/);
    expect(src).not.toMatch(/spawnProc/);
  });

  it('quarantine.hasActiveContainer 用前缀匹配（容器名带后缀仍能命中）', () => {
    const src = readFileSync(new URL('../quarantine.js', import.meta.url), 'utf8');
    expect(src).toMatch(/startsWith\(`?\$\{expectedName\}-`?\)/);
  });
});
