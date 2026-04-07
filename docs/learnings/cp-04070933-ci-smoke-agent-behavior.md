# Learning: CI 覆盖盲区 — 分包过滤导致跨包变更无集成测试

## 问题现象

`brain-integration` job 只在 `packages/brain/` 变更时运行。
当改动发生在 `packages/engine/`、`packages/workflows/`、`.github/`、`docs/` 时，
集成测试（含 golden-path）完全跳过，CI 全绿但系统级链路未被验证。

### 根本原因

monorepo 分包 CI 的设计目标是"只跑受影响的测试"（加速反馈）。
但"系统核心链路"不属于任何单一包，它的正确性不能依赖任何包的变更触发条件。
分包 CI 和系统级 E2E 是两个不同的目的，不能用同一个 `if: changes` 过滤解决。

### 下次预防

- [ ] 系统级关键路径测试（golden-path、agent-lifecycle）必须放在无 `if` 过滤的 job 中
- [ ] 分包 CI（brain-unit、brain-integration）保留 `if: changes` 用于快速反馈
- [ ] 新增测试时先问：这是"包内测试"还是"系统链路测试"？后者放 e2e-smoke
- [ ] `ci-passed` gate 必须显式列出 `e2e-smoke`，确保 PR 合并前必须通过
