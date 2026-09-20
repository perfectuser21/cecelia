// G5「管家 · 算力与基础设施调度」步骤 1「接单即选到有额度的执行体」
// —— 边：配额账本 → kernel 派发的账号闸
//
// 本文件真 import 被改的流水线模块，不 vi.mock 它们（CI 闸 lint-gp-anchor-artifact）。
// ⚠️ 禁止出现任何以 `run` 结尾的 mock 路径：本刀会改 run.js，闸的 MOD_BASES 会带上
//    基名 `run`，其 mock 检测正则会把 vi.mock('.../dry-run.js') 误判成「把边 mock 掉」。
import { describe, it, expect } from 'vitest';
import {
  MODEL_ACCOUNTS,
  runtimeToLedgerAccountId,
  ledgerToRuntimeAccountId,
} from '../../../packages/brain/src/ops-model-accounts-collector.js';
import { listVerifiedExecutionTargets } from '../../../packages/brain/src/orchestrator/preflight/execution-targets.js';

describe('账号 id 映射：候选池与配额账本必须一一对上', () => {
  it('每条 MODEL_ACCOUNTS 都带显式 runtime_account_id（禁拼串规则）', () => {
    for (const acct of MODEL_ACCOUNTS) {
      expect(typeof acct.runtime_account_id).toBe('string');
      expect(acct.runtime_account_id.length).toBeGreaterThan(0);
    }
  });

  it('grok 是拼串规则的反例——它证明了为什么必须用显式字段', () => {
    const grok = MODEL_ACCOUNTS.find((a) => a.provider === 'grok');
    expect(grok.account_id).toBe('grok');
    expect(grok.runtime_account_id).toBe('grok');
    expect(`${grok.provider}-${grok.runtime_account_id}`).not.toBe(grok.account_id);
  });

  it('候选池里每个 account 都能映射到一条账本行', () => {
    const ledgerIds = new Set(MODEL_ACCOUNTS.map((a) => a.account_id));
    for (const target of listVerifiedExecutionTargets()) {
      const ledgerId = runtimeToLedgerAccountId(target.account);
      expect(ledgerId, `候选 ${target.provider}:${target.account} 映射不到账本行`).toBeTruthy();
      expect(ledgerIds.has(ledgerId)).toBe(true);
    }
  });

  it('账本每行都能反查回候选池用的运行时 id', () => {
    const runtimeIds = new Set(listVerifiedExecutionTargets().map((t) => t.account));
    for (const acct of MODEL_ACCOUNTS) {
      expect(ledgerToRuntimeAccountId(acct.account_id)).toBe(acct.runtime_account_id);
      expect(runtimeIds.has(acct.runtime_account_id)).toBe(true);
    }
  });

  it('未知 id 返回 null，不抛也不瞎猜', () => {
    expect(runtimeToLedgerAccountId('team99')).toBeNull();
    expect(ledgerToRuntimeAccountId('codex-team99')).toBeNull();
    expect(runtimeToLedgerAccountId(null)).toBeNull();
  });
});
