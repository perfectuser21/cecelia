// F1「工厂 · 开发闭环」步骤 1 —— 边：没有经济基线的序列不许悄悄上线跑
//
// ── 事故（2026-09-07 实测）──
//
// #5222 让蒸馏器给**新序列**自动写 baseline_tokens，但**已有的老序列没回填**。
// search_account_v4.json 的 baseline_tokens 是 null，于是当天新跑的 12 条证据
// 全部带着空基线回流。判官聚合是 fail-closed 的——一条缺基线，整个单元判
// cost_evidence_missing —— 已经 promote 的 search_account_v4 当场掉回 keep_llm
// （n=56、成功率 96.4%，跑量和质量都够，纯粹倒在成本证据缺口上）。
//
// 判官 fail-closed 本身没错（不猜成本比瞎猜好）。错在**跑之前没人提醒序列缺基线**：
// 真机跑一次要几十秒 + 独占设备，跑完才发现证据是废的，这些时间不可能补回来
// （verified_at 是过去时刻）。
//
// 所以守卫放在开跑前：序列没有基线就明着喊，说清楚后果是什么。
// 不阻断——本地验证「这个序列还能不能跑通」本身有价值，跟经济账是两件事。

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baselineWarning } from '../../../packages/quality/phone-crystal/evidence-report.mjs';

const SEQ_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../packages/quality/phone-crystal/sequences',
);

describe('F1 step1 · 缺基线要在开跑前喊出来', () => {
  it('序列有基线 → 不警告', () => {
    expect(baselineWarning({ name: 'x', baseline_tokens: 10158 })).toBeNull();
  });

  it('序列缺基线 → 返回警告，且说清后果', () => {
    const w = baselineWarning({ name: 'search_account_v4' });
    expect(w).toBeTruthy();
    expect(w).toContain('search_account_v4');
    expect(w).toContain('cost_evidence_missing');
  });

  it('基线为 0 不算缺失（测过且真的不烧 token 是合法结论）', () => {
    expect(baselineWarning({ name: 'x', baseline_tokens: 0 })).toBeNull();
  });

  it('null 与 undefined 都算缺失', () => {
    expect(baselineWarning({ name: 'a', baseline_tokens: null })).toBeTruthy();
    expect(baselineWarning({ name: 'b' })).toBeTruthy();
  });
});

// 数据层守卫：把已经犯过的这次错钉死，防止再有序列漏掉基线进 repo
describe('F1 step1 · repo 里的序列都必须带基线', () => {
  it('sequences/ 下每个序列都有 baseline_tokens', () => {
    const missing = readdirSync(SEQ_DIR)
      .filter((f) => f.endsWith('.json'))
      .filter((f) => {
        const seq = JSON.parse(readFileSync(join(SEQ_DIR, f), 'utf8'));
        return !Number.isFinite(seq.baseline_tokens);
      });
    expect(missing).toEqual([]);
  });
});
