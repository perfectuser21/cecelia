# ci-behavior-dynamic（2026-04-19）

### 根本原因

CI 从设计上就把"动态验证"搁置了：`ci.yml:221` 的 DoD BEHAVIOR 命令执行步骤对 5 类命令（`curl / chrome: / psql / bash / npm`）显式 `echo "跳过"`。只有 `node` 命令真执行。

后果：

- DoD 里写的"API 可达"、"DB schema 状态"、"服务响应"等行为验证，CI 从来没跑过
- 写 DoD 的人看到"BEHAVIOR 验证完成 — 通过 X"以为门槛设好了，实际 X 只统计了 node 命令
- 出 bug 时根本不是 CI 拦下来的，是事后人工才发现

同时 TASK_CARD 文件扫描用的是老命名 `.task-*.md / task-card.md`，而 /dev 当前标准是 `DoD.md`。两个 bug 同源 —— 命名约定改过，运维脚本 / CI 步骤都没跟着改。这是第三次发现同一个模式（前两次是 cleanup regex、dod-behavior 文件扫描）。

### 下次预防

- [ ] 当任何 CI 步骤里出现 `echo "跳过"` 或 `echo "⏭"`，必须在代码注释或 PR 里明确说明"为什么现在跳过、什么时候补上"，并在 repo-audit 每月复盘时检查这些"skip 债务"
- [ ] 新增一类文件名约定（大小写、前缀、后缀变化）时，**用全仓 grep 检查所有脚本里的文件列表**，不只改文档，改脚本
- [ ] Brain 启动等待 `/api/brain/health` 就绪的逻辑（本 PR 实现）以后可复用：任何需要"起 Brain 测 API"的 CI job 都按同样模式（60s 循环 curl + health check）
- [ ] dod-behavior-dynamic 的早退机制（无动态命令时跳过 Brain 启动）是必要的，不然每个 PR 都花 ~30s 起 Brain
