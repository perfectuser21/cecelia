---
id: learning-cp-03161106-dev-tdd-scoring
branch: cp-03161106-dev-tdd-scoring
created: 2026-03-16
type: learning
---

# Learning: /dev TDD 两阶段探索 + 任务评分

## 做了什么

给 /dev workflow 加入：
1. TDD 两阶段探索（Step 2.0 浅扫 → Step 2.1 Test Designer Subagent → Step 2.2 深度探索）
2. 任务评分机制（置信度 + 四维执行质量分）

## 根本原因

**为什么要这样做**：原来的"先探索代码再写 DoD"存在 accommodation bias——agent 看完代码实现后，写的测试会偏向"容易通过的路径"而不是"真正验证需求的路径"。通过先锁定 Test Designer 写的测试（此时还不知道实现细节），再去深度探索实现，可以消除这种偏差。

## 踩的坑

1. **PR title 格式冲突**：`[CONFIG][INFRA]` 不被 bash-guard.sh 识别。改为 `[CONFIG] feat(engine): ... [INFRA]` 格式解决。
2. **Task Card/DoD 文件未提交**：L1 CI 要求 `.task-cp-*.md` 或 `.dod-cp-*.md` 必须提交到仓库，本地 worktree 的 untracked 文件需要 `git add` 后提交。
3. **known-failures.json 过期**：`stop-hook-router-tests` 过期日期 2026-03-15 已过，导致 pre-existing 测试失败无法被 L3 跳过。修复方法：延长过期日期到 2026-04-15，同时 PR title 需包含 `[INFRA]`。

## 下次预防

- [ ] worktree 里 untracked 的 `.task-cp-*.md` / `.prd-cp-*.md` 文件在第一次 commit 前必须 `git add`（不只是 `git add -u`）
- [ ] `known-failures.json` 过期日期需要定期检查，建议每次 Engine 版本 bump 时确认是否有即将过期的条目
- [ ] PR title 包含 `[INFRA]` 时，格式必须是 `[CONFIG] feat(scope): 描述 [INFRA]`，而不是 `[CONFIG][INFRA] feat(scope): ...`
