import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  chooseGuidedExecutor,
  summarizeLlmCapacity,
  buildCodexLedgerFromQuota,
  buildGrokLedgerFromQuota,
} from '../llm-capacity.js';

function makeSnapshot(counts, sentinel = 'ok') {
  return {
    sampled_at: '2026-07-21T12:00:00.000Z',
    sentinel,
    vendors: {
      claude: { available_count: counts.claude ?? 0, total_count: 2, poller: 'ok' },
      codex: { available_count: counts.codex ?? 0, total_count: 2, poller: 'ok' },
      grok: { available_count: counts.grok ?? 0, total_count: 1, poller: 'ok' },
    },
  };
}

describe('llm-capacity', () => {
  it('abundant + claude 可用 → L1 primary claude', () => {
    expect(chooseGuidedExecutor('dev', 'abundant', makeSnapshot({ claude: 1, codex: 1, grok: 1 }))).toEqual(
      expect.objectContaining({ executor: 'claude', level: 'L1_primary_claude' })
    );
  });

  it('tight + codex 可用 → L2 primary codex', () => {
    expect(chooseGuidedExecutor('dev', 'tight', makeSnapshot({ claude: 1, codex: 1, grok: 1 }))).toEqual(
      expect.objectContaining({ executor: 'codex', level: 'L2_primary_codex' })
    );
  });

  it('abundant + claude 不可用但 codex 可用 → L3 cross vendor fallback', () => {
    expect(chooseGuidedExecutor('harness_initiative', 'abundant', makeSnapshot({ claude: 0, codex: 1, grok: 1 }))).toEqual(
      expect.objectContaining({ executor: 'codex', level: 'L3_cross_vendor_fallback' })
    );
  });

  it('tight + 两家计费厂商都不可用但 grok 可用 → L4 grok fallback', () => {
    expect(chooseGuidedExecutor('harness_initiative', 'tight', makeSnapshot({ claude: 0, codex: 0, grok: 1 }))).toEqual(
      expect.objectContaining({ executor: 'grok', level: 'L4_grok_fallback' })
    );
  });

  it('全不可用 → fail-open 回主偏好并标记 exhausted', () => {
    expect(chooseGuidedExecutor('dev', 'critical', makeSnapshot({ claude: 0, codex: 0, grok: 0 }, 'exhausted'))).toEqual(
      expect.objectContaining({ executor: 'codex', level: 'L4_fail_open', reason: 'llm_capacity_exhausted_fail_open' })
    );
  });

  it('summarizeLlmCapacity 仅保留台账所需摘要字段', () => {
    expect(summarizeLlmCapacity({
      sampled_at: '2026-07-21T12:00:00.000Z',
      sentinel: 'degraded',
      vendors: {
        claude: { available_count: 1, total_count: 2, poller: 'ok', accounts: [] },
        codex: { available_count: 0, total_count: 2, poller: 'error', accounts: [] },
      },
    })).toEqual({
      sampled_at: '2026-07-21T12:00:00.000Z',
      sentinel: 'degraded',
      vendors: {
        claude: { available_count: 1, total_count: 2, poller: 'ok' },
        codex: { available_count: 0, total_count: 2, poller: 'error' },
      },
    });
  });
});

