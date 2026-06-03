/**
 * seed-machine-executors.mjs 幂等 upsert 逻辑单测。
 *
 * 脚本写各机器 system_registry metadata.executors（只列已部署组合）。
 * 这里测纯函数 mergeExecutorsMetadata（幂等：再跑一遍 metadata 不漂移）+ SEED_TARGETS 定义。
 * 测试放 src/routing 下（被 vitest include glob 覆盖），import 实际脚本（scripts/）。
 *
 * Spec: docs/superpowers/specs/2026-06-03-machine-executor-routing-design.md §单元1 seed
 */
import { describe, it, expect } from 'vitest';
import { SEED_TARGETS, mergeExecutorsMetadata } from '../../scripts/seed-machine-executors.mjs';

describe('seed-machine-executors SEED_TARGETS', () => {
  it('mac-mini-m4-us = [{claude, http://localhost:3457, default}]', () => {
    const t = SEED_TARGETS.find(x => x.name === 'mac-mini-m4-us');
    expect(t).toBeDefined();
    expect(t.executors).toEqual([
      { executor: 'claude', url: 'http://localhost:3457', default: true },
    ]);
  });

  it('xian-m4 = [{codex, http://host.docker.internal:13458, default}]', () => {
    const t = SEED_TARGETS.find(x => x.name === 'xian-m4');
    expect(t).toBeDefined();
    expect(t.executors).toEqual([
      { executor: 'codex', url: 'http://host.docker.internal:13458', default: true },
    ]);
  });
});

describe('mergeExecutorsMetadata 幂等', () => {
  it('把 executors 写进已有 metadata，保留其它字段', () => {
    const existing = { tailscale_ip: '1.2.3.4', tags: ['has_git', 'general'] };
    const execs = [{ executor: 'claude', url: 'http://localhost:3457', default: true }];
    const merged = mergeExecutorsMetadata(existing, execs);
    expect(merged.tailscale_ip).toBe('1.2.3.4');
    expect(merged.tags).toEqual(['has_git', 'general']);
    expect(merged.executors).toEqual(execs);
  });

  it('幂等：再跑一遍结果完全相同', () => {
    const existing = { tags: ['general'] };
    const execs = [{ executor: 'codex', url: 'u', default: true }];
    const once = mergeExecutorsMetadata(existing, execs);
    const twice = mergeExecutorsMetadata(once, execs);
    expect(twice).toEqual(once);
  });

  it('覆盖旧 executors（不追加重复）', () => {
    const existing = { executors: [{ executor: 'claude', url: 'old', default: true }] };
    const execs = [{ executor: 'claude', url: 'http://localhost:3457', default: true }];
    const merged = mergeExecutorsMetadata(existing, execs);
    expect(merged.executors).toEqual(execs);
    expect(merged.executors).toHaveLength(1);
  });

  it('null/undefined existing 当空对象处理', () => {
    const execs = [{ executor: 'codex', url: 'u', default: true }];
    expect(mergeExecutorsMetadata(null, execs).executors).toEqual(execs);
    expect(mergeExecutorsMetadata(undefined, execs).executors).toEqual(execs);
  });
});
