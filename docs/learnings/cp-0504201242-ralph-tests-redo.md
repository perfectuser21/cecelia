# Learning — Stop Hook Ralph 模式测试补全（重做）

分支：cp-0504201242-ralph-tests-redo
日期：2026-05-04
Brain Task：b7820794-6444-46ce-8496-706e18e6d4d6
前置 PR：#2752 (Ralph Loop 模式) + #2754/#2755 (spec/learning 已合)

## 背景

PR #2752 落地 Ralph Loop 三层防御后留下测试 gap：12 场景 E2E describe.skip / verify_dev_complete 0 单测 / 无 smoke。

第一次尝试在写完测试代码但未 commit 时被自动化推到 main 但代码丢失（只 commit 了 spec/learning）。本 PR 重做。

## 根本原因

未及时 commit 测试代码，让自动化只 catch 了已 commit 的文件，未 commit 的代码丢失。

## 本次解法（三 Phase）

- **Phase A**：12 场景 E2E unskip + Ralph 协议适配（HAPPY PATH 场景 10 + cwd 漂移修复 11/12）
- **Phase B**：verify_dev_complete unit test 21 case
- **Phase C**：ralph-loop-smoke.sh 端到端 12 case

## 下次预防

- [ ] 测试代码写完立刻 commit，避免被自动化 worktree 清理时丢失
- [ ] 测试断言对 jq 输出用正则 `\s*` 容忍空格
- [ ] PATH 隔离测试保留 /usr/bin /bin（jq/grep/awk 必需）

## 测试覆盖完整图景（Ralph 模式 v21.0.0+）

| 层 | 文件 | case 数 |
|---|---|---|
| unit | tests/unit/verify-dev-complete.test.sh | 21 |
| integration | tests/integration/ralph-loop-mode.test.sh | 5 |
| E2E | tests/e2e/stop-hook-full-lifecycle.test.ts | 12 |
| smoke | scripts/smoke/ralph-loop-smoke.sh | 12 |
| **总** | | **50** |

## 验证证据

- Phase A 12/12 ✅
- Phase B 21/21 ✅
- Phase C 12/12 ✅
- 全 stop-hook 套 110 PASS / 32 skipped / 0 fail
- check-single-exit Ralph 守护 ✅
- 8 处版本文件同步 18.19.1
