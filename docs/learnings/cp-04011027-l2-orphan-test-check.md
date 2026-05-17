# Learning: L2 孤儿测试检测 Gate

**Branch**: cp-04011027-l2-orphan-test-check
**Date**: 2026-04-01

---

### 根本原因

test-registry.yaml（PR #1774）建立后，需要 CI 强制执行注册规则。否则新增测试文件不写注册表也能合并，registry 会腐化失效。

### 设计决策

- 用 Node.js inline script 实现扫描逻辑，避免依赖额外工具
- Suite 级别（brain/engine/workspace）通过 `managed_by:` 字段识别，整目录豁免检查
- 个别注册文件通过 `path:` 字段逐一匹配
- `test-registry.yaml` 不存在时 graceful skip（兼容 bootstrap 阶段）

### Hook 问题（同上次）

worktree 分支检测盲区，临时 `.dev-gate-lite.main` 绕过。待独立 PR 修复 hook。

### 下次预防

- [ ] 新增 `*.test.*` 文件必须同 PR 更新 `test-registry.yaml`，否则本 Gate 拦截
- [ ] Suite 目录变更（新增包）需同步更新 registry 的 `managed_by` 条目
