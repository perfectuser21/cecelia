# 九要素 T3：注入扩容 + line_ledger 蒸馏接线 + context-manifest 端点 — 设计

日期：2026-07-10
Brain task：ac64f425-d7f7-498e-9380-b7064b1796ac（nine-elements plan_seq=3）
架构依据：docs/architecture/2026-07-10-nine-elements-integrity/architecture.md（设计 PR #3731 已批）
前置核查：Research Subagent APPROVE（HEAD f1d86c020，无冲突 PR，main 无同功能）

## 目标

1. 三角色 prompt 注入扩容：PROMPT_MAX_LEN 4000→12000、MAX_FR_ABILITIES 20→50
2. 蒸馏接线：dreaming L1 产出的 line_ledger（design_docs type='line_ledger'）注入 prompt + 通过新端点对 planner 暴露
3. 新端点 `GET /api/brain/warroom/line/:id/context-manifest`：planner Step 0.4 一次拉全

## 变更明细

### 1. packages/brain/src/harness-line-context.js

- 常量：`PROMPT_MAX_LEN = 12000`、`MAX_FR_ABILITIES = 50`；新增 `MAX_LEDGER_LEN = 4000`（ledger 段内容单独截断）
- 新增导出常量 `LINE_LEDGER_SECTION_HEADER = '## Line 账本（昨日蒸馏摘要）'`
- `fetchLineContext`：journeyId 存在时新增第四路 best-effort 查询——该 journey 最新一条 line_ledger：
  ```sql
  SELECT content, created_at FROM design_docs
  WHERE type='line_ledger' AND journey_id=$1
  ORDER BY created_at DESC LIMIT 1
  ```
  返回值扩展为 `{ invariants, cumulativeFR, ledger }`（ledger 为 `{content, created_at}` 或 null）。失败仅 warn 降级 null，不 throw。
- `formatLineContextForPrompt`：三段顺序 = Invariant → 累积 FR → Line 账本（**ledger 段排最后**，总长 clamp(12000) 时优先牺牲 ledger，保 E1 契约两段）。ledger 内容先 clamp(MAX_LEDGER_LEN) 再入段；无 ledger 不出段。E1 契约段头与行格式不变（新增段为 additive，核查确认消费方不按段头闭集解析）。

### 2. packages/brain/src/line-dreaming.js

- `buildLineDreamData(pool, journeyId, journeyName, { since = null } = {})`：六段查询时间条件改为 `>= COALESCE($n::timestamptz, NOW() - INTERVAL '24 hours')`，`since` 为 null 时行为与现状完全一致（向后兼容，现有调用方不传）。

### 3. packages/brain/src/routes/warroom.js

新端点 `GET /line/:id/context-manifest`：
1. 查 journey 本体，不存在 → 404 `{error:'journey not found'}`
2. `fetchLineContext({pool}, {journeyId})` → invariants + cumulativeFR + ledger
3. delta：`buildLineDreamData(pool, id, journey.name, { since: ledger?.created_at ?? null })`——有 ledger 取"自蒸馏时刻起"的增量事实，无 ledger 回落 24h 窗口
4. 响应：
   ```json
   {
     "line": { "id", "name", "status", "maturity" },
     "ledger": { "content", "created_at" } | null,
     "delta": { "decisions", "advancement_items", "issues", "runs", "learnings", "strategist_notes" },
     "invariants": [...],
     "cumulative_fr": [...],
     "prompt_block": "<formatLineContextForPrompt 输出>",
     "generated_at": "ISO"
   }
   ```
5. 各段 best-effort（fetchLineContext/buildLineDreamData 已内置降级）；外层 catch → 500

planner skill 侧（zenithjoy-skills repo）消费改造不在本 PR 范围（T3 的 skill eval 部分独立走 skill repo）。

## 测试策略（integration/unit 档）

- **unit** `harness-line-context.test.js` 扩展：
  - 12000 上限生效（构造超长输入断言截断到 12001 含省略号）
  - MAX_FR_ABILITIES=50（51 个 ability 时第 51 个折叠为"另有 1 个 ability 略"）
  - ledger 段注入：有 ledger 出段且排最后、内容 clamp 4000；无 ledger 不出段；ledger 查询失败降级 null
  - E1 契约回归：Invariant/累积FR 段头与行格式逐字不变
- **unit** `line-dreaming.test.js` 扩展：since 传参时 SQL 参数带 timestamptz；不传时与现状一致
- **unit** `routes/__tests__/warroom.test.js` 模式新增 context-manifest 用例：200 全字段、404、单路失败降级
- **wiring test** 更新：删除对已废弃 harness-task.graph.js 的过时注释引用
- 无 migration，EXPECTED_SCHEMA_VERSION 不动；版本 bump 四处（package.json/package-lock.json/.brain-versions/DEFINITION.md）

## 风险

- LangGraph 注入路径（harness-gan.graph.js proposer 单点）实际影响面小（relay 为主），扩容无下游硬限制
- 新段 additive，controller 只检查两契约段存在，不破坏
