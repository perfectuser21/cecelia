# Kernel Harness Terminal Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Kernel Harness 严格接纳 Codex 已完成 turn 的合法结果，并消除 Planner/Proposer 跨 Run 分支冲突。

**Architecture:** Runner 从 JSONL、最终消息文件和现有安全闸组合出不可宽松伪造的终态收据；Brain 用 run ID 生成唯一 Planner/Proposer ref，并按 run 发现 proposal。所有既有 fail-closed 闸保持优先级。

**Tech Stack:** Bash、jq、Node.js、Vitest、Docker、GitHub Actions

---

### Task 1: Codex 完成收据

**Files:**
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Modify: `packages/brain/src/routes/harness-callback.js`
- Test: `docker/cecelia-runner/entrypoint-provider-contract.test.sh`
- Test: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [x] 写 Red：exit 1 + `agent_message` + `turn.completed` + 相同结果文件应恢复；缺事件、结果不一致、`turn.failed` 不恢复。
- [x] 运行 `bash docker/cecelia-runner/entrypoint-provider-contract.test.sh`，确认因缺少严格收据函数而失败。
- [x] 实现 `validate_codex_terminal_receipt`，只在完整收据成立时把 Provider 判为完成，并写入原始退出码元数据。
- [x] Brain callback 仅接受 `cli_exit_code=1..255` 与 `terminal_receipt=turn.completed` 的成对恢复证据，拒绝其他新增元数据。
- [x] 重跑合同测试，确认 Green。

### Task 2: Planner/Proposer 分支跨 Run 唯一

**Files:**
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Modify: `packages/brain/src/orchestrator/ground-truth.js`
- Modify: `docker/cecelia-runner/entrypoint.sh`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Test: `packages/brain/src/orchestrator/__tests__/ground-truth.test.js`
- Test: `docker/cecelia-runner/__tests__/entrypoint-planner-finalizer.test.sh`

- [x] 写 Red：同 task/hop、不同 run 生成不同 Planner/Proposer ref。
- [x] 写 Red：两个 finalizer 拒绝错误 run 短 ID，Ground Truth 忽略其他 Run proposal。
- [x] 运行两个定向测试，确认旧命名失败。
- [x] 最小修改 branch builder 与 finalizer 正则，重跑并确认 Green。

### Task 3: 版本、验证、发布

**Files:**
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `infrastructure/fleet/nodes/*.json`

- [x] Brain 版本升级一个 patch 并同步 DEFINITION。
- [x] 运行 DevGate、定向测试、Runner 全部合同测试及相关 Brain 测试。
- [x] 构建 Runner，写入三机同一 digest，重跑 drift/admission smoke。
- [ ] 提交、push、开 PR，等 CI 全绿后 squash merge。
- [ ] 部署 Brain 和 US M4 Runner，确认 tick 仍关闭。
- [ ] 用非 team1 账号重新点火真实任务，验收 Planner→Proposer/Reviewer→Generator→Evaluator/Judge→PR/CI。
