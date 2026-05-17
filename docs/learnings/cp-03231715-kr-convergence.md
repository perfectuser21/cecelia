# Learning: KR 优先级收敛与依赖排序引擎

**Branch**: cp-03231715-57a9b810-d1ef-40b7-8bc6-2ba21b
**Date**: 2026-03-24

---

### 根本原因

DoD Test 命令使用相对路径 `node_modules/.bin/vitest` 时，verify-step.sh 从 worktree 根目录执行，而 vitest 安装在 monorepo 根目录（不在 worktree 根目录的 node_modules 下），导致 Gate 2 报 "No such file or directory"。

此外，`[BEHAVIOR]` 条目的 `manual:curl` 测试依赖 Brain 服务运行，而 CI 环境没有启动任何服务，导致 curl 连接拒绝，DoD Verification Gate 和 Engine L1 Process 均报执行失败。

根本原因在于：`[BEHAVIOR]` 类型的集成测试（curl/HTTP）不适合作为 CI DoD 验证命令——CI 是无服务环境，任何依赖运行时的测试必须改用单元测试文件（`tests/` 引用）来替代。

### 解决方案

DoD 中的测试命令改为 `bash -c 'cd packages/brain && npm test 2>&1 | tail -N'`，通过切换到 brain 包目录并使用 `npm test`（内部走 `npx vitest`），绕开了路径查找问题，同时符合 CI 白名单（`bash`/`npm` 均被允许）。

### 下次预防

- [ ] 在 monorepo worktree 中写 DoD Test 命令时，不要用 `node_modules/.bin/vitest` 相对路径，始终用 `bash -c 'cd packages/<pkg> && npm test ...'` 形式
- [ ] 写完 DoD 后先在 worktree 根目录手动跑一次 DoD test 命令验证可执行性，再标记 `[x]`
- [ ] `Math.max(1, ...Object.values(emptyMap))` 虽然结果正确，但语义模糊；当 map 可能为空时，显式检查 `.length > 0` 再调用 `Math.max` 更清晰
