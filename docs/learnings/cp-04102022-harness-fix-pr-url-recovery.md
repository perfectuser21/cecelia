### 根本原因

harness_generate WS3 session 崩溃（或输出解析失败），导致 pr_url 未回写 Brain，触发 Brain 创建 harness_fix 任务。

### 下次预防

- [ ] Generator 输出 verdict JSON 后，Brain execution.js 应在解析 pr_url 失败时立即重试（当前已有 ci_fail_type=pr_url_missing 机制）
- [ ] PR 已存在时 harness_fix 直接查 gh pr list --head <branch> 恢复 pr_url，无需重建
