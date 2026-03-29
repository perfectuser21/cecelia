# Learning: CURRENT_STATE 全链路集成测试

**Branch**: cp-03281950-de276f80-79a3-461a-8d2b-adbf61
**Date**: 2026-03-29

## 任务概述

为 `write-current-state.sh` 编写集成测试，验证脚本运行后 CURRENT_STATE.md 包含所有必需章节。

## 根本原因

**node_modules/.bin/cat 劫持问题**

在 vitest singleFork 测试环境中，`process.env.PATH` 包含项目 `node_modules/.bin` 目录，其中有一个名为 `cat` 的 Node.js 脚本（来自某 npm 包）。当 bash 执行 `cat > file <<HEREDOC ... HEREDOC` 时，bash 找到的是 `node_modules/.bin/cat`（一个 Node.js 脚本），而非 `/bin/cat`（系统真实命令）。

Node.js 脚本无法正确处理 bash heredoc 的 stdin 管道，导致：
- 文件被创建（`cat >` 的重定向生效）
- 但内容为空（Node.js cat 脚本不能消费 heredoc 管道中的数据）
- 脚本仍然以退出码 0 结束

这个问题隐藏极深：脚本完整执行（三条 echo 均输出），文件存在，但内容为 0 字节。

## 诊断路径

1. 发现：vitest singleFork 中 `echo test | cat` 输出为空，但 `echo test | tee file` 正常
2. 关键命令：`which cat` → 返回 `node_modules/.bin/cat`（Node.js 脚本！）
3. `echo test | grep test` 正常、`tee` 正常，唯独 `cat` 异常，确认是命令劫持

## 修复方案

在 `spawnSync` 调用中使用硬编码的系统 PATH，不传递 `process.env.PATH`：

```typescript
PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
```

同时改用 `spawnSync`（替代 `execSync`）以获取 stdout/stderr/status 分离，便于错误诊断。

## 额外改动

`scripts/write-current-state.sh` 新增 `CURRENT_STATE_OUTPUT_FILE` 环境变量支持（测试隔离用），避免多进程竞争主仓库的 CURRENT_STATE.md。

## 下次预防

- [ ] 在 bash 测试中，永远不要使用 `process.env.PATH`；始终使用硬编码的系统 PATH
- [ ] `spawnSync` 调用 bash 脚本时，检查 `which cat`、`which python3` 是否指向 node_modules/.bin
- [ ] 使用 `spawnSync` 而非 `execSync`，以便捕获 exit code 和 stderr 分开诊断
- [ ] UUID 命名临时文件（而非 `process.pid`）避免模块多次加载时的路径冲突
