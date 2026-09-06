// F1「工厂 · 开发闭环」步骤 1 —— 边：结晶判官读运行证据
//
// Regression: 判官吃不到饭 —— aggregateGridMetrics 是硬编码返回空值的桩函数
//
// 现场（2026-09-06 实测）：Crystal 骨架 6 个件（件1/2/4/5/6/7）今天全部合并，判官每天在跑，
// 但 crystal_ledger 8 行全部 n_runs=0 / data_gap=true，crystal_verdict 8 条全是 keep_llm
// 且依据全是 {"rule":"data_gap"}。根因不是 bug，是件4 交付时把数据源接入明确划在范围外：
//   crystal-judge.js: async function aggregateGridMetrics(_dbPool, gridKey) {
//     // 本 sprint 无本地真目标可读 → 该格数据缺口（PRD 边界③ / 接缝 3）
//     return { n_runs: 0, success_rate: null, ..., data_gap: true };
//   }
// 与此同时真实证据躺在 xian-m4 ~/phone-pub/verify-search_account-*.json
// （runs=3 passes=3 crystallized=true avg_ms=24071 device=MAA-AN00|40.3.0|524），无人搬运。
//
// 本测试锁死的不变量：**证据在库里时，判官必须吃到——data_gap 为假且 n_runs 大于零。**
// 这条断言是防止 aggregateUnitMetrics 再退回桩函数的唯一守卫：桩函数恒返 data_gap=true，
// 它一回来这里立刻红。用注入 pool（不碰真库），保证能进 CI 常跑。
import { describe, it, expect } from 'vitest';
import { aggregateUnitMetrics } from '../../../packages/brain/src/crystal-judge.js';

/** 造一个只对 crystal_run_evidence 查询返回指定行的假 pool。 */
function poolReturning(rows) {
  return {
    query: async (sql) => {
      if (/crystal_run_evidence/i.test(sql)) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  };
}

// 与 m4 真实产出等价的一行证据（字段名对齐入库后的列）
const REAL_EVIDENCE = {
  unit_key: 'search_account',
  funnel_cell: 'source',
  runs: 3,
  passes: 3,
  hot_path_tokens: 696,
  baseline_tokens: 10158,
  avg_ms: 24071,
  device: 'MAA-AN00|40.3.0|524',
  crystallized: true,
  pure_hot_path: true,
  has_postcondition: true,
  new_branch_count: 0,
  broken_count: 0,
};

describe('F1 step1 · 结晶判官必须吃到运行证据', () => {
  it('库里有证据时 data_gap 为假、n_runs 大于零（防桩函数回退）', async () => {
    const m = await aggregateUnitMetrics(poolReturning([REAL_EVIDENCE]), 'search_account', '2026-09-06');
    expect(m.data_gap).toBe(false);
    expect(m.n_runs).toBeGreaterThan(0);
  });

  it('六项指标由证据算出，不是常量', async () => {
    const m = await aggregateUnitMetrics(poolReturning([REAL_EVIDENCE]), 'search_account', '2026-09-06');
    expect(m.n_runs).toBe(3);
    expect(m.success_rate).toBeCloseTo(1, 5);   // passes/runs
    expect(m.latency_ms).toBeCloseTo(24071, 0);
    expect(m.broken_count).toBe(0);
    expect(m.new_branch_rate).toBe(0);
  });

  // token_cost 语义：判决引擎用 n_runs * token_cost 与固化成本基线比大小，
  // 衡量的是「不固化要烧多少」，所以必须取 baseline（纯 LLM）而非固化后的热路径成本。
  // 取错方向会让 cost_benefit 差一个数量级，永远达不到基线、永远晋升不了。
  it('token_cost 取 baseline_tokens（不固化则需消耗的 LLM token），不是热路径成本', async () => {
    const m = await aggregateUnitMetrics(poolReturning([REAL_EVIDENCE]), 'search_account', '2026-09-06');
    expect(m.token_cost).toBe(10158);
    expect(m.token_cost).not.toBe(696);
  });

  // 诚实优先：缺 baseline 时不许拿热路径成本顶替（那会把 cost_benefit 算小一个数量级），
  // 也不许臆造，直接记数据缺口。
  it('证据缺 baseline_tokens 时记 data_gap，不用热路径成本顶替', async () => {
    const noBaseline = { ...REAL_EVIDENCE, baseline_tokens: null };
    const m = await aggregateUnitMetrics(poolReturning([noBaseline]), 'search_account', '2026-09-06');
    expect(m.data_gap).toBe(true);
    expect(m.token_cost).not.toBe(696);
  });

  it('库里没有该段证据时仍诚实降级为 data_gap（保留件4 的不误判语义）', async () => {
    const m = await aggregateUnitMetrics(poolReturning([]), 'never_ran', '2026-09-06');
    expect(m.data_gap).toBe(true);
    expect(m.n_runs).toBe(0);
    expect(m.success_rate).toBeNull();
  });

  it('探针标志透传给判决引擎（INV-2 无 postcondition 不许晋升）', async () => {
    const m = await aggregateUnitMetrics(poolReturning([REAL_EVIDENCE]), 'search_account', '2026-09-06');
    expect(m.has_postcondition).toBe(true);
    expect(m.is_hardened).toBe(true);       // crystallized=true 即已固化
  });
});
