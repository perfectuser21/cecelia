# Learning: 修复状态机与 CI DoD 同步漏洞

branch: cp-03231500-fix-dod-state-sync
date: 2026-03-23

## 问题

verify-step.sh Gate 2 跑 DoD Test，所有 Test 通过 → exit 0，但任务卡里的 `[ ]` 从未改为 `[x]`。
导致 CI `check-dod-mapping.cjs` 永远看到 `[ ]` → PR 被 CI 卡住。
状态机（devloop-check.sh）只看 exit code，不看 `[ ]` 残留 → 状态机放行但 CI 卡住。

### 根本原因

设计缺失：verify-step.sh 的"测试通过"只更新内存计数器 `DOD_PASSED++`，未将文件中 `[ ]` 改为 `[x]`。
状态机没有镜像 CI 的 `[ ]` 检查，导致本地通过 ≠ CI 通过。

## 修复

1. **verify-step.sh**：Gate 2 成功分支加 awk 写回。用行号追踪（`CURRENT_LINE`/`DOD_ITEM_LINE`）+ `awk -v n=LINE 'NR==n{sub(/- \[ \] \[/, "- [x] [")}1'` + mktemp 原子写，跨平台无 sed -i 差异。

2. **devloop-check.sh**：新增条件 2.6（位于 code_review_gate 之后、PR 创建之前），grep 检查任务卡残留 `[ ]` DoD 条目，有残留则 `return 2`（blocked）。

## 下次预防

- [ ] 任何 "Test 通过" 逻辑必须同步修改任务卡文件，不能只改计数器
- [ ] 新增检查点时先问"CI 对应检查是什么"，状态机必须镜像 CI
- [ ] `check-dod-mapping.cjs` 的检查逻辑变化时，devloop-check.sh 必须同步更新

## 设计原则确认

**状态机 = CI 镜像**：本地 devloop-check.sh 通过所有条件 → 保证 CI 通过。不能让 CI 比状态机"更严格"。
