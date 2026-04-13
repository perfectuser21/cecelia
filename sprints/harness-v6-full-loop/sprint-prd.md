# Sprint PRD — Harness Pipeline v6.0 完整闭环

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 90%
- **说明**：Harness Pipeline 是 Cecelia 自动化开发的核心基础设施，v6.0 闭环直接推进"管家闭环"子目标

## 背景

Harness Pipeline v5.0 雏形已跑通（Planner→GAN→Generator→Evaluator→Report），但存在 8 个已验证的断点：Generator PR 不自动合并导致 Evaluator 测旧代码、callback 覆盖 agent verdict、Brain/Dashboard 不自动部署、缺少整体质量评估、pipeline 结束无清理、git push 不可靠导致数据丢失。这些断点导致每次 pipeline 运行需要人工介入 2-4 次，违背"零人工"目标。

## 目标

实现从任务提交到功能上线、验收、清理的端到端零人工干预 Harness Pipeline。

## User Stories

**US-001**（P0）: 作为系统运营者，我希望 Generator PR 在 CI 通过后自动合并，以便 Evaluator 能测试到最新代码而不是旧代码
**US-002**（P0）: 作为系统运营者，我希望 PR 合并后自动重启 Brain 并 rebuild Dashboard，以便新功能立即可用于验收
**US-003**（P0）: 作为系统运营者，我希望 agent 通过 curl 回写的 verdict 不被 callback 覆盖，以便验收结果准确
**US-004**（P1）: 作为系统运营者，我希望所有 agent 结果通过 Brain API 传递而非依赖 git push，以便数据传递可靠
**US-005**（P1）: 作为系统运营者，我希望 Evaluator 在功能验收之外增加整体质量评估，以便发现回归和副作用
**US-006**（P1）: 作为系统运营者，我希望 pipeline 结束后自动清理 orphan worktrees、stale branches 和临时文件，以便系统不积累垃圾
**US-007**（P2）: 作为系统运营者，我希望 Pipeline 仪表盘展示完整的端到端数据链，以便一目了然看到完成率、轮次、耗时

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）— Auto-Merge:
- **Given** Generator 创建了一个 Harness PR 且 CI 全部通过
- **When** CI `ci-passed` check 变为 success
- **Then** PR 在 60 秒内自动合并到 main

**场景 2**（关联 US-001）— Auto-Merge 失败保护:
- **Given** Generator 创建了一个 Harness PR 但 CI 有 check 失败
- **When** CI 报告 failure
- **Then** PR 不自动合并，pipeline 记录失败原因，通知后续环节

**场景 3**（关联 US-002）— Auto-Deploy:
- **Given** Harness PR 刚合并到 main
- **When** merge event 触发 auto-deploy
- **Then** Brain 进程重启 + health check 通过（`/api/brain/health` 200）+ Dashboard rebuild 完成，总耗时 < 3 分钟

**场景 4**（关联 US-002）— Deploy 失败回滚:
- **Given** Auto-deploy 过程中 Brain health check 失败
- **When** health check 连续 3 次超时
- **Then** pipeline 标记 deploy 失败，记录错误，不继续 Evaluator 阶段

**场景 5**（关联 US-003）— Verdict 不被覆盖:
- **Given** Evaluator agent 通过 `curl PATCH /api/brain/tasks/{id}` 回写 `verdict: PASS`
- **When** execution callback 执行 `extractVerdictFromResult`
- **Then** 已有的 agent verdict 被保留，callback 不覆盖

**场景 6**（关联 US-004）— 数据传递去 git 依赖:
- **Given** Generator/Evaluator agent 完成工作
- **When** agent 需要传递结果（PR URL、verdict、report 内容）
- **Then** 结果通过 `curl` Brain API 写入，不依赖 `git push` 到 report_branch/review_branch

**场景 7**（关联 US-005）— 整体质量评估:
- **Given** Evaluator 完成单功能验收（PASS）
- **When** 进入整体质量评估阶段
- **Then** Evaluator 检查：API 端点响应正常（curl 主要端点 200）、Dashboard 页面加载正常（Playwright 无 JS 错误）、无新增 lint 警告

**场景 8**（关联 US-006）— Pipeline 清理:
- **Given** Pipeline 运行完毕（无论 PASS 或 FAIL）
- **When** Report 阶段完成
- **Then** 自动清理：已合并的 `cp-harness-*` 分支被删除、orphan git worktrees 被 prune、`/tmp/cecelia-*` 临时文件被删除

**场景 9**（关联 US-007）— 仪表盘数据链:
- **Given** 一个 pipeline 从 Planner 到 Report 完整运行
- **When** 用户打开 Pipeline Detail 页面
- **Then** 可见：每个阶段的耗时、GAN 对抗轮次、Evaluator 轮次、总 token 消耗、最终 verdict

## 功能需求

