# Sprint D — Harness Pipeline × Brain DB 7张表集成 设计文档

## 目标

Harness pipeline 当前与 Brain DB 完全脱节：planner 不知道现有 API/DB schema，合同提案不检查冲突，evaluator PASS 后不回写 Feature 状态。本设计打通三个集成点，让 Harness 成为 Brain 生态的有机组成部分。

## 架构概述

```
harness_initiative (payload: feature_id, journey_id, sprint_dir, thin_prd)
    │
    ├── [新] harness-planner: 先读7张表 → 生成上下文感知的 sprint-prd.md
    │         curl /api/brain/journeys?id=<journey_id>
    │         curl /api/brain/journey_features?journey_id=<journey_id>
    │         curl /api/brain/registry?type=api_endpoint
    │         curl /api/brain/registry?type=db_schema
    │         curl /api/brain/registry?type=test
    │         curl /api/brain/registry?type=skill
    │         + 原有 curl /api/brain/context
    │
    ├── [新] harness-contract-proposer: 写合同前先查注册表防冲突
    │         curl /api/brain/registry?type=api_endpoint (已有路由)
    │         curl /api/brain/registry?type=db_schema (已有路由，需修 bug)
    │
    └── harness_evaluate PASS → [新] 回写 journey_features.thickness
          execution.js PASS 分支 Step 3.5
          PATCH /api/brain/journey_features/:feature_id {thickness: 'medium'}
```

## 前置 Infrastructure Fixes

### Fix 1: 新增 GET /api/brain/journey_features

**文件**: `packages/brain/src/routes/journeys.js`

**问题**: 目前只有 POST（创建）和 PATCH（更新），没有 GET（查询）。

**接口设计**:
```
GET /api/brain/journey_features?journey_id=<uuid>
GET /api/brain/journey_features?area=<string>
GET /api/brain/journey_features?status=<string>
→ [{id, name, journey_id, thickness, status, area, unit_test_path, notion_id, ...}]
```

### Fix 2: 修复 registry.js registered_at 列名错误

**文件**: `packages/brain/src/routes/registry.js` 第99行

**问题**: `SELECT ... registered_at ...` 但表实际列名是 `created_at`，导致任何 `/api/brain/registry` 查询报 500。

**修复**: `registered_at` → `created_at`

## 集成点 1: harness-planner 读7张表

**文件**: `~/.claude/skills/harness-planner/SKILL.md`

**改动位置**: Step 0.1（当前只有一个 `curl localhost:5221/api/brain/context`）

**增加的查询**（在现有 context 查询之后）:

```bash
# 从 task payload 提取 journey_id
JOURNEY_ID="${TASK_PAYLOAD_JOURNEY_ID:-}"  # cecelia-run 注入

if [ -n "$JOURNEY_ID" ]; then
  # 读 Journey + Features
  curl -sf "localhost:5221/api/brain/journeys?id=$JOURNEY_ID" | jq '.' || true
  curl -sf "localhost:5221/api/brain/journey_features?journey_id=$JOURNEY_ID" | jq '.' || true
fi

# 读注册表（不依赖 journey_id）
curl -sf "localhost:5221/api/brain/registry?type=api_endpoint&limit=100" | jq '[.[] | {name,location,description}]' || true
curl -sf "localhost:5221/api/brain/registry?type=db_schema&limit=100" | jq '[.[] | {name,description}]' || true
curl -sf "localhost:5221/api/brain/registry?type=test&limit=50" | jq '[.[] | {name,location}]' || true
curl -sf "localhost:5221/api/brain/registry?type=skill&limit=50" | jq '[.[] | {name,description}]' || true
```

**注入到 planner prompt**:
```
## 系统当前状态（生成 PRD 必须考虑）
### 本 Journey 已有 Features（不要重复）:
<journey_features JSON>

### 已注册 API Endpoints（命名要对齐）:
<api_endpoint JSON>

### 已注册 DB Schema（不要重复建表/字段）:
<db_schema JSON>
```

## 集成点 2: harness-contract-proposer 读注册表防冲突

**文件**: `~/.claude/skills/harness-contract-proposer/SKILL.md`

**改动位置**: Step 2 开头（写合同草案之前）

