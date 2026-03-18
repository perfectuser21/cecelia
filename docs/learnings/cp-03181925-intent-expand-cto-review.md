# Learning: AI Coding 意图扩展 + CTO Review 两阶段前置审查集成

**Branch**: cp-03181925-intent-expand-cto-review
**Date**: 2026-03-18
**PR**: #1084

## 概述

在 devloop-check.sh 中新增两个前置审查等待条件（条件1.5 intent_expand、条件2.5 cto_review），并在 01-taskcard.md / 02-code.md 中新增对应的 Brain API 触发指令，解决 AI coding 意图损耗问题。

### 根本原因

**问题1：devloop-check.sh 条件插入位置的正确性**

条件1.5（intent_expand 等待）必须在条件1（PR创建检查）**之前**插入，条件2.5（cto_review 等待）必须在条件2（CI检查）**之前**插入。如果在条件检查**之后**插入，则 devloop 已经进入了 push 阶段，审查等待会失效。正确的顺序应为：
```
条件1.5 intent_expand等待 → 条件1 PR已创建 → 条件2.5 cto_review等待 → 条件2 CI通过 → 条件3 PR合并
```

**问题2：DoD Test 命令中绝对路径在 CI 环境不存在**

Task Card 中 `Test: manual:bash -c "cd /Users/administrator/perfect21/cecelia && ..."` 在 CI runner（ubuntu-latest）上执行时，`/Users/administrator/perfect21/cecelia` 路径不存在，导致 DoD Verification Gate 失败。CI 执行时工作目录已是仓库根目录，应直接使用相对路径。

**问题3：预存在 bug — codex runner.sh 在 set -euo pipefail 下 grep 失败退出**

`runner.sh` 第110行：`grep -E '^OPENAI_API_KEY=' "$CREDENTIALS_FILE"` 在 credentials 文件不包含该 key 时，grep 返回退出码1，触发 `set -e` 使脚本提前退出。此 bug 导致 dry-run 测试失败。修复方法：在 grep 后加 `2>/dev/null || true`。

**问题4：bash-guard.sh hook 在主仓库 main 上下文运行**

bash-guard.sh 在 worktree 外部的 Claude Code 上下文中运行，`git rev-parse --abbrev-ref HEAD` 返回主仓库的 `main`，导致 verify-step.sh 找不到 worktree 中的代码改动，无法写入 step_2_code: done。worktree 中的开发需要通过直接触发 PR 来驱动后续流程，而非依赖 .dev-mode step 标记。

### 下次预防

- [ ] devloop-check.sh 中新增条件时，先画出完整的条件序号顺序图，确认插入位置正确
- [ ] Task Card DoD Test 命令统一使用相对路径，禁止 `/Users/...` 绝对路径
- [ ] `manual:bash` 命令白名单：只允许 `node`/`npm`/`curl`/`bash`/`psql`，禁止 `grep`/`ls`/`cat` 直接暴露（须包在 `bash -c` 内）
- [ ] 改 runner.sh / bash 脚本时，检查 `set -euo pipefail` 下每个管道命令是否会因非零退出码提前退出，尤其是 `grep`
- [ ] feature-registry.yml 变更后，立即在同一 commit 中运行 `generate-path-views.sh` 并 stage 生成的 docs/paths/ 文件，不要留到下一个 commit

## 关键技术细节

### devloop-check.sh 条件扩展模式

新增的条件1.5和2.5与现有条件3.5（review_task_id）完全对称：

```bash
# 条件 X.5: 等待某个 Brain Task 完成
if [[ -f "$dev_mode_file" ]]; then
    local task_id local_status
    task_id=$(grep "^{field}_task_id:" "$dev_mode_file" | awk '{print $2}')
    local_status=$(grep "^{field}_status:" "$dev_mode_file" | awk '{print $2}')
    if [[ -n "$task_id" && "$local_status" != "completed" ]]; then
        # 调用 Brain API 查询实时状态
        # 若完成则更新本地缓存，否则返回 blocked
    fi
fi
```

### intent_expand 触发时机

在 Step 1（TaskCard）完成写入 .dev-mode 后、进入 Step 2（Code）之前触发。要求 .dev-mode 中已有 `brain_task_id` 字段（由 `--task-id` 参数写入）。

### cto_review 触发时机

在 Step 2（Code）本地验证通过后、首次 push 之前触发。diff 信息通过 `git diff main...HEAD --stat` 获取并传递给 Brain API。

## 版本

Engine v12.99.0（含 devloop-check.sh 条件1.5/2.5、runner.sh dry-run bug 修复）
