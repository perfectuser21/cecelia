# Sprint PRD — AI-Native 开发流程重设计

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：完成后预计推进至 88%
- **说明**：端到端自动化开发流程是"系统可信赖"的核心能力——Harness 从任务派发到功能上线无需人工干预，直接提升系统自治水平

## 背景

Cecelia 的 Harness Pipeline 已具备 Planner→GAN→Generator→Evaluator→Report 的完整链路，Generator 通过 /dev skill 执行代码变更。但当前流程存在关键断点：Generator 创建 PR 后，没有自动 merge、没有自动重启 Brain 加载新代码、没有自动 rebuild Dashboard。Evaluator 验证的仍是旧代码，形成"测旧码"的根本性缺陷。同时 /dev skill 的 4-Stage Pipeline 包含大量面向人类开发者的步骤（Learning 文件、DoD 手动验证、devloop-check 交互式确认），在全自动 Harness 模式下成为不必要的开销和阻塞点。

## 目标

实现 Harness 任务从 Brain 派发到功能上线的完全自动化闭环：Generator 产出 PR → CI 通过 → 自动 merge → 服务自动重启/重建 → Evaluator 验证新代码，全程零人工干预。

## User Stories

**US-001**（P0）: 作为 Cecelia 系统，我希望 Generator 创建的 PR 在 CI 全部通过后自动 merge 到 main，以便新代码能立即进入生产环境

**US-002**（P0）: 作为 Cecelia 系统，我希望 PR merge 后 Brain 自动重启加载新代码，以便 Evaluator 验证的是最新功能

**US-003**（P0）: 作为 Cecelia 系统，我希望 /dev skill 在 Harness 模式下跳过所有面向人类的交互步骤，以便全自动执行不卡住

**US-004**（P1）: 作为 Cecelia 系统，我希望 PR merge 后 Dashboard 自动 rebuild 并部署，以便前端变更也能自动上线

**US-005**（P1）: 作为 Cecelia 系统，我希望整个流程的每个环节都有失败检测和回退机制，以便自动化不会导致系统进入不可恢复状态

**US-006**（P2）: 作为 Cecelia 系统，我希望 CI 中仅保留 Harness 模式所需的必要检查，以便缩短从 PR 到 merge 的等待时间

## 验收场景（Given-When-Then）

**场景 1**（关联 US-001）:
- **Given** Generator 已创建 PR 且 CI 全部 pass
- **When** 最后一个 CI job 完成且状态为 success
- **Then** PR 自动 merge 到 main，无需人工点击

**场景 2**（关联 US-001）:
- **Given** Generator 已创建 PR 但 CI 有 job 失败
- **When** CI 报告 failure
- **Then** PR 不 merge，失败状态回写 Brain 任务记录

**场景 3**（关联 US-002）:
- **Given** Harness PR 已 merge 到 main，且变更涉及 packages/brain/
- **When** merge 事件触发
- **Then** Brain 进程自动重启，新代码生效，停机时间不超过 30 秒

**场景 4**（关联 US-003）:
- **Given** /dev skill 以 Harness 模式启动（task_type 为 harness_generator 或检测到 .harness-mode 标记）
- **When** 进入 Stage 1-4 Pipeline
- **Then** 跳过 Learning 文件生成、DoD 手动验证勾选、devloop-check 交互式确认、Stop Hook 用户确认等步骤

**场景 5**（关联 US-004）:
- **Given** Harness PR 已 merge 到 main，且变更涉及 apps/dashboard/
- **When** merge 事件触发
- **Then** Dashboard 自动 rebuild 并部署到生产环境

**场景 6**（关联 US-005）:
- **Given** Brain 重启失败（进程未能启动或 health check 超时）
- **When** 重启后 health check 连续 3 次失败
- **Then** 自动回退到上一个已知正常的 commit，并在 Brain 任务中记录回退事件

**场景 7**（关联 US-002）:
- **Given** 两个 Harness PR 几乎同时通过 CI
- **When** 第二个 PR 因 merge conflict 无法自动 merge
- **Then** 自动 rebase 并重新触发 CI，或标记为需要人工介入

## 功能需求

