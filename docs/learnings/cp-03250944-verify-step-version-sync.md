# Learning: Hook-CI 耦合重构 R12 — verify-step.sh Gate 0d 调用 check-version-sync.sh

## 背景
在 `packages/engine/hooks/verify-step.sh` 的 Gate 0d 末尾追加对 `check-version-sync.sh` 的调用，消除"本地通过但 CI 失败"的版本不同步问题。

### 根本原因
Gate 0d 只做同目录 sibling 文件的版本一致性扫描，不调用 CI 中使用的 `check-version-sync.sh`。

这导致本地 verify-step.sh 可以通过，但 push 到 CI 后因版本文件不同步而失败，形成不必要的调试循环。

根本缺口：本地 Hook 与 CI 脚本之间存在覆盖盲区，本地不感知 CI 版本检查逻辑。

### 下次预防
- [ ] 本地新增 verify-step Gate 时，确认该 Gate 与 CI 所用的对应 check 脚本保持一致
- [ ] `jq` 等非标准工具依赖的功能必须做 `command -v` 检查并提供优雅降级
- [ ] Engine 版本 bump 必须同步 5 个文件：`package.json` / `package-lock.json` / `VERSION` / `.hook-core-version` / `regression-contract.yaml`
