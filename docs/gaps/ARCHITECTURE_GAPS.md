---
id: architecture-gaps
version: 1.1.0
created: 2026-03-10
updated: 2026-03-10
authority: GAP_REPORT
changelog:
  - 1.0.0: 初始审计版本
  - 1.1.0: 归档至 docs/gaps/，明确 GAP_REPORT 定位
---

# 架构缺口报告

> **Authority: GAP_REPORT**
> 本文档是审计结果，不是 instruction book。
> 记录：文档缺失、流程不透明、代码-文档不一致、待审计盲区。
>
> 对应当前事实文档：`docs/current/`

---

## 优先级定义

- **P0**：阻塞理解或维护，可能导致错误操作
- **P1**：影响运营透明度，但不立即阻塞
- **P2**：改善体验，可延后

---

## 一、代码-文档不一致（最高风险）

### [P0] MEMORY.md 中 local-precheck.sh 记录与代码不符

MEMORY.md（PR #754）记录"新增 `scripts/local-precheck.sh`"，但当前 main 分支**不存在此文件**。

**当前影响**：DEV_PIPELINE 描述的"统一本地预检"无法一键执行，开发者需手动逐条运行。
**建议**：重建该文件，或删除 MEMORY.md 中的引用。

---

### [P0] MEMORY.md 中 brain-ci 拆分记录与代码不符

MEMORY.md（PR #755，2026-03-10）描述 brain-ci 已拆分为 `brain-unit`（ubuntu，无 DB）+ `brain-integration`（macOS，PostgreSQL）。
但实际 `brain-ci.yml` 只有一个 `brain-test` job（macOS + PostgreSQL）。

**当前影响**：不清楚是否有"无 DB 单元测试"能力。若 PR #755 已合并，brain-ci.yml 应已更新。
**建议**：确认 PR #755 合并状态，修正 MEMORY.md 或 brain-ci.yml。

---

### [P0] MEMORY.md 中 engine-ci 三层拆分与代码不符

MEMORY.md（PR #755）描述 engine-ci 拆分为 `l1-process / l2-consistency / l3-code` 三个独立 job。
但实际 `engine-ci.yml` 是**单个 `test` job** 包含所有检查。

**当前影响**：文档与代码分裂，维护者可能被误导。
**建议**：同上，确认 PR #755 状态。

---

~~### [P0] 四层 gate CI 架构尚未落地~~
**已解决（2026-03-10）**：四层 gate 确认已在 main 分支落地（ci-l1-process.yml 等）。
初次审计错误地在旧功能分支（cp-03101600-fix-isolate-batch34）上运行，误以为不存在。
CI_PIPELINE.md v1.1.0 已修正。

---

## 二、未完整审计的 CI Workflows

### [P1] deploy.yml 内容未审计

当前四层 gate 已审计完整，但 `deploy.yml` 内容不清楚：部署触发条件、目标环境、回滚机制。

### [P1] auto-version.yml 详细逻辑未审计

已知：push → main 后根据 commit 前缀 bump 版本，更新 5 个文件。
不清楚：具体实现、失败处理、版本冲突处理。

---

## 三、流程不透明

### [P0] cecelia-bridge → cecelia-run 调用链

Brain 派发任务的完整链路（bridge → run → claude）不透明：
- `cecelia-run.sh` 路径（`/Users/administrator/bin/cecelia-run`，不在 git 追踪）
- root 运行时自动 sudo 切换机制
- LaunchDaemon plist 文件（`/Library/LaunchDaemons/com.cecelia.brain.plist`）内容

### [P1] execution-callback 回调格式

`POST /api/brain/execution-callback` 的 payload 格式、失败/超时处理路径、与熔断器的联动逻辑均无文档。

### [P1] 熔断器触发条件

熔断器端点（`/api/brain/circuit-breaker/{name}/reset`）存在，但触发条件、保护的服务范围、熔断后恢复流程无文档。

### [P1] 警觉等级系统（alertness）

`src/alertness/` 目录存在，`GET /api/brain/alertness` 端点存在，但：
- 警觉等级定义（几级、触发条件）无文档
- 与 tick.js 和任务派发的联动机制不透明

### [P1] cortex.js _reflectionState 机制

MEMORY.md 记录了 SHA256 key 计数熔断机制（≥2 熔断，30min 窗口），但无对应代码级测试文档。

---

## 四、未文档化的系统部分

### [P0] apps/api REST API 文档缺失

`apps/api/` 有 28 个功能模块，但无端点列表、请求/响应格式文档。
仅有 `docs/WEBSOCKET-API.md`，REST API 完全无文档。

### [P0] apps/dashboard 架构文档缺失

React UI 无组件架构文档、路由结构说明、与 apps/api 的数据流说明。

### [P1] packages/quality 内容未审计

质量基础设施（contracts, adapters, heartbeat）的检测指标、Brain 集成方式、告警机制均不透明。

### [P1] 54 个 Workflow Skills 无索引

`packages/workflows/skills/` 有 54 个技能实现，无技能索引文档（名称、职责、状态、测试覆盖情况）。

### [P1] N8N Workflow 配置未文档化

`packages/workflows/n8n/` 内容、与 Brain 任务派发的关系、cecelia-launcher workflow 恢复流程仅在 CLAUDE.md 有提及。

### [P2] scripts/devgate/ 与 packages/engine/scripts/devgate/ 关系

两处都有 devgate 脚本，Brain CI 用根目录版本，Engine CI 用 engine 包内版本。
是否维护两份副本？同步策略不清晰。

### [P2] src/desire/ 目录用途

`packages/brain/src/desire/` 存在，职责不明。

### [P2] planner.js KR 轮转评分算法

决定任务优先执行顺序的核心算法仅在代码中，无独立文档。

---

## 五、建议优先行动

| 优先级 | 行动 |
|--------|------|
| P0 | 确认 PR #755 合并状态，修复 MEMORY.md 与 brain-ci.yml 不一致 |
| P0 | 重建 `scripts/local-precheck.sh` 或删除 MEMORY.md 引用 |
| P0 | 补充 `apps/api` REST API 文档 |
| P1 | 审计 quality-ci.yml / workflows-ci.yml / workspace-ci.yml / devgate.yml |
| P1 | 补充 cecelia-bridge → cecelia-run 调用链文档 |
| P1 | 创建 54 个 Workflow Skills 的索引文档 |
| P2 | 明确 scripts/devgate/ 与 packages/engine/scripts/devgate/ 同步策略 |
