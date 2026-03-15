---
branch: cp-03152247-learning-format-brain-callback
date: 2026-03-15
---

## 04-learning.md 模板与 CI 格式不一致 + Brain callback 无效（2026-03-15）

### 根本原因

1. **Learning 模板格式错误**：04-learning.md 的「记录模板」用 `**粗体**` 标题，但 CI `check-learning.sh` 强制检查 `### 根本原因`、`### 下次预防`、`- [ ]` 三级标题。两者不一致，按模板写出来的 Learning 直接被 CI 拒绝（PR #968 踩坑，需要额外一次 push 修复）。

2. **Brain callback 方式错误**：`update-task-status.sh` 用 PATCH API 标记 dev task 为 completed，但 Brain 路由对 dev task 有校验：没有 `pr_url` 时自动降级为 `completed_no_pr`，导致任务无法真正完成，队列堆积。

### 下次预防

- [ ] 写 Learning 时直接用 `### 根本原因` / `### 下次预防` / `- [ ]` 格式，不看模板也不忘
- [ ] PR 合并后的 Brain 回调必须带 `pr_url`，走 `execution-callback` 而非 PATCH
- [ ] 任何步骤文件改动后，先跑 2.5b CI 镜像检查（`check-learning.sh`）本地验证格式
