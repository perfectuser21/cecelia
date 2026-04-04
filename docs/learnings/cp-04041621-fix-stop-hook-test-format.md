# Learning: Stop Hook 测试 per-branch 格式迁移

**分支**: cp-04041621-fix-stop-hook-test-format
**日期**: 2026-04-04
**PR**: fix(engine): 修复 stop-hook 测试 per-branch 格式

---

### 根本原因

stop-dev.sh 在 v14.0.0 迁移到 per-branch 格式（`.dev-mode.{branch}` + `.dev-lock.{branch}`），但两个测试文件（`stop-hook-exit-codes.test.ts` 和 `stop-hook-exit.test.ts`）仍在使用旧格式 `.dev-mode`（无后缀）。

由于 stop-dev.sh 扫描 `.dev-lock.*` 才会进入逻辑——旧格式测试只写了 `.dev-mode`（无 `.dev-lock`），导致所有测试实际上测的是"没有 .dev-lock → exit 0（无关会话）"，完全没有覆盖任何 hook 实际逻辑。

---

### 下次预防

- [ ] 修改 stop-dev.sh 时，**立刻检查** `tests/hooks/stop-hook-*.test.ts` 文件中所有 `.dev-mode` 引用是否也需要同步更新
- [ ] 正确的测试模式：先写 `.dev-lock.{branch}`（含 branch + session_id + tty 字段），再写 `.dev-mode.{branch}`
- [ ] hook 测试断言退出码时用 `echo "EXIT:$?"` 而不是 `echo $?`，避免 hook 的 stdout JSON 输出混入断言字符串
- [ ] `cleanup_done: true` 场景：hook 会输出 JSON 到 stdout，断言需用 `toContain("EXIT:0")` 而不是 `toBe("0")`
- [ ] hook-contracts.test.ts 的 `writeDevMode` helper 是正确格式的参考实现（已用 `.dev-mode.${branch}`）
