/**
 * 合同测试骨架 — acceptance-read-outlets（D3 R1）
 * task_id: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
 *
 * 覆盖：
 *   FC-1  SQL 列白名单（默认不含 AI 三列）
 *   FC-3  gp 级跨轮闸谓词对齐
 *   FC-4  9 条读侧出口 + 反向断言
 *   FC-6  BEHAVIOR-6 反向断言（adjudicated run 可见）
 *
 * 实现位置（Planner 交付）：
 *   packages/brain/src/__tests__/acceptance-read-outlets.test.js
 *
 * 本文件是合同骨架，描述 WHAT，不描述 HOW。
 * Planner 应将下方 describe/it 搬运到实际测试文件并填充实现。
 */

// ── BEHAVIOR-1: SQL 列白名单 ─────────────────────────────────────────────────

describe('FC-1 / BEHAVIOR-1: SQL 列白名单', () => {
  it('loadChecks 默认不含 AI 三列（ai_verdict / ai_evidence / ai_run_at）', async () => {
    // 安排：数据库有至少一个 check 记录
    // 行动：调用 loadChecks（不传 includeAi 参数，或传 includeAi=false）
    // 断言：返回的每个 check 对象不含 ai_verdict、ai_evidence、ai_run_at 键
    throw new Error('TODO: Planner 实现');
  });

  it('loadChecks 传入 includeAi=true 时返回 AI 三列', async () => {
    // 安排：数据库有至少一个已写 ai_verdict 的 check
    // 行动：调用 loadChecks({ includeAi: true })
    // 断言：返回对象含 ai_verdict 键
    throw new Error('TODO: Planner 实现');
  });

  it('GET /api/brain/acceptance/pending 响应中 checks 不含 AI 三列', async () => {
    // 通过 supertest 或 fetch 调用内网端点
    // 断言：response.body.runs[0].checks 中每个元素无 ai_verdict
    throw new Error('TODO: Planner 实现');
  });

  it('GET /api/brain/acceptance/runs?gp_id=X 响应中 checks 不含 AI 三列', async () => {
    throw new Error('TODO: Planner 实现');
  });
});

// ── FC-3: gp 级跨轮闸谓词对齐 ───────────────────────────────────────────────

describe('FC-3 / BEHAVIOR-3: gp 级跨轮闸', () => {
  it('同 gp_id 存在 pending run 时建单 → 409', async () => {
    // 安排：数据库插入一条 status=pending 的 run（同 gp_id）
    // 行动：POST /api/brain/acceptance/runs { gp_id }
    // 断言：HTTP 409
    throw new Error('TODO: Planner 实现');
  });

  it('同 gp_id 存在 in_review run 时建单 → 409', async () => {
    throw new Error('TODO: Planner 实现');
  });

  it('同 gp_id 仅存在 adjudicated run 时建单 → 201', async () => {
    // 安排：数据库仅有 status=adjudicated 的 run（同 gp_id）
    // 行动：POST /runs
    // 断言：HTTP 201（adjudicated 不阻拦新建单）
    throw new Error('TODO: Planner 实现');
  });

  it('同 gp_id 仅存在 stale run 时建单 → 201', async () => {
    throw new Error('TODO: Planner 实现');
  });
});

// ── FC-4: 9 条读侧出口覆盖 ──────────────────────────────────────────────────

describe('FC-4 / BEHAVIOR-6: 9 条读侧出口', () => {
  describe('内网出口（5221）', () => {
    it('出口1: GET /api/brain/acceptance/pending 正常返回 200', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口2: GET /api/brain/acceptance/runs?gp_id=X 正常返回', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口3: GET /api/brain/acceptance/runs/:run_key 正常返回', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口4: GET /api/brain/acceptance/runs/:run_key/checks 正常返回', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口5: loadRunsWithChecks 函数正常返回 run 列表', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口6: loadPendingRuns 函数只返回 pending/in_review 状态的 run', async () => {
      // 断言：adjudicated / stale / completed 的 run 不出现在返回列表中
      throw new Error('TODO: Planner 实现');
    });
  });

  describe('公网出口（5223）', () => {
    it('出口7: GET /acceptance/pending（携带 gate token）→ 200', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口8: GET /acceptance/catalog（携带 gate token）→ 200 或 404（若未实现则跳过）', async () => {
      throw new Error('TODO: Planner 实现');
    });

    it('出口9: POST /acceptance/pending（若有此端点）→ 正常响应', async () => {
      // 若此端点不存在则标记 skip
      throw new Error('TODO: Planner 实现');
    });
  });

  describe('反向断言', () => {
    it('adjudicated 与 stale run 并存时，GET /runs?gp_id 包含 adjudicated run', async () => {
      // 安排：数据库同一 gp_id 下插入 adjudicated + stale 两条 run
      // 行动：GET /api/brain/acceptance/runs?gp_id=X
      // 断言：返回数组中 status=adjudicated 的条目 ≥1
      throw new Error('TODO: Planner 实现');
    });

    it('GET /api/brain/acceptance/pending 不包含 adjudicated run', async () => {
      // loadPendingRuns 的正向断言：已定案轮不出现在 pending 列表中
      throw new Error('TODO: Planner 实现');
    });
  });
});
