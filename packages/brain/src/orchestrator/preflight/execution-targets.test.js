import { describe, expect, it } from 'vitest';

import {
  expandUnresolvedAccountTargets,
  isVerifiedExecutionTarget,
  listVerifiedExecutionTargets,
} from './execution-targets.js';

describe('ExecutionTarget matrix', () => {
  it('只放行 18 个已验证 provider/account/machine 组合', () => {
    const targets = listVerifiedExecutionTargets();
    expect(targets).toHaveLength(18);
    expect(targets.every(isVerifiedExecutionTarget)).toBe(true);
    expect(isVerifiedExecutionTarget({
      provider: 'claude',
      account: 'account1',
      machine: 'xian-mac-m4',
    })).toBe(false);
  });
});

describe('expandUnresolvedAccountTargets', () => {
  // run c06b79af 案卷：dispatcher 构造 target 时 account=null，
  // claude::us-mac-m4 不在白名单 → 候选零探针跳过 → all_execution_targets_exhausted。
  it('account 为空的候选按 provider+machine 展开为白名单具体账号', () => {
    const expanded = expandUnresolvedAccountTargets([
      { provider: 'claude', account: null, machine: 'us-mac-m4' },
    ]);
    expect(expanded).toEqual([
      { provider: 'claude', account: 'account1', machine: 'us-mac-m4' },
      { provider: 'claude', account: 'account2', machine: 'us-mac-m4' },
    ]);
    expect(expanded.every(isVerifiedExecutionTarget)).toBe(true);
  });

  it('显式指定 account 的候选原样保留且不重复展开', () => {
    const expanded = expandUnresolvedAccountTargets([
      { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
      { provider: 'codex', account: null, machine: 'us-mac-m4' },
    ]);
    expect(expanded[0]).toEqual(
      { provider: 'codex', account: 'team2', machine: 'us-mac-m4' },
    );
    // null 展开出 team1..team5，但 team2 已显式在前，不重复出现
    expect(expanded.filter((t) => t.account === 'team2')).toHaveLength(1);
    expect(expanded.map((t) => t.account)).toEqual(
      ['team2', 'team1', 'team3', 'team4', 'team5'],
    );
  });

  it('白名单外的 provider/machine 组合展开为空并原样丢弃', () => {
    const expanded = expandUnresolvedAccountTargets([
      { provider: 'claude', account: null, machine: 'xian-mac-m4' },
    ]);
    expect(expanded).toEqual([]);
  });

  it('保留 model 等附加字段', () => {
    const expanded = expandUnresolvedAccountTargets([
      { provider: 'grok', account: null, machine: 'us-mac-m4', model: 'grok-4' },
    ]);
    expect(expanded).toEqual([
      { provider: 'grok', account: 'grok', machine: 'us-mac-m4', model: 'grok-4' },
    ]);
  });
});

