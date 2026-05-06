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

**纪律 — 只立骨架不加厚（关键）**：
- 每个 Feature 严格遵守 thin 标准：端到端能跑 + smoke 通过 + 不依赖未做 feature + 范围 < 1 周
- 允许丑 UI、允许 hardcode、允许 mock
- 任何"完善错误处理"/"美化 UI"/"性能优化"属于范围蔓延，立刻砍掉

---

## OKR 对齐

- **对应 KR**：KR3 — 管家闭环（主理人开发任务可视、可启动、KR 自动回写）
- **当前进度**：MJ1 4 个 feature 全部 thin/building，端到端未贯通
- **本次推进预期**：4 feature 全 thin/done + F0 E2E smoke 全绿 → MJ1 Maturity 升级到 skeleton

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
**US-005**（P0）: 作为主理人，我希望一条 hardcode 的 demo task 能完整走完 MJ1 7 step，以便有可演示的端到端证据

---

## 验收场景（Given-When-Then）

**场景 1**（US-001 接任务，对应 skeleton task）:
- Given Dashboard task 列表里有一个 status=pending 的 task（关联 KR3）
- When 主理人点击该 task 行的"开始开发"按钮
- Then 后端创建对应的 worktree + cp-* 分支，task status 变 in_progress，response 返回 `{worktree_path, branch}`；同 task 重复点击返回 409

**场景 2**（US-002 回血回填，对应 ws2）:
- Given 一个 task 已经 PR merge，关联的 KR 当前进度为 X%（X < 100）
- When callback-processor 接收到 PR 合并 + task=completed callback
- Then 关联 KR 的进度变为 (X+1)%（thin 计数法），更新延迟 < 5s；task 无 KR 关联时不报错跳过

**场景 3**（US-003 评估好坏，对应 ws3）:
- Given 一个 task 已经完成，调用方传入 taskId
- When 调用 verifyKRMovement(taskId)
- Then 返回 `{kr_id, before, after, moved}`，三态正确：moved=true（after>before）/ moved=false（after==before）/ moved=null（无 KR 关联）

**场景 4**（US-004 前端可见，对应 ws4）:
- Given 一个 task 正在 in_progress 中
- When 主理人打开 LiveMonitor 页面
- Then 10 秒内（P95）看到 task 的 dispatch / in_progress / 完成 状态变化

**场景 5**（US-005 Feature 0 E2E，对应 ws5）:
- Given 一个 hardcode 关联到 KR3 的最简 task
- When 主理人按"开始开发"
- Then 7 step 全部走通：①Dashboard 点击 → ②start-dev endpoint → ③worktree 创建 → ④/dev mock 简化版 → ⑤PR merge callback → ⑥KR 进度 +1% → ⑦LiveMonitor 看到状态变化

---

## 功能需求

- **FR-001**: Dashboard task 列表行加"开始开发"按钮（仅对 status=pending 的 task 启用）
- **FR-002**: 新增 API endpoint `POST /api/brain/tasks/{id}/start-dev`，调用现有 worktree 创建逻辑，返回 `{worktree_path, branch}`；同 task 重复调用返回 409
- **FR-003**: callback-processor 处理 task=completed 时自动触发关联 KR 进度重算（thin 计数法 +1%/task，封顶 100%）
- **FR-004**: 新增评估函数 `verifyKRMovement(taskId)`，返回 `{kr_id, before, after, moved: boolean | null}`
- **FR-005**: LiveMonitor WebSocket 推送频率确保 task 状态变化 P95 < 10s 内可见
- **FR-006**: 端到端 smoke 测试 `tests/e2e/mj1-skeleton-smoke.spec.ts` 覆盖 7 step 完整路径，每个 step 显式标识 step 1/2/.../7

---

## 成功标准