- **FR-001**: Harness PR 自动 merge — CI 全 pass 后通过 GitHub API 或 gh CLI 自动 merge PR，仅限 Harness 模式创建的 PR（通过 branch 前缀或 label 识别）
- **FR-002**: Brain 自动重启 — main 分支 merge 事件中如果变更涉及 packages/brain/，触发 Brain 进程重启（pm2/systemd restart 或等效机制）
- **FR-003**: Dashboard 自动部署 — main 分支 merge 事件中如果变更涉及 apps/dashboard/，触发 build + 部署
- **FR-004**: /dev Harness 极简路径 — 检测 Harness 模式后跳过：Learning 文件、DoD 手动勾选验证、devloop-check 交互式确认、Stop Hook 人类确认提示
- **FR-005**: 失败回写 — CI 失败、merge 失败、重启失败等异常事件自动回写 Brain 任务状态（status=failed + error_message）
- **FR-006**: Health Gate — Brain 重启后等待 health check 通过才标记部署成功；超时则回退
- **FR-007**: CI 精简（Harness 模式）— 审查当前 CI jobs，识别 Harness 模式下可跳过的 job（如 Learning Format Gate），缩短反馈周期

## 成功标准

- **SC-001**: Harness Generator 产出的 PR，在 CI 全 pass 后 5 分钟内自动 merge，无需任何人工操作
- **SC-002**: Brain 代码变更 merge 后，Brain 进程在 30 秒内完成重启并通过 health check
- **SC-003**: /dev skill 在 Harness 模式下的执行时间比人类模式减少 40% 以上（去掉 Learning/DoD/devloop-check 等步骤的耗时）
- **SC-004**: 整个流程（任务派发 → PR 创建 → CI → merge → 部署 → Evaluator 验证）端到端无人工干预
- **SC-005**: 任何环节失败时，Brain 任务记录中有完整的 error_message 和失败原因

## 假设

- [ASSUMPTION: Brain 重启停机时间可控在 30 秒以内，不需要蓝绿部署]
- [ASSUMPTION: 仅 Harness 模式（自动派发任务）启用极简路径，人类手动 /dev 保持完整 4-Stage 流程不变]
- [ASSUMPTION: 自动 merge 仅限 Harness 创建的 PR（通过 branch 前缀 cp-* + harness label 识别），人类 PR 仍需手动 review]
- [ASSUMPTION: Dashboard 部署目标是美国 Mac mini 本机，不涉及远程服务器部署]
- [ASSUMPTION: 并行 Harness PR 冲突场景低频，首版可标记为 failed 让 Brain 重新派发，不需要自动 rebase]

## 边界情况

- **CI 部分失败**: 某些非关键 job 失败（如 Learning Format Gate）不应阻止 Harness PR merge → 需要区分 required vs optional checks
- **Brain 重启失败**: 新代码导致 Brain 无法启动 → 需要自动回退机制（git revert + 重启）
- **并行 PR 冲突**: 两个 Harness 任务同时产出 PR，第二个 merge 时冲突 → 标记 failed，Brain 重新派发
- **Evaluator 时序**: Evaluator 必须在 Brain 重启完成后才能验证 → 需要等待 health check 通过的信号
- **非 Brain 变更的 PR**: 如果 Harness PR 只改 Engine 或 Quality 代码，不需要重启 Brain → 部署逻辑需按变更路径条件触发
- **网络/GitHub API 瞬时失败**: auto-merge API 调用失败 → 需要重试机制（3 次，指数退避）

## 范围限定

**在范围内**:
- /dev skill Harness 极简路径设计
- CI job 审查与 Harness 模式优化
- PR 自动 merge 机制
- Brain 自动重启 + health gate
- Dashboard 自动 rebuild/deploy
- 失败检测与回写 Brain
- Evaluator 时序对齐（等待部署完成再验证）

**不在范围内**:
- Harness Pipeline 本身的架构重构（Planner/GAN/Generator/Evaluator 的流程不变）
- 人类 /dev 流程的修改（保持完整 4-Stage Pipeline）
- 蓝绿部署或零停机部署方案
- 远程服务器（HK VPS、CN Mac mini）的自动部署
- 新 CI job 的开发（本次只精简现有 job）
- Brain 数据库 migration 的自动执行（风险过高，保持人工）

## 预期受影响文件

- `packages/engine/skills/dev/` 相关步骤文件：增加 Harness 模式检测，跳过人类交互步骤
- `packages/engine/hooks/stop.sh`：Harness 模式下跳过用户确认逻辑
- `packages/engine/scripts/devloop-check.sh`：Harness 模式下跳过交互式确认
- `.github/workflows/brain-ci.yml`：标记 Harness 模式下可选的 job、增加 auto-merge step
- `packages/brain/src/executor.js`：Harness 任务执行后增加等待 merge+部署的回调
- `packages/brain/src/routes/execution.js`：增加部署状态回写端点
- `scripts/`：新增 auto-deploy 脚本（Brain restart + Dashboard rebuild）
- `/dev skill SKILL.md + steps/*.md`：增加 Harness 模式分支逻辑
