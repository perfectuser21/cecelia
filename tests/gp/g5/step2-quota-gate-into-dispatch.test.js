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
import { createCapabilityGate } from '../../../packages/brain/src/orchestrator/preflight/capability-gate.js';

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

// 候选必须落在 execution-targets 白名单里，否则会被零探针跳过（run c06b79af 案卷）。
// 机器名从白名单现取，不硬编码——白名单换机器时测试跟着走。
const PRIMARY_MACHINE = listVerifiedExecutionTargets()
  .find((t) => t.provider === 'claude').machine;
const T = (provider, account, machine = PRIMARY_MACHINE) => ({ provider, account, machine });

function gateDeps(over = {}) {
  return {
    probeTimeoutMs: 25_000,
    getMachineHealth: async () => ({ ok: true }),
    getMachineCapacity: async () => ({ ok: true, available: 4 }),
    probeProviderAuth: async () => ({ ok: true }),
    recordDecision: async () => {},
    emitAlert: async () => {},
    ...over,
  };
}
const REQ = { requirements: { provider_auth: true } };

describe('capability-gate 接入配额判据', () => {
  it('unusable 的候选被跳过，选中下一个', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 93 }
        : { verdict: 'usable', reason: 'within_budget', pct: 10 }),
    };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');
  });

  it('unknown 的候选放行，但 evidence 记 degraded', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'unknown', reason: 'pct_unknown', pct: null }) };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('codex', 'team1'),
      candidate_targets: [T('codex', 'team1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.evidence.quota_abstained).toEqual(
      expect.arrayContaining([expect.objectContaining({ account: 'team1', reason: 'pct_unknown' })]),
    );
  });

  it('判据抛错 ≠ 静默放行——必须留痕并告警（变异靶点）', async () => {
    const alerts = [];
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => { throw new Error('boom'); },
      emitAlert: async (a) => { alerts.push(a); },
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.evidence.account_quota_gate_error).toBeTruthy();
    expect(alerts.map((a) => a.kind)).toContain('kernel_account_quota_gate_degraded');
  });

  it('未注入 loadAccountQuota 时行为不变（向后兼容）', async () => {
    const gate = createCapabilityGate(gateDeps());
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
  });

  it('每个候选的判死原因都进 evidence（不再被单变量覆盖）', async () => {
    const reasons = { account1: 'seven_day_exhausted', account2: 'five_hour_exhausted' };
    const snap = {
      degraded: false,
      verdictFor: (a) => ({ verdict: 'unusable', reason: reasons[a], pct: a === 'account1' ? 93 : 97 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      probeProviderAuth: async () => ({ ok: false, signature: 'x' }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    const listed = (r.evidence.quota_unusable ?? []).map((x) => `${x.account}:${x.reason}`);
    expect(listed).toEqual(expect.arrayContaining(['account1:seven_day_exhausted', 'account2:five_hour_exhausted']));
  });

  // 拍板依赖这条链：ops_model_accounts 没有 capped/authFailed 列，
  // isSpendingCapped/isAuthFailed 是真撞 429 后由回调打上的内存标记。
  // 用表判据「替换」而不是「OR」内存标记 = 把 NULL 情形的兜底摘掉。
  it('表说可用但内存标记说不可用 → 判死（两判据取 OR）', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'usable', reason: 'within_budget', pct: 5 }) };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      isAccountUsable: async (a) => a !== 'account1',
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');
    expect((r.evidence.quota_unusable ?? []).map((x) => x.reason)).toContain('runtime_marker');
  });

  it('表说不可用但内存标记说可用 → 仍判死（OR 的另一半）', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 93 }
        : { verdict: 'usable', reason: 'within_budget', pct: 5 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      isAccountUsable: async () => true,
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.to_target.account).toBe('account2');
  });
});

// 取两台不同的白名单机器（codex 在所有计算机器上都有候选）
const MACHINES = [...new Set(listVerifiedExecutionTargets().map((t) => t.machine))];

