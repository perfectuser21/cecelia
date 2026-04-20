# Phase 8.3 设计：dev_reviews 表 + PR 行数阈值 API 化

**日期**：2026-04-20
**分支**：`cp-0420115036-cp-04201149-phase83-dev-reviews`
**Engine 版本**：v18.1.1 → v18.2.0（minor）
**Brain**：加新表 + 新 API + migration 241

## 背景

Phase 8.1（PR #2456）建了两个机制：
1. Structured Review Block 规范 — B-4/B-5/B-6/SDD-2/SDD-3 五个自审点输出 markdown block
2. PR 行数双阈值（软 200 / 硬 400）

但**都只写在 proxy.md 里，没落地**：review 只进 design doc 无法查询，阈值硬编码不能被 harness-planner 引用。用户要求"Structured Review Block 规范落地到 Brain"。

## 范围

### 做

1. **migration 241_dev_reviews.sql** — 新表 dev_reviews
2. **SSOT 常量**：`packages/brain/src/constants/pr-thresholds.js`（软 200 / 硬 400 + source 注释）
3. **capacity-budget API** 响应加 `pr_loc_threshold` 字段
4. **review parser**：`packages/brain/src/review-parser.js`（markdown → JSON）
5. **dev-reviews API**：`packages/brain/src/routes/dev-reviews.js`（POST / GET / stats）
6. **server.js** 挂载路由
7. **proxy.md B-2** 改成"curl capacity-budget 拿 pr_loc_threshold"
8. **harness-planner SKILL.md** 加"拆分时读 capacity-budget.pr_loc_threshold"
9. 版本 bump + 测试

### 不做

- 不做 Phase 8.2（剩余 10 交互点）
- 不做 Dashboard UI（dev_reviews 可视化是后续）
- 不做 review block "趋势告警"（只存储和查询）

## 架构

```
proxy (B-4/B-5/B-6/SDD-2/SDD-3)
  ↓ 生成 markdown block
engine-ship / CI post-merge
  ↓ POST /api/brain/dev-reviews (parsed)
Brain dev_reviews table
  ↓ GET /api/brain/dev-reviews/stats
Dashboard / Brain 查询（未来）

harness-planner
  ↓ GET /api/brain/capacity-budget
  ← pr_loc_threshold 作为 workstream 拆分依据
```

## dev_reviews 表 schema

```sql
CREATE TABLE dev_reviews (
    id              SERIAL PRIMARY KEY,
    pr_number       INTEGER,
    branch          TEXT,
    point_code      TEXT NOT NULL,   -- 'B-4' / 'B-5' / 'B-6' / 'SDD-2' / 'SDD-3'
    decision        TEXT NOT NULL,   -- APPROVE / REQUEST_CHANGES / PASS_WITH_CONCERNS
    confidence      TEXT NOT NULL,   -- HIGH / MEDIUM / LOW
    quality_score   INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 10),
    risks           JSONB DEFAULT '[]'::jsonb,
    anchors_user_words  TEXT,
    anchors_code        TEXT,
    anchors_okr         TEXT,
    next_step           TEXT,
    raw_markdown        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dev_reviews_pr ON dev_reviews(pr_number);
CREATE INDEX idx_dev_reviews_point ON dev_reviews(point_code);
CREATE INDEX idx_dev_reviews_created ON dev_reviews(created_at DESC);
```

## review-parser 格式契约

输入 markdown：
```
## Review（autonomous，B-5 spec approval）

**依据**：
- 用户的话：<引用>
- 代码：<引用>
- OKR：<引用>

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10

**风险**：
- R1：<...>

**下一步**：<...>
```

输出 JSON：`{ point_code, decision, confidence, quality_score, risks, anchors_*, next_step, raw_markdown }`

缺字段 fallback `null`；格式错乱抛可 catch 的 `ParseError`。

## API 契约

### POST `/api/brain/dev-reviews`

body：`{ pr_number?, branch, point_code, decision, confidence, quality_score, risks, anchors_*, next_step, raw_markdown }`
返回 `{ id, created_at }`

### GET `/api/brain/dev-reviews?pr=&point=&limit=`

返回数组 of review 记录（默认 limit=20）

### GET `/api/brain/dev-reviews/stats`

返回按 point_code 聚合：
```json
{
  "stats": [
    { "point_code": "B-5", "avg_quality": 8.5, "count": 12, "low_confidence_rate": 0.08 },
    ...
  ]
}
```

## capacity-budget 响应扩展

现有响应加 `pr_loc_threshold` 字段：
```json
{
  ...existing fields...,
  "pr_loc_threshold": {
    "soft": 200,
    "hard": 400,
    "source": "industry-aligned-smartbear-microsoft-2006"
  }
}
```

阈值常量从 `packages/brain/src/constants/pr-thresholds.js` 读（SSOT）。

## DoD

- [x] [ARTIFACT] migration 241 存在且 schema 正确
  - Test: `manual:node -e "if(!require('fs').existsSync('packages/brain/migrations/241_dev_reviews.sql'))process.exit(1)"`
- [x] [BEHAVIOR] review-parser 解析完整 block → JSON 字段齐全
  - Test: `packages/brain/src/__tests__/review-parser.test.js`
- [x] [BEHAVIOR] POST /api/brain/dev-reviews 写入 + GET 查询
  - Test: `packages/brain/src/__tests__/dev-reviews-route.test.js`
- [x] [BEHAVIOR] capacity-budget 返回 pr_loc_threshold
  - Test: `packages/brain/src/__tests__/capacity-budget.test.js`（扩展现有）
- [x] [ARTIFACT] proxy.md B-2 改成读 API
  - Test: `manual:node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/steps/autonomous-research-proxy.md','utf8');if(!c.includes('capacity-budget'))process.exit(1)"`
- [x] [ARTIFACT] Engine 版本 7 处 + Brain auto-version
  - Test: `manual:node -e "['packages/engine/VERSION','packages/engine/.hook-core-version','packages/engine/hooks/VERSION'].forEach(f=>{if(!require('fs').readFileSync(f,'utf8').includes('18.2.0'))process.exit(1)})"`

## Review（autonomous，B-5 spec approval）

**依据**：
- 用户的话：对话记录 2026-04-20 "Structured Review Block 规范落地到 Brain（Phase 8.3）" + "PR 行数量化 API 化"
- 代码：`packages/brain/src/routes/capacity-budget.js`（现有结构）+ `packages/brain/migrations/240_consciousness_setting.sql`（最新 migration 号）
- OKR：Cecelia Engine KR — /dev 工作流自主化闭环（打分机制落地 + 阈值 SSOT）

**判断**：APPROVE

**confidence**：HIGH

**质量分**：9/10

**风险**：
- R1：migration 241 号可能被其他并行 PR 占用，需 rebase 时留意
- R2：review-parser 的 markdown 格式容错需要覆盖边界 case（空行、中英标点混用），测试要到位

**下一步**：进入 writing-plans → inline 实施
