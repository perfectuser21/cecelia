# Kernel Contract Artifact Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with RED/GREEN checkpoints.

**Goal:** 将 approved SHA 上的完整合同测试资产不可变地送入冻结 Generator workspace，并让确定性 assembly fault 精确收尾、可创建 successor 恢复执行。

**Architecture:** approval 层从精确 Git revision 收集 allowlist 资产并与 contract 原子持久化；Dispatcher 从数据库构造自校验 TaskBundle；Runner 在 Provider 启动前校验并物化；orchestrator 将资产错误和确定性 Impact 错误与可重试基础设施错误分流；Brain 启动时立即运行一次受 CAS 保护的 recovery scan。

**Tech Stack:** Node.js ESM/CJS, PostgreSQL 15, Zod, Vitest, Bash, SHA-256.

---

### Task 1: 冻结资产合同与数据库原子性

**Files:**
- Create: `packages/brain/migrations/<next>_initiative_contract_artifacts.sql`
- Create: `packages/brain/migrations/rollback/<next>_initiative_contract_artifacts.down.sql`
- Create: `packages/brain/src/orchestrator/contract-artifacts.js`
- Modify: `packages/brain/src/orchestrator/contract-store.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Test: `packages/brain/src/orchestrator/__tests__/contract-artifacts.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/contract-store.integration.test.js`

- [ ] 写 RED：精确 revision 收集 PRD/draft/DoD/可选 task-plan/tests，测试为空、路径非法、读取失败、重复路径、超 256 KiB 均拒绝。
- [ ] 写 RED：合同和资产同事务成功；任一资产失败时两者均不落库；已批准资产不可被不同摘要覆盖。
- [ ] 实现纯收集/规范化/摘要模块和 additive migration。
- [ ] 将批准动作改成先收集、后原子持久化，保留跨 repo 精确 SHA 读取。
- [ ] 运行目标 unit/integration，提交 RED 与 GREEN 两个独立 Conventional Commits。

### Task 2: TaskBundle 传输与 Runner 物化

**Files:**
- Modify: `packages/brain/src/orchestrator/execution-contract.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/scripts/fleet-worker/attempt-runner.cjs`
- Test: `packages/brain/src/orchestrator/__tests__/execution-contract.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/scripts/fleet-worker/__tests__/attempt-runner.test.cjs`

- [ ] 写 RED：Bundle 包含按 path 排序的冻结资产且来源只允许 contract rows。
- [ ] 写 RED：Runner 在 Provider 启动前物化七个测试；遍历、绝对路径、重复项、长度/摘要不符、写后篡改全部精确失败。
- [ ] 扩展 Zod contract 与 Dispatcher 查询，实施总量上限。
- [ ] 在 Runner prepare 阶段完成校验、写入和回读，不改变 frozen baseline Git lineage。
- [ ] 运行目标 suite 与 fleet runner suite，提交 RED/GREEN。

### Task 3: 确定性错误分类与有界收尾

**Files:**
- Modify: `packages/brain/src/orchestrator/derive.js`
- Modify: `packages/brain/src/orchestrator/loop.js`
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Test: `packages/brain/src/orchestrator/__tests__/derive.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/loop.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

- [ ] 写 RED：三类 artifact fault 在 Provider attempt 创建前停止，不进入 human review，不重复相同状态。
- [ ] 写 RED：Impact schema/parse 错误确定性收尾；网络/进程/暂态数据库错误按既有上限重试。
- [ ] 增加稳定 error code 与分类器，确保 failure reason 保留原始根因。
- [ ] 运行 derive/loop/dispatcher 回归，提交 RED/GREEN。

### Task 4: 启动恢复与 Impact Contract canonicalization

**Files:**
- Modify: `packages/brain/src/tick-loop.js`
- Modify: `packages/brain/src/harness-watchdog-loop.js`
- Modify: `packages/brain/src/orchestrator/impact-contract.js`
- Test: `packages/brain/src/__tests__/harness-watchdog-loop.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/impact-contract.test.js`

- [ ] 写 RED：启动立即 scan 一次，周期 timer 仍存在，并发启动通过 CAS 只恢复一次。
- [ ] 写 RED：schema parse 后 canonical hash；`head_revision: null` 不制造新版本。
- [ ] 接入 eager scan，保持 hard-off/minimal 隔离与现有 lease/staleness 条件。
- [ ] 统一 canonicalization 顺序，运行目标回归并提交 RED/GREEN。

### Task 5: 真实验收、PR、部署与 successor

**Files:**
- Modify: `packages/brain/DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: repository lock/version files required by version sync
- Create/Modify: sprint DoD evidence only if `/dev` scaffold requires it

- [ ] 在 `cecelia_test` 应用 migration 并验证表、约束、原子 rollback 与实际摘要。
- [ ] 用 approved SHA `6faaa9f...` 构造真实 TaskBundle，证明七个测试在 Provider 前落到隔离 workspace 且摘要逐项相等。
- [ ] 运行所有目标 suites、Brain affected suites、三项 DevGate、version sync、DoD mapping、`git diff --check`。
- [ ] 请求代码审查，修复发现后复跑完整证据。
- [ ] push feature branch、创建 PR、等待 CI 全绿并按正常流程合并。
- [ ] 部署 Brain，确认健康/version/schema；创建带 predecessor lineage 的 successor task/run。
- [ ] 观察 successor 越过 generate，确认 Provider 取得七个冻结测试并产出 Unified Work Router 实现 PR。
