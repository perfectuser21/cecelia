/**
 * rubric-trend.test.js —— detectRubricTrend 纯函数全场景单测。
 * 语义 SSOT：docs/superpowers/specs/2026-08-04-gan-case-file-design.md §数据流 4。
 */
import { describe, it, expect } from 'vitest';
import { detectRubricTrend } from '../rubric-trend.js';

function reviewerRow(round, rubric_scores, overrides = {}) {
  return { round, author_role: 'reviewer', rubric_scores, ...overrides };
}

function proposerRow(round, overrides = {}) {
  return { round, author_role: 'proposer', rubric_scores: null, blockers: [], ...overrides };
}

describe('detectRubricTrend [BEHAVIOR]', () => {
  it('非数组输入 → insufficient_data（不崩）', () => {
    expect(detectRubricTrend(null)).toBe('insufficient_data');
    expect(detectRubricTrend(undefined)).toBe('insufficient_data');
    expect(detectRubricTrend('not-an-array')).toBe('insufficient_data');
  });

  it('空数组 → insufficient_data', () => {
    expect(detectRubricTrend([])).toBe('insufficient_data');
  });

  it('reviewer 有效行 < 3 → insufficient_data', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 5, scope_match_prd: 5 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 6 }),
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });

  it('proposer 行不计入 reviewer 轮次计数（即使数量凑够 3 也不算）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      proposerRow(1),
      proposerRow(2),
      proposerRow(3),
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });

  it('rubric_scores 为 null 的 reviewer 行不计入（例如 REVISION 无结构化分数的历史行）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      reviewerRow(2, null),
      reviewerRow(3, { dod: 6 }),
      reviewerRow(4, { dod: 7 }),
    ];
    // 只有 round 1/3/4 三条有效 → 恰好凑够 3 轮，全升 → converging
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('任一维度连续 2 轮严格下降（a>b>c）→ diverging', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('任一维度高低高震荡（a>b 且 c>b）→ oscillating', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 8, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('任一维度低高低震荡（a<b 且 c<b）→ oscillating', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 6, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('全部维度持平 → converging（持平不是发散）', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 7, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('全部维度上升 → converging', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 4, scope_match_prd: 4 }),
      reviewerRow(2, { dod_machineability: 5, scope_match_prd: 6 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 8 }),
    ];
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('oscillating 优先于 diverging：不同维度分别命中时判 oscillating', () => {
    const rows = [
      // dod: 8>7>6 连续下降（diverging 候选）；scope: 7,4,7 高低高（oscillating 候选）
      reviewerRow(1, { dod_machineability: 8, scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 7, scope_match_prd: 4 }),
      reviewerRow(3, { dod_machineability: 6, scope_match_prd: 7 }),
    ];
    expect(detectRubricTrend(rows)).toBe('oscillating');
  });

  it('缺维度容错：某轮缺失其他轮存在的维度不崩，跳过该维度按其余维度判定', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 8, risk_registered: 7 }),
      reviewerRow(2, { dod_machineability: 7 }), // 缺 risk_registered
      reviewerRow(3, { dod_machineability: 6, risk_registered: 7 }),
    ];
    // dod 8>7>6 连续下降 → diverging；risk 因 round2 缺失被跳过，不影响结果
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('非数值容错：维度值是字符串/非法值时跳过该维度不抛错', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 'N/A', scope_match_prd: 7 }),
      reviewerRow(2, { dod_machineability: 'N/A', scope_match_prd: 7 }),
      reviewerRow(3, { dod_machineability: 'N/A', scope_match_prd: 7 }),
    ];
    expect(() => detectRubricTrend(rows)).not.toThrow();
    expect(detectRubricTrend(rows)).toBe('converging');
  });

  it('取最近 3 轮，忽略更早轮次（第 4 轮回升不能掩盖最近 3 轮的发散）', () => {
    const rows = [
      reviewerRow(1, { dod_machineability: 3 }),
      reviewerRow(2, { dod_machineability: 9 }), // 更早的高分，不参与最近 3 轮判定
      reviewerRow(3, { dod_machineability: 8 }),
      reviewerRow(4, { dod_machineability: 7 }),
      reviewerRow(5, { dod_machineability: 6 }),
    ];
    // 最近 3 轮 = round 3/4/5：8>7>6 连续下降 → diverging
    expect(detectRubricTrend(rows)).toBe('diverging');
  });

  it('round 非整数的行不计入（防御脏数据）', () => {
    const rows = [
      reviewerRow(1, { dod: 5 }),
      reviewerRow(2, { dod: 6 }),
      { round: 2.5, author_role: 'reviewer', rubric_scores: { dod: 7 } },
    ];
    expect(detectRubricTrend(rows)).toBe('insufficient_data');
  });

  describe('F2(a) 阈值拍板：只拦真发散，单点小抖动不算', () => {
    it('10→9→10 单维小幅抖动（两腿都 <2）→ converging，不是 oscillating', () => {
      const rows = [
        reviewerRow(1, { ci_workflow_alignment: 10 }),
        reviewerRow(2, { ci_workflow_alignment: 9 }),
        reviewerRow(3, { ci_workflow_alignment: 10 }),
      ];
      expect(detectRubricTrend(rows)).toBe('converging');
    });

    it('方向命中高低高但腿幅只有 1 → 不算 oscillating（幅度门槛生效）', () => {
      const rows = [
        reviewerRow(1, { dod_machineability: 8 }),
        reviewerRow(2, { dod_machineability: 7 }),
        reviewerRow(3, { dod_machineability: 8 }),
      ];
      expect(detectRubricTrend(rows)).toBe('converging');
    });

    it('方向命中高低高且两腿都 >=2 → 仍判 oscillating', () => {
      const rows = [
        reviewerRow(1, { dod_machineability: 8 }),
        reviewerRow(2, { dod_machineability: 6 }),
        reviewerRow(3, { dod_machineability: 8 }),
      ];
      expect(detectRubricTrend(rows)).toBe('oscillating');
    });

    it('单维两连降但累计跌幅 <2 且只有 1 个维度 → 不算 diverging', () => {
      const rows = [
        reviewerRow(1, { dod_machineability: 8.5, scope_match_prd: 7 }),
        reviewerRow(2, { dod_machineability: 8, scope_match_prd: 7 }),
        reviewerRow(3, { dod_machineability: 7.5, scope_match_prd: 7 }),
      ];
      // dod: 8.5>8>7.5 两连降，累计跌幅 1 < 2，且只有这一个维度在降 → converging
      expect(detectRubricTrend(rows)).toBe('converging');
    });

    it('单维两连降且累计跌幅 >=2 → diverging（即使只有这一个维度）', () => {
      const rows = [
        reviewerRow(1, { dod_machineability: 9, scope_match_prd: 7 }),
        reviewerRow(2, { dod_machineability: 8, scope_match_prd: 7 }),
        reviewerRow(3, { dod_machineability: 7, scope_match_prd: 7 }),
      ];
      expect(detectRubricTrend(rows)).toBe('diverging');
    });

    it('≥2 个维度同时两连降（各自幅度都 <2）→ diverging', () => {
      const rows = [
        reviewerRow(1, { dod_machineability: 8, scope_match_prd: 8 }),
        reviewerRow(2, { dod_machineability: 7.5, scope_match_prd: 7.5 }),
        reviewerRow(3, { dod_machineability: 7, scope_match_prd: 7 }),
      ];
      // 每个维度单独跌幅只有 1（<2），但两个维度同时两连降 → 命中"≥2 维度"分支
      expect(detectRubricTrend(rows)).toBe('diverging');
    });
  });

  describe('F4：JSON null 维度不得被当成 0 分（null→0 假发散回归）', () => {
    it('{ci:9} → {ci:null} → {ci:9}：null 视为缺失跳过该维度，不判 oscillating', () => {
      const rows = [
        reviewerRow(1, { ci_workflow_alignment: 9 }),
        reviewerRow(2, { ci_workflow_alignment: null }),
        reviewerRow(3, { ci_workflow_alignment: 9 }),
      ];
      // 若把 null 误当 0：9,0,9 会命中高低高且幅度 9>=2 → 错判 oscillating。
      // 正确语义：round2 该维度视为缺失，三轮里只有 1 条有效值，方向判定不成立 → converging。
      expect(detectRubricTrend(rows)).toBe('converging');
    });

    it('null 维度也不会被误判为 diverging（同理防 0 分误判成连续下降）', () => {
      const rows = [
        reviewerRow(1, { risk_registered: 8 }),
        reviewerRow(2, { risk_registered: null }),
        reviewerRow(3, { risk_registered: 6 }),
      ];
      // 若把 null 当 0：8,0,6 会命中高低高（幅度都>=2）→ 误判 oscillating。
      // 正确语义：round2 缺失，跳过该维度 → converging（无其他维度佐证）。
      expect(detectRubricTrend(rows)).toBe('converging');
    });
  });

  describe('r17 真实数据回归（锚死灵敏度，报告心算校验，R1 未给出精确值处用 "其余>=7" 的下限 7 近似）', () => {
    it('r17 三轮真实 rubric（risk_registered 7→0→6 等）→ 仍判 oscillating', () => {
      const rows = [
        reviewerRow(1, {
          dod_machineability: 7,
          scope_match_prd: 7,
          test_is_red: 7,
          internal_consistency: 5,
          risk_registered: 7,
          verification_oracle_completeness: 5,
          ci_workflow_alignment: 7,
        }),
        reviewerRow(2, {
          dod_machineability: 8,
          scope_match_prd: 9,
          test_is_red: 10,
          internal_consistency: 5,
          risk_registered: 0,
          verification_oracle_completeness: 5,
          ci_workflow_alignment: 10,
        }),
        reviewerRow(3, {
          dod_machineability: 5,
          scope_match_prd: 6,
          test_is_red: 10,
          internal_consistency: 4,
          risk_registered: 6,
          verification_oracle_completeness: 5,
          ci_workflow_alignment: 10,
        }),
      ];
      expect(detectRubricTrend(rows)).toBe('oscillating');
    });
  });
});
