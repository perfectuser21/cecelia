/**
 * executor-contracts-kernel-process.test.js —— kernel-process 执行者合同（刀1/刀2）
 *
 * 背景：EXECUTOR_KIND_FOR 把 harness_initiative / golden_path_proposal 硬编码成
 * relay-container，于是所有 harness_runtime='kernel-v1' 的任务都被打成 relay-container，
 * 探活走 `docker ps --filter name=cecelia-relay-*` —— Kernel v1 没有容器，恒 dead。
 *
 * 本组测试锁三件事：
 *   1. 常量 EXECUTOR_KIND_FOR 形态不变（多处 import，不能改成函数）
 *   2. 新增解析函数按 payload.harness_runtime 分派
 *   3. kernel-process 合同不比 relay-container 更容易被杀（onStale 保守）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  EXECUTOR_KIND_FOR,
  EXECUTOR_CONTRACTS,
  VALID_EXECUTOR_KINDS,
  KERNEL_EXECUTOR_KIND,
  resolveExecutorKind,
  resolveLivenessKind,
  assessTaskLiveness,
} from '../executor-contracts.js';

const KERNEL_TASK_ID = '51836fb2-10ea-48eb-97b2-c324df32d147';

function kernelTask(over = {}) {
  return {
    id: KERNEL_TASK_ID,
    task_type: 'harness_initiative',
    payload: { harness_runtime: 'kernel-v1' },
    ...over,
  };
}

function poolWithRun(row) {
  return {
    query: vi.fn(async (sql) => (
      /FROM initiative_runs/.test(String(sql)) ? { rows: row ? [row] : [] } : { rows: [] }
    )),
  };
}

describe('EXECUTOR_KIND_FOR 常量形态不变（回归锁：多处 import 依赖它是纯对象）', () => {
  it('仍是对象，旧映射一字不动', () => {
    expect(typeof EXECUTOR_KIND_FOR).toBe('object');
    expect(EXECUTOR_KIND_FOR.harness_initiative).toBe('relay-container');
    expect(EXECUTOR_KIND_FOR.golden_path_proposal).toBe('relay-container');
    expect(EXECUTOR_KIND_FOR.dev).toBe('brain-local');
    expect(EXECUTOR_KIND_FOR.__bridge_path).toBe('bridge');
  });
});

describe('resolveExecutorKind — 打标点按 harness_runtime 分派', () => {
  it('harness_initiative + kernel-v1 → kernel-process', () => {
    expect(resolveExecutorKind(kernelTask())).toBe('kernel-process');
  });

  it('golden_path_proposal + kernel-v1 → kernel-process', () => {
    expect(resolveExecutorKind(kernelTask({ task_type: 'golden_path_proposal' }))).toBe('kernel-process');
  });

  it('回归锁:同 task_type 但无 kernel-v1 → 仍是 relay-container', () => {
    expect(resolveExecutorKind({ task_type: 'harness_initiative', payload: {} })).toBe('relay-container');
    expect(resolveExecutorKind({ task_type: 'harness_initiative' })).toBe('relay-container');
  });

  it('回归锁:非 relay-container 家族不被 kernel-v1 标记劫持', () => {
    expect(resolveExecutorKind({ task_type: 'dev', payload: { harness_runtime: 'kernel-v1' } })).toBe('brain-local');
    expect(resolveExecutorKind({ task_type: 'content-pipeline', payload: { harness_runtime: 'kernel-v1' } })).toBe('external-worker');
  });

  it('未知 task_type → null（保持"无映射"语义，调用方自行兜底）', () => {
    expect(resolveExecutorKind({ task_type: 'no_such_type' })).toBe(null);
  });
});

describe('resolveLivenessKind — 库里存量已被误标 relay-container 也要救回来', () => {
  it('DB executor_kind=relay-container 但 payload 是 kernel-v1 → 判活按 kernel-process 走', () => {
    expect(resolveLivenessKind(kernelTask({ executor_kind: 'relay-container' }))).toBe('kernel-process');
  });

  it('DB executor_kind 为空 + kernel-v1 → kernel-process', () => {
    expect(resolveLivenessKind(kernelTask())).toBe('kernel-process');
  });

  it('回归锁:旧 relay 任务 executor_kind 原样返回', () => {
    expect(resolveLivenessKind({ task_type: 'harness_initiative', executor_kind: 'relay-container', payload: {} }))
      .toBe('relay-container');
    expect(resolveLivenessKind({ executor_kind: 'headed-session' })).toBe('headed-session');
    expect(resolveLivenessKind({})).toBe(null);
  });
});

describe('kernel-process 合同：不比 relay-container 更容易被杀', () => {
  it('登记进 VALID_EXECUTOR_KINDS 且常量导出', () => {
    expect(KERNEL_EXECUTOR_KIND).toBe('kernel-process');
    expect(VALID_EXECUTOR_KINDS).toContain('kernel-process');
  });

  it('onStale=reignite + staleMinutes=null —— 与 relay-container 同等保守（zombie-reaper/healing 都跳过）', () => {
    const kernel = EXECUTOR_CONTRACTS['kernel-process'];
    const relay = EXECUTOR_CONTRACTS['relay-container'];
    expect(kernel.onStale).toBe('reignite');
    expect(kernel.staleMinutes).toBe(null);
    expect(kernel.onStale).toBe(relay.onStale);
    expect(kernel.staleMinutes).toBe(relay.staleMinutes);
  });

  it('probe 心跳新鲜 → alive，且绝不执行 docker 命令', async () => {
    const pool = poolWithRun({ orchestrator_heartbeat_at: new Date().toISOString(), orchestrator_pid: null, orchestrator_host: null });
    const verdict = await EXECUTOR_CONTRACTS['kernel-process'].probe(kernelTask(), { pool });
    expect(verdict).toBe('alive');
  });

  it('probe 拿不到 run 行 → unknown（fail-open，不是 dead）', async () => {
    const verdict = await EXECUTOR_CONTRACTS['kernel-process'].probe(kernelTask(), { pool: poolWithRun(null) });
    expect(verdict).toBe('unknown');
  });

  it('probe 无 pool 可用 → unknown（fail-open）', async () => {
    const verdict = await EXECUTOR_CONTRACTS['kernel-process'].probe(kernelTask(), { pool: null, allowDefaultPool: false });
    expect(verdict).toBe('unknown');
  });
});

describe('assessTaskLiveness — 存量被误标的 kernel 任务不再被 docker 判死', () => {
  it('executor_kind=relay-container + kernel-v1 + 心跳新鲜 → alive，kind 报 kernel-process', async () => {
    const pool = poolWithRun({ orchestrator_heartbeat_at: new Date().toISOString(), orchestrator_pid: null, orchestrator_host: null });
    const r = await assessTaskLiveness(
      kernelTask({ executor_kind: 'relay-container', updated_at: new Date(Date.now() - 3 * 3600e3).toISOString() }),
      { pool }
    );
    expect(r.kind).toBe('kernel-process');
    expect(r.verdict).toBe('alive');
  });

  it('kernel run 查不到 → unknown + onStale 仍是 reignite（不被 reaper 处置）', async () => {
    const r = await assessTaskLiveness(
      kernelTask({ executor_kind: 'relay-container' }),
      { pool: poolWithRun(null) }
    );
    expect(r.verdict).toBe('unknown');
    expect(r.onStale).toBe('reignite');
  });
});
