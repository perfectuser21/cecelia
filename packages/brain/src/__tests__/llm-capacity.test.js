import { describe, it, expect } from 'vitest';
import { chooseGuidedExecutor, summarizeLlmCapacity } from '../llm-capacity.js';

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