// ── codex / grok 的可用性必须来自账本，不是本机文件 ────────────────────────
//
// 2026-09-22 实证：7 天 61 次派单 61 次全落 claude，5 个 codex 号和 grok
// 一次没被选过。根因不在选号层，在 **vendor 层**：
//
//   pollCodexAccount  → readFileSync(~/.codex-teamN/auth.json)
//   pollGrokLedger    → existsSync(~/.grok/auth.json)
//
// 而 Brain 跑在 us-vps 容器里，`/root/.codex*` `/root/.grok*` 根本不存在
// （ssh 实证）→ available_count 恒 0 → chooseGuidedExecutor 在 vendor 层就把
// codex/grok 整个排除。刀1 接进 capability-gate 的配额账本对这 6 个号
// **根本没机会生效** —— 闸门装在了一扇已经焊死的门后面。
//
// claude 那条之所以能通，是因为它走 getAccountUsage() 读 account_usage_cache 表，
// 压根不碰本机文件。三家里两家读文件、一家读表，这个分叉本身就是 bug 的形状。
//
// 修法复用已有的 createQuotaLedgerLoader + judgeAccount（ops_model_accounts
// 是生产唯一真配额来源），**不另发明第二套判据** —— #5472 的教训。
describe('codex/grok 可用性走账本（生产恒 0 可用的根因）', () => {
  const V = (verdict, reason, pct = null) => ({ verdict, reason, pct });
  function quota(verdicts, extra = {}) {
    return {
      degraded: false,
      degradedReason: null,
      ...extra,
      verdictFor: (id) => verdicts[id] ?? V('unknown', 'no_ledger_row'),
    };
  }

  it('账本说有额度 → codex 可用数按账本走（不再恒 0）', () => {
    // 生产实况：team2/4/5 七天用量 0%，却因为读不到本机文件被判 0 可用
    const led = buildCodexLedgerFromQuota(quota({
      team1: V('usable', 'within_budget', 27),
      team2: V('usable', 'within_budget', 0),
      team3: V('usable', 'within_budget', 1),
      team4: V('usable', 'within_budget', 0),
      team5: V('usable', 'within_budget', 0),
    }));
    expect(led.vendor).toBe('codex');
    expect(led.total_count).toBe(5);
    expect(led.available_count).toBe(5);
  });

  it('只有 unusable 才扣可用数', () => {
    const led = buildCodexLedgerFromQuota(quota({
      team1: V('unusable', 'seven_day_over_budget', 93),
      team2: V('usable', 'within_budget', 0),
      team3: V('usable', 'within_budget', 1),
      team4: V('usable', 'within_budget', 0),
      team5: V('usable', 'within_budget', 0),
    }));
    expect(led.available_count).toBe(4);
  });

  it('unknown 是弃权，不等于不可用', () => {
    // 三态设计的全部意义就在这：把「读不到数据」压成「没额度」正是 0819 三起事故的形状。
    // 压成不可用 → 一个只是缺数据的号被判死；grok 全列 NULL 时更会连 L4 兜底都没了。
    const led = buildCodexLedgerFromQuota(quota({
      team1: V('unknown', 'pct_unknown'),
      team2: V('unknown', 'no_ledger_row'),
      team3: V('usable', 'within_budget', 1),
      team4: V('unknown', 'pct_unknown'),
      team5: V('unknown', 'pct_unknown'),
    }));
    expect(led.available_count, 'unknown 被当成不可用 → 又把未知压成了否定事实').toBe(5);
  });

  it('grok 全列 NULL（探针诚实留空）时仍可当 L4 兜底', () => {
    // #5475 之后 grok 的 5h/7d 都是 NULL（诚实的未知，不再编造 0）。
    // 若把 unknown 判成不可用，grok 就永远进不了 L4 —— 最后一道兜底直接没了。
    const led = buildGrokLedgerFromQuota(quota({ grok: V('unknown', 'pct_unknown') }));
    expect(led.vendor).toBe('grok');
    expect(led.total_count).toBe(1);
    expect(led.available_count).toBe(1);
    expect(chooseGuidedExecutor('dev', 'tight', {
      sampled_at: 'x', sentinel: 'ok',
      vendors: {
        claude: { available_count: 0, total_count: 2, poller: 'ok' },
        codex: { available_count: 0, total_count: 5, poller: 'ok' },
        grok: { available_count: led.available_count, total_count: 1, poller: 'ok' },
      },
    })).toEqual(expect.objectContaining({ executor: 'grok', level: 'L4_grok_fallback' }));
  });

  it('账本降级 fail-closed（loader 返回 unusable）→ 可用数归零', () => {
    // 降级的 fail-open/fail-closed 策略归 loader 管（15 分钟后转 fail-closed），
    // 这里只要忠实反映它给出的裁决，不自作主张。
    const led = buildCodexLedgerFromQuota(quota({
      team1: V('unusable', 'ledger_unavailable_fail_closed'),
      team2: V('unusable', 'ledger_unavailable_fail_closed'),
      team3: V('unusable', 'ledger_unavailable_fail_closed'),
      team4: V('unusable', 'ledger_unavailable_fail_closed'),
      team5: V('unusable', 'ledger_unavailable_fail_closed'),
    }, { degraded: true, degradedReason: 'ledger_unavailable' }));
    expect(led.available_count).toBe(0);
    expect(led.poller).toBe('error');
  });

  it('裁决理由要带进 account.source，出事时能看出是哪一条判死的', () => {
    const led = buildCodexLedgerFromQuota(quota({
      team1: V('unusable', 'seven_day_over_budget', 93),
    }));
    const t1 = led.accounts.find((a) => a.name === 'team1');
    expect(t1.source).toContain('seven_day_over_budget');
    expect(t1.used_percent).toBe(93);
  });

  it('llm-capacity 不再为判可用性读本机文件', () => {
    // 这条是根因断言，不是形式检查：只要还 import fs，就说明可用性判据仍有一条
    // 依赖「凭据文件在本机」的路径，而 Brain 容器里永远不在。
    const src = readFileSync(new URL('../llm-capacity.js', import.meta.url), 'utf8');
    expect(src, 'llm-capacity 仍在 import fs —— 可用性又会依赖容器里不存在的文件').not.toMatch(
      /^import\s+.*\bfrom\s+['"](node:)?fs['"]/m,
    );
  });
});