describe('全灭保底放行', () => {
  it('全判死 → 放行 pct 最低的那个，并标 degraded + 告警', async () => {
    const pct = { account1: 97, account2: 92, team1: 99 };
    const snap = {
      degraded: false,
      verdictFor: (a) => ({ verdict: 'unusable', reason: 'seven_day_exhausted', pct: pct[a] }),
    };
    const alerts = [];
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      emitAlert: async (a) => { alerts.push(a); },
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2'), T('codex', 'team1')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');              // pct 最低
    expect(r.fallback_reason).toBe('account_quota_degraded_admit');
    expect(alerts.map((a) => a.kind)).toContain('kernel_account_quota_all_exhausted');
  });

  it('凭据失效的号不进保底候选（跑 providerAuth 必然失败，白耗探针）', async () => {
    const snap = {
      degraded: false,
      verdictFor: (a) => (a === 'account1'
        ? { verdict: 'unusable', reason: 'credential_invalid', pct: 1 }
        : { verdict: 'unusable', reason: 'seven_day_exhausted', pct: 95 }),
    };
    const gate = createCapabilityGate(gateDeps({ loadAccountQuota: async () => snap }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1'), T('claude', 'account2')],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.to_target.account).toBe('account2');   // 不是 pct=1 的 account1
  });

  it('保底候选带回自己的 health/capacity，不串到别的候选上', async () => {
    const [mA, mB] = MACHINES;
    const healths = { [mA]: { ok: true, tag: 'A' }, [mB]: { ok: true, tag: 'B' } };
    const snap = {
      degraded: false,
      verdictFor: (a) => ({ verdict: 'unusable', reason: 'five_hour_exhausted', pct: a === 'team1' ? 96 : 99 }),
    };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      getMachineHealth: async ({ machine }) => healths[machine],
      getMachineCapacity: async ({ machine }) => ({ ok: true, available: 4, tag: healths[machine].tag }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('codex', 'team1', mA),
      candidate_targets: [T('codex', 'team1', mA), T('codex', 'team2', mB)],
      ...REQ,
    });
    expect(r.status).toBe('ok');
    expect(r.snapshot.machine).toBe(mA);       // pct 最低的 team1 在 mA 上
    // snapshot.health/capacity 读的是循环外 let，不写回就会带上最后一个候选（mB）的快照
    expect(r.snapshot.health.tag).toBe('A');
    expect(r.snapshot.capacity.tag).toBe('A');
  });

  it('保底的认证探针失败 → 照旧 blocked，不吞', async () => {
    const snap = { degraded: false, verdictFor: () => ({ verdict: 'unusable', reason: 'five_hour_exhausted', pct: 99 }) };
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => snap,
      probeProviderAuth: async () => ({ ok: false, signature: 'auth_failed' }),
    }));
    const r = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(r.status).toBe('blocked');
    expect(r.evidence.quota_unusable).toHaveLength(1);
  });

  it('保底不写 exhaustedAccounts —— 同一 gate 实例第二次 evaluate 该号仍可被选', async () => {
    let allDead = true;
    const gate = createCapabilityGate(gateDeps({
      loadAccountQuota: async () => ({
        degraded: false,
        verdictFor: () => (allDead
          ? { verdict: 'unusable', reason: 'five_hour_exhausted', pct: 96 }
          : { verdict: 'usable', reason: 'within_budget', pct: 5 }),
      }),
    }));
    const first = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(first.fallback_reason).toBe('account_quota_degraded_admit');
    allDead = false;
    const second = await gate.evaluate({
      preferred_target: T('claude', 'account1'),
      candidate_targets: [T('claude', 'account1')],
      ...REQ,
    });
    expect(second.status).toBe('ok');
    expect(second.to_target.account).toBe('account1');
    expect(second.fallback_reason).not.toBe('account_quota_degraded_admit');
  });
});