- **FR-001**: Auto-Merge — 监听 Harness PR 的 CI 状态，`ci-passed` 成功后调用 `gh pr merge --merge` 自动合并。仅对 `cp-harness-*` 分支生效。
- **FR-002**: Auto-Deploy — PR 合并后执行部署序列：`git pull` → Brain 重启（pm2/systemctl）→ health check 轮询 → Dashboard `npm run build` → 静态文件就绪确认。
- **FR-003**: Verdict 保护 — `extractVerdictFromResult` 检测到 task.result 已含 agent 写入的 verdict 时，跳过覆盖。
- **FR-004**: 数据传递统一 — 所有 pipeline 阶段的结果（PR URL、verdict、report 内容、GAN 轮次）通过 Brain API `PATCH /api/brain/tasks/{id}` 写入 `result` 字段，不依赖 git branch 传递。
- **FR-005**: 整体质量评估 — Evaluator 在单功能验收 PASS 后，执行一轮整体健康检查：Brain API 主要端点 200、Dashboard 首页加载无 JS 错误（Playwright）、`git diff --stat` 无意外文件变更。
- **FR-006**: Pipeline 清理 — Report 阶段末尾执行清理脚本：`git worktree prune`、删除已合并的 `cp-harness-*` 远程分支、清理 `/tmp/cecelia-*`。
- **FR-007**: 仪表盘数据链 — Pipeline execution 记录补全 `stages` 数组，每阶段含 `{name, started_at, ended_at, verdict, token_count}`，前端 Pipeline Detail 页面读取并渲染。

## 成功标准

- **SC-001**: 端到端 pipeline（Planner → GAN → Generator → Auto-Merge → Auto-Deploy → Evaluator → Report → Cleanup）跑通，中间零人工干预
- **SC-002**: Generator PR 在 CI 通过后 60 秒内自动合并
- **SC-003**: 合并后 Brain health check 通过 + Dashboard rebuild 完成，总耗时 < 3 分钟
- **SC-004**: Agent verdict 不被 callback 覆盖（可通过检查 task.result.verdict 在 callback 前后一致验证）
- **SC-005**: Pipeline 结束后无 orphan worktree、无 stale `cp-harness-*` 分支、无 `/tmp/cecelia-*` 文件残留
- **SC-006**: Pipeline Detail 页面展示完整阶段时间线和统计数据

## 假设

- [ASSUMPTION: v6.0 恢复独立 Evaluator agent 是对 v4.0 "砍掉独立 evaluator" 决策的有意演进，原因是实践发现 CI 仅覆盖代码层面，无法覆盖运行时行为验收和 UI 验收]
- [ASSUMPTION: Auto-Merge 仅对 `cp-harness-*` 分支生效，非 harness 分支仍走人工审查]
- [ASSUMPTION: Brain 通过 pm2 管理，重启命令为 `pm2 restart brain`；如实际使用 systemctl，部署脚本需适配]
- [ASSUMPTION: Dashboard rebuild 使用 `npm run build`，静态文件部署到本机，不涉及远程服务器]
- [ASSUMPTION: Playwright 已安装 CLI（`npx playwright`），但浏览器 runtime 需要 `npx playwright install chromium` 初始化]
- [ASSUMPTION: Pipeline execution 表已有 `stages` 或类似字段存储阶段数据；如没有，需新增 migration]
- [ASSUMPTION: GAN 对抗轮次仍无上限（遵循已有决策），v6.0 不改变此设计]

## 边界情况

- **CI 永不完成**：设置 Auto-Merge 等待超时（如 30 分钟），超时后标记 pipeline 失败
- **Brain 重启后 health check 失败**：最多重试 3 次，每次间隔 10 秒，全部失败则中止 pipeline
- **Dashboard build 失败**：记录错误但不阻塞 Evaluator（Brain API 验收仍可进行，UI 验收跳过并标注）
- **并发 pipeline**：同一时间只允许一个 pipeline 执行 deploy 阶段（避免互相覆盖），其他 pipeline 排队
- **Evaluator Playwright 超时**：单页面检查 30 秒超时，超时视为该检查 FAIL 但不阻塞其他检查
- **清理误删**：只清理明确匹配 `cp-harness-*` 模式的分支，不清理其他 `cp-*` 分支
- **agent 崩溃未回写 verdict**：execution callback 兜底，检测到 agent exit 且无 verdict 时标记 CRASH

## 范围限定

**在范围内**:
- Auto-Merge 机制（CI 通过 → 自动合并）
- Auto-Deploy 机制（合并 → Brain 重启 + Dashboard rebuild + health check）
- Verdict 覆盖 Bug 修复
- 数据传递去 git 依赖（统一走 Brain API）
- Evaluator 整体质量评估（API 健康 + Playwright 前端 + 无意外变更）
- Pipeline 清理（worktree + branches + tmp files）
- Pipeline 仪表盘数据链补全

**不在范围内**:
- Planner/GAN/Generator 阶段的改动（v5.0 已验证，不动）
- GAN 对抗轮次限制（已有决策：不加上限）
- 多机分布式 pipeline（当前单机运行）
- Pipeline 成本优化（token 消耗记录但不优化）
- 自动回滚到上一版本（deploy 失败只中止，不回滚）

## 预期受影响文件

- `packages/brain/src/execution.js`：Auto-Merge 逻辑 + verdict 保护 + deploy 触发
- `packages/brain/src/thalamus.js`：新 action type 注册（auto_merge / auto_deploy / pipeline_cleanup）
- `packages/brain/src/task-router.js`：新 task type 路由映射
- `packages/brain/src/routes/tasks.js`：PATCH endpoint verdict 保护逻辑
- `packages/engine/skills/harness-evaluator/SKILL.md`：整体质量评估步骤
- `packages/engine/skills/harness-report/SKILL.md`：清理步骤集成
- `apps/dashboard/src/pages/PipelineDetail.tsx`：阶段时间线渲染
- `packages/brain/migrations/`：新增 pipeline stages 字段（如需）
