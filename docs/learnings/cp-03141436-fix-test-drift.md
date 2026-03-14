---
id: learning-fix-test-drift
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141436-fix-test-drift
---

# Learning: Engine 测试漂移修复（2026-03-14）

## 测试漂移与 ci-tools/VERSION 同步遗漏（2026-03-14）

### 根本原因

Engine 版本 bump（v12.65.0 → v12.66.1）和 Codex Runner 升级（v2.2.0 → v2.3.0）后，
以下 3 处测试未同步更新：

1. `codex-runner.test.ts`：干跑版本断言写死 `v2.2.0`，runner.sh 启动输出已改为 `v2.3.0`
2. `codex-runner.test.ts`：CODEX_HOME 断言格式 `CODEX_HOME: /path` → `当前账号: /path`（v2.3.0 多账号输出变更）
3. `ci-tools/VERSION`：版本号未随 `package.json` 同步（12.65.0 vs 12.66.1），导致 `install-hooks.sh` 版本验证失败

### 下次预防

- [ ] Engine 版本 bump 时，除 6 个标准文件外，还需同步 `packages/engine/ci-tools/VERSION`（第 7 个文件）
- [ ] Codex Runner 升级时，检查 `tests/codex-runner.test.ts` 中所有版本号和输出格式断言
- [ ] `install-hooks.sh` 从 `package.json` 读版本写入 `.ci-tools-version`，`ci-tools/VERSION` 必须与 `package.json` 一致