- **SC-001**: Dashboard "开始开发"按钮点击后 < 3s 创建 worktree（同 task 重复点击 409）
- **SC-002**: PR merge → KR 进度更新延迟 < 5s
- **SC-003**: `verifyKRMovement` 三态结果（true/false/null）在测试场景下正确返回
- **SC-004**: LiveMonitor 任务状态变化 P95 延迟 < 10s
- **SC-005**: `tests/e2e/mj1-skeleton-smoke.spec.ts` 全绿
- **SC-006**: MJ1 Notion Maturity 可手动升级到 `skeleton`（4 个 thin feature 全 done + F0 全绿）

---

## 假设

- [ASSUMPTION] tasks 表已有 `goal_id` / `kr_id` 字段（关联到 KR）。如缺失需要先补 migration（不在本 Sprint 范围）
- [ASSUMPTION] progress-reviewer 模块已存在并提供入口可被 callback-processor 调用，本 Sprint 只接通调用，不重写算法
- [ASSUMPTION] LiveMonitor WebSocket 通道已建好（event-bus + taskEvents），本 Sprint 只调推送频率，不重建协议
- [ASSUMPTION] worktree 创建逻辑（scripts/worktree-manage.sh 或同等模块）已稳定，start-dev endpoint 直接复用
- [ASSUMPTION] /dev mock 简化版可在 E2E 测试中替换真实 /dev，不需要真跑完整 Generator-Evaluator 链

---

## 边界情况

- task 无 KR 关联：F3 回血回填跳过不报错；F2 verifyKRMovement 返回 `{moved: null, reason}`
- 同 task 重复点击"开始开发"：返回 409，不重复创建 worktree
- KR 进度已 100%：F3 回血回填不再增加，保持 100%
- LiveMonitor 偶发延迟 > 10s：thin 阶段不修复，记录为 known limitation
- task 完成但 PR 未 merge：callback 不触发 KR 更新（callback-processor 必须看到 PR merge 信号）
- E2E smoke 跑通但 KR 进度未 +1%（数据不一致）：判 FAIL，必须修

---

## 范围限定

**在范围内**:
- F1/F2/F3/F4 thin 实现（按上面 FR）
- Feature 0 E2E smoke 测试（`tests/e2e/mj1-skeleton-smoke.spec.ts`）
- 每 Feature 配套 integration test（`tests/integration/mj1-*.test.ts`）

**不在范围内**:
- 多 KR 加权计算（thin 阶段 +1%/task 即可）
- KR 进度算法重写
- LiveMonitor UI 美化或交互优化
- 错误处理完善（thin 接受简单 try/catch + 跳过）
- 性能优化（thin 接受现有协议）
- 真实 /dev 链路集成测试（E2E 用 mock 简化版）
- migration（假设已有 goal_id/kr_id 字段）

---

## 预期受影响文件

- `apps/dashboard/src/pages/`：F1 "开始开发"按钮 + F4 LiveMonitor 微调
- `apps/api/src/dashboard/routes.ts`：F1 endpoint 路由声明（如有 API gateway 层）
- `packages/brain/src/routes/tasks.js`：F1 start-dev handler（POST /tasks/:id/start-dev）
- `packages/brain/src/callback-processor.js`：F3 收到 task=completed 后触发 KR 进度重算
- `packages/brain/src/progress-reviewer.js`：F3 thin 计数入口（incrementKRProgressByOnePercent 或同等）
- `packages/brain/src/kr-verifier.js`：F2 verifyKRMovement 函数
- `packages/brain/src/events/taskEvents.js`：F4 推送频率/buffer 调整
- `tests/e2e/mj1-skeleton-smoke.spec.ts`：F0 7 step 端到端 smoke
- `tests/integration/mj1-start-dev.test.ts`：F1 接口契约测试
- `tests/integration/mj1-callback-kr-update.test.ts`：F3 回血回填测试
- `tests/integration/mj1-verify-kr-movement.test.ts`：F2 三态评估测试
- `tests/integration/mj1-livemonitor-latency.test.ts`：F4 推送延迟测试