**增加的查询**:
```bash
EXISTING_APIS=$(curl -sf "localhost:5221/api/brain/registry?type=api_endpoint&limit=100" | jq '[.[] | {name,location}]' 2>/dev/null || echo "[]")
EXISTING_SCHEMAS=$(curl -sf "localhost:5221/api/brain/registry?type=db_schema&limit=100" | jq '[.[] | {name,description}]' 2>/dev/null || echo "[]")
```

**注入到合同写作 prompt（Step 2 顶部新增段落）**:
```markdown
## 已注册 API（不要命名冲突）
<EXISTING_APIS>

## 已注册 DB Schema（不要重复定义表/字段）
<EXISTING_SCHEMAS>
```

## 集成点 3: evaluator PASS → thickness write-back

**文件**: `packages/brain/src/routes/execution.js`

**改动位置**: `if (evalVerdict === 'PASS')` 分支，在 Step 3 Smoke test 之后，Step 4 创建 Report 之前

**逻辑**:
```javascript
// Step 3.5: 回写 Feature thickness（thin → medium）
const featureId = harnessPayload.feature_id;
if (featureId) {
  try {
    const patchResp = await fetch(`http://localhost:5221/api/brain/journey_features/${featureId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thickness: 'medium' }),
    });
    if (patchResp.ok) {
      console.log(`[execution-callback] harness: Feature ${featureId} thickness → medium`);
    } else {
      console.warn(`[execution-callback] harness: thickness PATCH failed ${patchResp.status} (non-fatal)`);
    }
  } catch (thickErr) {
    console.warn(`[execution-callback] harness: thickness PATCH error (non-fatal): ${thickErr.message}`);
  }
}
```

**feature_id 传播**：在 execution.js 中所有 `createHarnessTask` 调用的 payload 里加：
```javascript
feature_id: harnessPayload.feature_id || null,
```
需要修改的位置（共5处）:
- 创建 harness_contract_propose（~line 1762）
- 创建 harness_contract_review（~line 1831）
- 创建 harness_contract_propose（next GAN round, ~line 1954）
- 创建 harness_evaluate（from harness_generate, ~line 2152）
- 创建 harness_evaluate（from harness_fix, ~line 2237）

注：harness_fix 任务已含 `...harnessPayload` 的字段（line 2433 验证），所以只需确保 feature_id 从 initiative 开始就在 payload 里。

## 数据流验证

```
harness_initiative.payload.feature_id = "feat-uuid-xxx"
    → harness_contract_propose.payload.feature_id = "feat-uuid-xxx"   [新增]
    → harness_contract_review.payload.feature_id = "feat-uuid-xxx"    [新增]
    → harness_generate.payload.feature_id = "feat-uuid-xxx"           [新增]
    → harness_evaluate.payload.feature_id = "feat-uuid-xxx"           [新增]
    → PASS → PATCH /journey_features/feat-uuid-xxx {thickness:'medium'} [新增]
```

## 测试策略

### Unit Tests（vitest）
- `packages/brain/src/routes/__tests__/journeys-get-features.test.js`
  - GET /journey_features?journey_id=<id> 返回正确数据
  - GET /journey_features 无参数返回全部
- `packages/brain/src/routes/__tests__/registry-created-at-fix.test.js`
  - GET /registry 不报 500（created_at fix 验证）

### Integration Tests（vitest + 真 pool）
- `packages/brain/src/routes/__tests__/evaluator-thickness-writeback.test.js`
  - mock fetch PASS 回调 → 验证 journey_features.thickness 被 PATCH 为 medium
  - feature_id 为 null 时不调用 PATCH（graceful）

### E2E Smoke（local_api）
```bash
# packages/brain/scripts/smoke/sprint-d-7table-smoke.sh
# 1. 创建测试 journey + feature（thin）
# 2. 验证 GET /journey_features?journey_id 返回数据
# 3. 验证 GET /registry?type=api_endpoint 不报 500
# 4. 触发 mock PASS 回调（带 feature_id）
# 5. 验证 journey_features.thickness = medium
```

## 成功标准

1. `GET /api/brain/journey_features?journey_id=<id>` 返回200 + 数组
2. `GET /api/brain/registry?type=api_endpoint` 返回200（不再500）
3. 执行 sprint-d-7table-smoke.sh → exit 0
4. harness-planner SKILL.md Step 0.1 包含≥5个 curl 查询
5. harness-contract-proposer SKILL.md Step 2 包含 EXISTING_APIS 注入
6. evaluator PASS 后 journey_features.thickness = 'medium'（前提：payload 含 feature_id）
