---
id: learning-cp-03161612-fix-coverage-gate
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
branch: cp-03161612-fix-coverage-gate
task: fix test-coverage-required gate 误拦截非 feat commit
---

# Learning: test-coverage-required gate push-to-main 豁免失效

## 根本原因

`test-coverage-required` job 有两个设计盲区：

1. **`PR_TITLE` 只在 `pull_request` 事件中有值**。`push` 到 main（PR 合并后）时 `PR_TITLE` 是空字符串，导致 `[CONFIG]` 豁免失效。

2. **`detect-commit-type` job 对 push 事件永远返回 `should_run_l3=true`**，不检查 commit type。这是正确的（push 到 main 需要运行 L3），但 `test-coverage-required` 脚本内部没有 commit type 检查，只靠名字 `(feat only)` 暗示，实际并未执行。

## 修复方案

在脚本的 `[CONFIG]` PR_TITLE 检查之后，新增 push/workflow_dispatch 场景分支：

```bash
if [ "$EVENT_NAME" = "push" ] || [ "$EVENT_NAME" = "workflow_dispatch" ]; then
  COMMIT_MSG=$(git log HEAD -1 --format="%s")
  # 1. [CONFIG] commit 豁免（从 commit message 读取）
  if echo "$COMMIT_MSG" | grep -q '\[CONFIG\]'; then exit 0; fi
  # 2. 非 feat 类型 commit 跳过
  COMMIT_TYPE=$(echo "$COMMIT_MSG" | sed 's/^\[.*\] *//' | grep -oE '^[a-zA-Z]+' | tr '[:upper:]' '[:lower:]')
  if [ "$COMMIT_TYPE" != "feat" ]; then exit 0; fi
fi
```

## 下次预防

- [ ] CI gate 脚本必须区分 `push` 和 `pull_request` 事件——凡是用 `$PR_TITLE` 做判断的脚本，都需要提供 push 场景的 fallback（从 commit message 读取）
- [ ] `detect-commit-type` 对 push 返回 `should_run_l3=true` 是正确的，但下游 job 如果只对特定 commit 类型生效，必须在 **job 内部** 自行检查，不能依赖 PR_TITLE
- [ ] 新增 CI gate 后，必须在 main 上用 `docs:` commit 测试，验证不会误拦截
