# Learning: RCI 自维护闭环——增/删/改全自动强制

Branch: cp-03231201-rci-self-maintain
Date: 2026-03-23

## 实现内容

1. `check-rci-stale-refs.cjs` — 扫描 regression-contract.yaml 所有 `file:` / `test: tests/` 引用，悬空引用 → exit 1
2. `detect-priority.cjs` 新增 `CHANGED_FILES` 路径自动识别 — 改动核心 hook 文件时自动升 P0
3. `ci-l1-process.yml` 新增 `rci-stale-refs-check` job，每次 PR 自动跑
4. 修复 regression-contract.yaml 中已有的悬空引用（旧路径无 `packages/engine/` 前缀等）

### 根本原因

RCI 186条无自动防腐机制：
- 文件被删除/重命名后，regression-contract.yaml 中的 `file:` 引用变成悬空死链
- P0/P1 判断依赖人工标注，核心 hook 改动实际几乎不触发 RCI 更新强制
- 没有 CI 门禁，悬空引用可以静默合并进 main

### 下次预防

- [ ] 新建 `file:` 引用时，确认路径相对于 repo root 存在（用 `node check-rci-stale-refs.cjs` 本地验证）
- [ ] 删除/重命名文件时，同步搜索 regression-contract.yaml 中对应引用并更新
- [ ] 核心 hook 文件（`packages/engine/hooks/*.sh`, `lib/devloop-check.sh`）改动时，`CHANGED_FILES` 自动升 P0 触发 RCI 强制更新检查
- [ ] CI L1 stale-refs gate 会在每次 PR 时验证，无需手动排查
- [ ] regression-contract.yaml 中 `file:` 引用有两种基准路径：相对于 `packages/engine/`（如 `hooks/*.sh`、`tests/`）和相对于 repo root（如 `.github/workflows/`）——check-rci-stale-refs.cjs 需两处都检查，只要有一处存在即有效
