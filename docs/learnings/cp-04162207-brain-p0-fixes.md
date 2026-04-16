# Learning: Brain 4 个 P0 死穴 bug 救急修复

**Branch**: cp-04162207-brain-p0-fixes
**Date**: 2026-04-13

## 背景

Cecelia Brain 当前架构 4 天诊断出 4 个 P0 bug，整体成功率 0%。本次救急修复合并到一个 PR，修完预期到 30-40%。与 Phase 1/2 重构并行，不动 harness routing/docker/langgraph。

## 4 个修复

| # | 文件 | 改动 |
|---|---|---|
| 1 | `packages/brain/scripts/cecelia-run.sh` | 两处 setsid 调用末尾加 `</dev/null` |
| 2 | `packages/brain/src/task-router.js` | SKILL_WHITELIST 加 `harness_evaluate → /harness-evaluator` |
| 3 | `packages/brain/src/pre-flight-check.js` | SYSTEM_TASK_TYPES 数组加 `harness_evaluate` |
| 4 | `packages/brain/server.js` | listen 前 `lsof -ti :PORT \| xargs kill -9` |

### 根本原因

1. **Bridge 0 字节根因**：bridge 进程 spawn 后台 claude 时，子进程 stdin 默认继承 bridge 的 stdin。bridge 退出 → stdin EOF → claude 立即检测 EOF 退出，输出 0 字节。修复：把子进程 stdin 重定向到 `/dev/null`，永不 EOF。
2. **harness_evaluate 路由 miss**：v5.0 新增 task_type 时漏加 SKILL_WHITELIST，导致 fallback 到 `/dev`，跑错 skill 直接污染分支。
3. **harness_evaluate pre-flight 卡死**：pipeline 自动生成 harness_evaluate 任务时不带 description（合理，因为是系统任务），但 pre-flight 把它当用户任务校验，必然 fail，整条 pipeline 死锁。
4. **EADDRINUSE 死亡循环**：上次进程未干净退出（OOM/kill -9 残留），Brain 重启直接 EADDRINUSE 崩，systemd 死循环重启没卵用。

### 下次预防

- [ ] 新增 task_type 时 grep 检查 SKILL_WHITELIST + SYSTEM_TASK_TYPES 两个位置都要加
- [ ] 新增 spawn 后台进程的 shell 脚本时强制 `</dev/null` 重定向 stdin（lint 规则）
- [ ] systemd 服务 ExecStartPre 也加端口清理脚本（双保险，应用层 + 服务层）
- [ ] PR 合并前必须有覆盖该 task_type 的端到端测试，不能只靠 unit test

## 验证

`packages/brain/src/__tests__/brain-p0-emergency-fixes.test.js` 7 项 case 全部 PASS：

- Fix 1：plan 模式 + skip-permissions 模式 + 反向扫描所有 setsid 行
- Fix 2：SKILL_WHITELIST 映射断言
- Fix 3：harness_evaluate 任务无 description 时 preFlightCheck 通过
- Fix 4：execSync import + listen 前 lsof/kill 字符串断言

## 边界声明

不改：harness routing 逻辑、docker、langgraph、其他不相关模块。
