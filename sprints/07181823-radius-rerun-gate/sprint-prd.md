# Sprint PRD: radius-rerun-gate

task_id: 2a8a33c5-bc62-43bd-a562-3c755766b950
journey_type: dev_pipeline
target_environment: local_api
sprint_dir: sprints/07181823-radius-rerun-gate

---

## 背景

引用重跑闸（MJ5 刀1-4 已上线）当前从人工维护的 `journey_step_links` 格子推算受影响承诺与测试清单（`cascade-list.js`）。刀A2（PR #4087）已上线 `/api/brain/graph/radius` 端点：输入改动文件数组，输出 `affected_features`（含承诺）和 `affected_tests`（测试路径），纯函数图计算，零 LLM。

本次将重跑闸的**波及计算输入端**从格子查询换成 radius 图引擎。格子路径保留作语义翻译层（`cascade-list.js` 不删），只换上游数据源。radius 不可达或 `freshness.stale=true` 时必须显式回退格子路径并打 `WARN`（哨兵语义，禁静默降级）。

---

## 功能需求（FR）

### FR-1：radius 接口调用层（新增 `lib/radius-client.js`）

在 `packages/brain/src/lib/` 新建 `radius-client.js`，封装 `POST localhost:5221/api/brain/graph/radius`：

- 输入：改动文件数组 `string[]`
- 输出：`{ affected_features, affected_tests, freshness }` 或 `null`（不可达时）
- 超时：3000ms；捕获所有网络错误，不抛出，返回 `null`
- stale 检测：`freshness.stale === true` 时返回 `null`（视同不可达）

### FR-2：重跑闸输入端切换

`cascade-list.js` 的入口函数（现从 `journey_step_links` 拉 cells）改为：

1. **优先路径**：调 `radius-client.js`，拿 `affected_tests` 作为可运行清单，拿 `affected_features` 的 `promises` 作为承诺点名
2. **回退路径**：radius 返回 `null` 时，回退现行格子查询路径，**且必须打印 `WARN`**：
   ```
   [WARN][rerun-gate] radius unavailable or stale — falling back to journey_step_links
   ```
3. 格子路径（`journey_step_links` 查询）永久保留，不删除

### FR-3：WARN 哨兵语义（禁静默）

回退路径触发时，日志必须含 `WARN` 关键字，且出现在 stderr 或 console.warn/console.error。任何将回退情况静默降级为正常输出的行为不允许。

### FR-4：E2E 验收测试（新增 `rerun-gate-radius.integration.test.js`）

在 `packages/brain/src/__tests__/integration/` 新建 `rerun-gate-radius.integration.test.js`：

**场景 A（正常路径）**：
- 以 `packages/brain/src/__tests__/integration/blast-radius.integration.test.js` 为输入文件构造改动
- 调重跑闸（经 radius 引擎）
- 断言：输出的 `affected_features` 中含 feature_id `0b70f2ff-1a16-4029-a71a-e6cb5a523ea2`（CRM 表底座）
- 断言：`affected_tests` 含 `packages/brain/src/__tests__/integration/blast-radius.integration.test.js`

**场景 B（radius 停摆回退）**：
- mock `radius-client.js` 返回 `null`（模拟不可达）
- 调重跑闸
- 断言：回退到格子路径（`journey_step_links` 被查询）
- 断言：日志输出含 `WARN`

---

## Invariant 约束

| # | 约束 | 来源 |
|---|------|------|
| I-1 | 任何失败路径禁止静默降级：radius 不可达必须显式打 `WARN`，禁止只 warning 不记录 | decisions:9202c14e（部署链失败路径禁止 warning 降级） |
| I-2 | 格子路径（`journey_step_links` 查询）永久保留，不可删除；radius 是优先引擎，格子是语义翻译层和回退底 | 任务描述（保留格子路径作语义翻译） |
| I-3 | radius 返回 `freshness.stale=true` 必须视同不可达触发回退，不允许用过期图做波及计算 | 任务 thin_prd（stale 必须显式回退+告警） |
| I-4 | E2E 测试必须 commit 进 repo 永久留在 CI，不得删除 | CLAUDE.md Bug Fix 流程规则 |
| I-5 | 工厂域件（本模块属工厂域）同样挂同一套闸和图，感知者=主理人 | decisions:2d28de45（工厂域上图裁决） |

（本次 invariant 三源加载：全局 CLAUDE.md 规则 + 刀A2 架构决策 + 任务 thin_prd 约束，共 5 条）

---

## 累积 FR

| FR | 描述 | 来源 | 状态 |
|----|------|------|------|
| FR-1 | 新增 `lib/radius-client.js`，封装 radius 接口调用（超时 3s / stale 视同 null） | PrepPRD | 待实现 |
| FR-2 | `cascade-list.js` 输入端切换：优先 radius，回退格子路径 | PrepPRD | 待实现 |
| FR-3 | 回退路径必须打 `WARN`，禁静默降级 | PrepPRD + invariant I-1 | 待实现 |
| FR-4 | 新增 integration test：场景 A（CRM 点名断言）+ 场景 B（radius 停摆回退 + WARN 断言） | PrepPRD E2E 验收 | 待实现 |

---

## NFR

- `radius-client.js` 超时不超过 3000ms，不阻塞主调度路径
- 回退路径不引入新的 DB 查询（复用现行 `journey_step_links` 查询逻辑，不重写）
- 新增文件合计不超过 150 行；不引入新的第三方依赖
- 不删除任何现有测试文件或格子查询逻辑

---

## E2E 验收断言

1. **正常路径**：输入 `blast-radius.integration.test.js`，`affected_features[*].feature_id` 包含 `0b70f2ff-1a16-4029-a71a-e6cb5a523ea2`（CRM 表底座，已由 radius 真实响应验证）
2. **承诺点名**：`affected_features[*].promises[*].journey_name` 中出现「智能客服 · GP-B 被动接待」或等价 journey（CRM 表底座承诺）
3. **radius 停摆**：mock radius 不可达 → `cascade-list.js` 调 DB 查 `journey_step_links` → stderr/console.warn 含字符串 `WARN`
4. **stale 回退**：mock radius 返回 `freshness.stale=true` → 同上回退路径触发

---

## 实现文件清单

| 文件 | 操作 |
|------|------|
| `packages/brain/src/lib/radius-client.js` | 新建：封装 radius HTTP 调用 |
| `packages/brain/src/cascade-list.js` | 修改：输入端切换，加优先/回退分支 |
| `packages/brain/src/__tests__/integration/rerun-gate-radius.integration.test.js` | 新建：场景 A + B 集成测试 |
