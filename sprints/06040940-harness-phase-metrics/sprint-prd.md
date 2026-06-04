# Sprint PRD — Harness Pipeline 各阶段真实指标埋点

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性 KR（让每次 Sprint 可量化耗时/成本/模型分布）
- **当前进度**：报告骨架完成，Phase 表格仍为占位符
- **本次推进预期**：Phase 表格 duration / cost_usd / model 接真实数据，Report 占位符归零

## 背景

`initiative_run_events` 已记录每个 phase 的 `node / status / ts`，但缺 `ts_end / cost_usd / model`，导致 `harness-report.md` 与 `index.html` Phase 表格的"耗时 / 成本 / 模型"列只能写 `-`，无法支撑「哪个阶段最贵 / 最慢 / 用了哪个模型」的运维判断。承接 #3281 的 Phase 维度补齐。

## Golden Path（核心场景）

运维点火一次 harness sprint，从开始到看 Report 全程只看到真实数字。

1. **入口**：运维（cecelia-run / Brain executor）启动 harness sprint。
2. **关键步骤**：每个 phase（Planner / Proposer / Generator / Evaluator / Reporter）启动时写 `running` 事件含 `model`；完成时写 `completed` 事件含 `ts_end + cost_usd`。任一 phase 写事件失败不阻断 pipeline。
3. **出口**：sprint 完成后 `harness-report.md` 和 `index.html` Phase 表格每行展示 `阶段名 | 真实耗时 | 真实成本 | 模型 id | 状态`。

## 边界情况

- **phase-event 写失败**：吞错继续，Report 该行字段显示 `-`
- **cost_usd 缺失**：后端写 NULL，Report 显示 `-`
- **同一 phase 重复 start**：以最后一次为准（覆盖 ts / model）

## 范围限定

**在范围内**：
- `initiative_run_events` schema 加 3 列（`ts_end BIGINT` / `cost_usd NUMERIC(10,4)` / `model TEXT`）
- Brain API：POST phase-event 接 model；新增 PATCH phase-event/:id 接 ts_end + cost_usd
- 5 个 harness skill 首尾各加 phase-start / phase-end 调用
- `harness-report` Step 6 改为从 `initiative_run_events` 读 Phase 维度数据
- `index.html` 同步替换占位符

**不在范围内**：
- token-level 精确计费（cost_usd 由 skill 自估传入）
- 历史 sprint Report 回填
- Phase 维度图表 / 趋势线
- Reporter 之外的 phase 状态机重构

## 假设

- [ASSUMPTION: 各 harness skill 当前都能从 prompt 注入收到 `initiative_id`；缺则本 sprint 顺带补]
- [ASSUMPTION: `model` 字段由 skill 自身已知（启动时固定），不依赖 callback 反查]
- [ASSUMPTION: 生产 DB（mmv / hk-vps）migration 走标准流程，sprint 内只做 schema 文件 + 本地 selfcheck，不在 sprint 内执行生产部署]
- [ASSUMPTION: `cost_usd` 由 skill 自估精度可接受 ±30% 偏差]

## 预期受影响文件

- `packages/brain/migrations/` 或 `packages/brain/src/db/migrations/`：新 migration 加 3 列
- `packages/brain/src/events/initiativeRunEvents.js`：write/update 函数支持新字段
- `packages/brain/src/routes/harness.js`：POST 接 model；新增 PATCH /phase-event/:id
- `packages/brain/src/routes/__tests__/harness.test.js`：API 测试
- `packages/brain/src/selfcheck.js`：bump `EXPECTED_SCHEMA_VERSION`
- 5 个 harness skill prompt（Planner / Proposer / Generator / Evaluator / Reporter）：首尾各加 phase-event 调用
- Reporter Step 6 模板：Phase 表格从 events 读取
- `index.html` 渲染模板：同步占位符替换

## E2E 验收

```bash
# 前置：本地 Brain 起在 localhost:5221，cecelia DB 已 apply 新 migration
INIT_ID=$(uuidgen)

# 1. POST phase-start（含 model）→ 拿 event id
EVENT_ID=$(curl -fsS -X POST localhost:5221/api/brain/harness/phase-event \
  -H 'Content-Type: application/json' \
  -d "{\"initiative_id\":\"$INIT_ID\",\"node\":\"planner\",\"status\":\"running\",\"model\":\"claude-opus-4-7\"}" \
  | jq -r '.id')
[ -n "$EVENT_ID" ] || { echo "FAIL: POST 未返回 id"; exit 1; }

# 2. PATCH phase-end（含 ts_end + cost_usd）
curl -fsS -X PATCH "localhost:5221/api/brain/harness/phase-event/$EVENT_ID" \
  -H 'Content-Type: application/json' \
  -d "{\"status\":\"completed\",\"ts_end\":$(date +%s%3N),\"cost_usd\":0.42}" \
  | jq -e '.ts_end and .cost_usd' >/dev/null \
  || { echo "FAIL: PATCH 缺字段"; exit 1; }

# 3. DB 三列均非 NULL
psql cecelia -tAc \
  "SELECT 1 FROM initiative_run_events WHERE id='$EVENT_ID' AND ts_end IS NOT NULL AND cost_usd IS NOT NULL AND model IS NOT NULL" \
  | grep -q 1 || { echo "FAIL: DB 三列写入不全"; exit 1; }

# 4. Reporter 行不再含占位符
! grep -E '^\| *Reporter *\| *- ' "$SPRINT_DIR/harness-report.md" \
  || { echo "FAIL: Reporter 行仍有占位符"; exit 1; }

echo "✅ harness phase metrics e2e 通过"
```

## journey_type: dev_pipeline
## journey_type_reason: 改造 harness pipeline 自身埋点（Brain DB + API + 5 skill prompt + Reporter 模板），起点是 pipeline 生命周期非 UI/agent_remote。
## target_environment: local_api
## target_environment_reason: 验证手段为 curl localhost:5221 + psql cecelia，无远端 / Windows / 浏览器依赖。
## journey_id: cecelia-harness-pipeline
## step_id: harness-pipeline-observability-phase-metrics
