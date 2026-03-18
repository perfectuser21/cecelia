# Learning: cto-review 改用 git diff + enriched PRD 本地写入

## 背景

cto-review Skill 在 /dev Step 2 完成后（push 之前）触发，此时没有 PR，`gh pr diff` 无法使用。
同时 intent_expand 完成后 enriched PRD 只存在 Brain task metadata 里，coding agent 本地读不到。

### 根本原因

1. **cto-review diff 命令错误**：SKILL.md 使用 `git diff main...HEAD`（无 origin/），在 push 前 remote 分支不存在时会报错或获取到错误 diff。正确应使用 `git diff origin/main...HEAD`，引用远端 main 而不是本地追踪分支。

2. **enriched PRD 本地不可达**：intent_expand 将 enriched PRD 写入 Brain task `metadata.enriched_prd` 字段，但 coding agent（claude-code）无法直接查询 Brain API。devloop-check.sh 已有调用 Brain API 的逻辑，是写入本地文件的最佳位置。

### 下次预防

- [ ] cto-review 类 Skill 使用 diff 时，必须用 `origin/main...HEAD` 而非 `main...HEAD`，避免 push 前本地 ref 不存在的问题
- [ ] 外部服务（Brain）返回的关键数据，若 coding agent 需要访问，应在 devloop-check.sh 等 shell 层写入本地文件（"本地文件是 agent 的 stdin"原则）
- [ ] packages/workflows/ 下的文件改动，必须在 packages/workflows/ 目录下放 per-branch PRD/DoD（hook 就近检测）
