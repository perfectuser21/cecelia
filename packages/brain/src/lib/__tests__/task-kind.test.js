/**
 * 任务类型模型收敛·第一刀（决策 df67a9d6 / e073bdc2，任务 94465721）：
 * kind ∈ {agent, workflow} 是任务的第一维度，注册表每个 task_type 必须显式落一个；
 * 建单入口校验 kind，未声明类型按注册表的缺省规则派生。
 */
import { describe, it, expect } from 'vitest';
import * as R from '../task-type-registry.js';
import {
  TASK_KINDS,
  deriveTaskKind,
  assertTaskKind,
  isTaskKind,
} from '../task-kind.js';

describe('TASK_KINDS 枚举', () => {
  it('只有 agent / workflow 两种，冻结', () => {
    expect([...TASK_KINDS]).toEqual(['agent', 'workflow']);
    expect(Object.isFrozen(TASK_KINDS)).toBe(true);
    expect(R.TASK_KINDS).toBe(TASK_KINDS);
  });
});

describe('注册表每个 task_type 都声明 kind', () => {
  it('含虚拟类型在内，每条 entry.kind ∈ TASK_KINDS', () => {
    const entries = Object.entries(R.TASK_TYPE_REGISTRY);
    expect(entries.length).toBeGreaterThan(0);
    for (const [type, entry] of entries) {
      expect(TASK_KINDS.includes(entry.kind), `${type} 的 kind=${entry.kind} 不合法`).toBe(true);
    }
  });

  it('KIND_FOR_TASK_TYPE 覆盖全部类型，且与 entry.kind 一致', () => {
    const types = Object.keys(R.TASK_TYPE_REGISTRY);
    expect(Object.keys(R.KIND_FOR_TASK_TYPE).sort()).toEqual([...types].sort());
    for (const type of types) {
      expect(R.KIND_FOR_TASK_TYPE[type]).toBe(R.TASK_TYPE_REGISTRY[type].kind);
    }
    expect(Object.isFrozen(R.KIND_FOR_TASK_TYPE)).toBe(true);
  });

  it('编排型（≥2 阶段/子任务）= workflow，一步交付 = agent（判据钉死代表类型）', () => {
    for (const t of ['workflow_dispatch', 'workflow_run', 'crystallize', 'project']) {
      expect(R.KIND_FOR_TASK_TYPE[t], t).toBe('workflow');
    }
    for (const t of ['dev', 'research', 'qiumi_task', 'device_job', 'codex_dev', 'ci_patrol', 'crystallize_forge']) {
      expect(R.KIND_FOR_TASK_TYPE[t], t).toBe('agent');
    }
  });

  it('WORKFLOW_KIND_TASK_TYPES 由现役注册表的DB workflow类型派生', () => {
    const expected = Object.entries(R.TASK_TYPE_REGISTRY)
      .filter(([, e]) => e.db && e.kind === 'workflow')
      .map(([k]) => k);
    expect([...R.WORKFLOW_KIND_TASK_TYPES]).toEqual(expected);
    expect(R.WORKFLOW_KIND_TASK_TYPES.length).toBeGreaterThan(0);
    for (const t of R.WORKFLOW_KIND_TASK_TYPES) {
      expect(R.DB_WHITELISTED_TASK_TYPES).toContain(t);
    }
  });
});

describe('deriveTaskKind / assertTaskKind', () => {
  it('已注册类型按注册表；未知类型回落 agent（单步是默认，与 Jev 缺省一致）', () => {
    expect(deriveTaskKind('workflow_run')).toBe('workflow');
    expect(deriveTaskKind('dev')).toBe('agent');
    expect(deriveTaskKind('never_registered_type')).toBe('agent');
    expect(deriveTaskKind(null)).toBe('agent');
  });

  it('isTaskKind 严格：大小写/空串/非字符串一律 false', () => {
    expect(isTaskKind('agent')).toBe(true);
    expect(isTaskKind('workflow')).toBe(true);
    for (const bad of ['Agent', '', 'script', null, undefined, 1, {}]) {
      expect(isTaskKind(bad), String(bad)).toBe(false);
    }
  });

  it('assertTaskKind 非法值抛 code=invalid_task_kind，合法值原样返回', () => {
    expect(assertTaskKind('workflow')).toBe('workflow');
    for (const bad of ['script', '', 'AGENT', 0]) {
      let err;
      try { assertTaskKind(bad); } catch (e) { err = e; }
      expect(err?.code, String(bad)).toBe('invalid_task_kind');
      expect(err.message).toContain('agent');
    }
  });
});
