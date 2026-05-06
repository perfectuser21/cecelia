# Sprint PRD — MJ1 主理人开发闭环 Walking Skeleton 立骨架

## Walking Skeleton 上下文（必读）

**本 Sprint 推进 Journey**：[MJ1 · 主理人开发闭环](https://www.notion.so/MJ1-358c40c2ba6381799db1d160a47a140c)
- Type: `dev_pipeline`
- 当前 Maturity: `skeleton`（在建，4 个 thin feature 还在 building）
- 目标 Maturity: `skeleton`（4 个 building feature 全 done + Feature 0 E2E smoke 全绿后达成）

**推进的 Feature 列表**：
| Feature | 当前 | 目标 |
|---|---|---|
| F1: MJ1·S1 接任务 | thin/building | thin/done |
| F2: MJ1·S4 评估好坏 | thin/building | thin/done |
| F3: MJ1·S6 回血回填 | thin/building | thin/done |
| F4: MJ1·S7 前端可见 | thin/building | thin/done |

**Feature 0（E2E 端到端 smoke，必须）**：`tests/e2e/mj1-skeleton-smoke.spec.ts`
- 验证一条最简 task 走完整 7 step：主理人 Dashboard 点"开始开发" → /dev 自动跑 → PR merge → KR 进度更新 → LiveMonitor 可见
- 任何单 feature 通但 Feature 0 红 = Sprint **FAIL**

**纪律**：本 Sprint **只立骨架不加厚**。任何 PRD 描述若超出 thin（"完善错误处理"/"美化 UI"/"性能优化"）属于范围蔓延，立刻砍掉。

---

## OKR 对齐

- **对应 KR**：KR2 — Cecelia 基础稳固（系统可信赖、算力全开、**管家闭环**）
- **当前进度**：82%
- **本次推进预期**：85%（管家闭环可视化 + KR 自动回写贯通）

---

## 背景

主理人开发的核心价值是"接到任务 → 写完 → 看到对 OKR 的推进"。Cecelia 已有 /dev、worktree、PR 流程，但**端到端闭环没贯通**：
- 主理人无法从 Dashboard 一键启动开发（缺"开始开发"按钮 + 启动 endpoint）
- 任务完成不验证"是否真在推进 KR"（评估缺失）
- KR 进度不会自动随 task 完成更新（回血回填断链）
- LiveMonitor 实时性偶有 5-10s 延迟（但 thin 阶段可接受）

四个断点导致主理人虽然能用 /dev 单点工作，**但感受不到"管家闭环"**。本 Sprint 把这条闭环最薄版本贯穿，让主理人第一次能完整 demo 一遍 MJ1。

---

## 目标

主理人能从 Dashboard 一键启动一个开发任务，完整走完 7 step，10 秒内在前端看到 KR 进度变化。

---

## User Stories

**US-001**（P0）: 作为主理人，我希望在 Dashboard task 列表点"开始开发"，以便不用切到终端手敲 /dev
**US-002**（P0）: 作为主理人，我希望任务 PR 合并后 KR 进度自动 +1%，以便看到"做的事真的在推进 OKR"
**US-003**（P0）: 作为主理人，我希望系统验证"这个 task 关联的 KR 是否真在动"，以便发现"完成了任务但没推进 KR"的失配
**US-004**（P0）: 作为主理人，我希望在 LiveMonitor 看到任务执行的实时进度，以便随时知道哪一步在跑

---

## 验收场景（Given-When-Then）

**场景 1**（US-001 接任务）:
- Given Dashboard task 列表里有一个 status=pending 的 task（关联 KR2）
- When 主理人点击该 task 行的"开始开发"按钮
- Then 后端创建对应的 worktree + cp-* 分支，task status 变 in_progress，LiveMonitor 显示该 task 启动

**场景 2**（US-002 回血回填）:
- Given 一个 task 已经 PR merge，关联的 KR 当前进度为 X%
- When callback-processor 接收到 PR 合并 callback
- Then 关联 KR 的进度变为 X+1%（thin 计数法），更新时间 < 5s

**场景 3**（US-003 评估好坏）:
- Given task 完成
- When 评估器运行
- Then 返回硬性结果："此 task 关联的 KR 进度是否真的变化了"（true / false + 数字差异）

**场景 4**（US-004 前端可见）:
- Given 一个 task 正在 in_progress 中
- When 主理人打开 LiveMonitor 页面
- Then 10 秒内看到 task 的 dispatch / in_progress / 完成 状态变化

**场景 5**（Feature 0 E2E）:
- Given 一个 hardcode 关联到 KR2 的最简 task
- When 主理人按"开始开发"
- Then 7 step 全部走通，PR 合并后 KR2 进度 +1%，整个过程 LiveMonitor 都能看到

---

## 功能需求

- **FR-001**: Dashboard task 列表行加"开始开发"按钮（仅对 status=pending 的 task 启用）
- **FR-002**: 新增 API endpoint `POST /api/brain/tasks/{id}/start-dev`，返回 worktree path + branch 名
- **FR-003**: callback-processor 处理 task=completed 时自动触发关联 KR 进度重算（hardcode +1%/task）
- **FR-004**: 新增评估函数 `verifyKRMovement(taskId)`，返回 `{kr_id, before, after, moved: boolean}`
- **FR-005**: LiveMonitor WebSocket 推送频率确保 10s 内 task 状态变化可见
- **FR-006**: 端到端 smoke 测试覆盖 7 step 完整路径

---

## 成功标准

- **SC-001**: Dashboard "开始开发"按钮点击后 < 3s 创建 worktree（成功率 100%）
- **SC-002**: PR merge 到 KR 进度更新延迟 < 5s
- **SC-003**: `verifyKRMovement` 在测试场景下正确返回 moved=true / false
- **SC-004**: LiveMonitor 任务状态变化 P95 延迟 < 10s
- **SC-005**: `tests/e2e/mj1-skeleton-smoke.spec.ts` 全绿
- **SC-006**: MJ1 Notion Maturity 可手动升级到 `skeleton`（所有 7 step thin feature 全 done）

---

## 假设

- [ASSUMPTION] tasks 表已有 `goal_id` / `kr_id` 字段（关联到 KR）。如缺失需要先补 migration（不在本 Sprint 范围）
- [ASSUMPTION] progress-reviewer 模块已存在并提供 `recalculateKRProgress(krId)` 入口，本 Sprint 只接通调用，不重写算法
- [ASSUMPTION] LiveMonitor WebSocket 通道已建好（event-bus + taskEvents），本 Sprint 只调推送频率，不重建协议

---

## 边界情况

- task 没关联 KR：评估函数返回 `{moved: null, reason: 'no_kr_associated'}`，不算失败
- KR 进度计算并发：用 progress-reviewer 现有的 SELECT FOR UPDATE 串行，不引入新锁
- 主理人在同一 task 上点两次"开始开发"：第二次 API 返回 409 + 已存在 worktree path
- Feature 0 smoke 跑失败：必须截图 / log 上传，不能静默失败

---

## 范围限定

**在范围内**:
- F1 后端 endpoint + 前端按钮（最丑可用）
- F2 verifyKRMovement 硬验证函数（hardcode 比较前后值）
- F3 callback 触发 KR 重算（hardcode +1%/task 计数法）
- F4 LiveMonitor 推送频率调优到 10s 内
- F0 端到端 smoke 测试

**不在范围内**:
- KR 进度算法升级（thin 用 +1%/task，不引入业务价值权重）
- "开始开发"按钮 UI 美化（默认 button 样式即可）
- 错误处理完善（thin 阶段允许崩溃，CI 报错就行）
- WebSocket sub-second 实时性（thin 阶段 10s 内可见即可）
- 主理人介入操作（kill/pause）UI（属于加厚段）
- 自然语言提需求（J2 老 journey 的内容，不并入本 thin）

---

## 预期受影响文件

- `apps/dashboard/src/pages/` — F1 按钮 + F4 LiveMonitor 调整
- `apps/api/src/dashboard/routes.ts` — F1 endpoint 注册
- `packages/brain/src/routes/tasks.js` 或 `routes/dev.js` — F1 start-dev handler
- `packages/brain/src/callback-processor.js` — F3 接通 KR 重算
- `packages/brain/src/progress-reviewer.js` — F3 加 thin 计数法入口
- `packages/brain/src/kr-verifier.js` 或新建 — F2 verifyKRMovement
- `packages/brain/src/events/taskEvents.js` — F4 推送频率
- `tests/e2e/mj1-skeleton-smoke.spec.ts` — F0 E2E
- `tests/integration/mj1-*.test.ts` — 各 feature 的 integration test
