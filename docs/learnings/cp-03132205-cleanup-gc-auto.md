---
id: learning-cp-03132205-cleanup-gc-auto
version: 1.0.0
created: 2026-03-13
updated: 2026-03-13
changelog:
  - 1.0.0: 初始版本
---

### [2026-03-13] cleanup.sh 完成后自动触发 worktree-gc

**失败统计**：CI 失败 0 次，本地测试失败 0 次（测试数与 baseline 完全一致）

**错误判断记录**：

- 修改了 `cleanup.sh` Section 4.5 的注释内容（从"由 stop hook 触发"改为"由 cleanup.sh 自动触发"），导致 `stop-cleanup-bugfixes.test.ts` 中 P2-5 测试 `提示 GC 将在 cleanup 完成后由 stop hook 触发` 的正则匹配 `/stop.*hook|cleanup.*完成后/` 失败。正确做法：改注释前先 grep 相关测试文件确认无断言依赖。

#### 根本原因

`packages/engine/tests/scripts/stop-cleanup-bugfixes.test.ts` 中 P2-5 组有一个测试断言 Section 4.5 的注释输出内容包含 `stop.*hook`，测试意图是验证"Section 4.5 不应在 cleanup 中 fire-and-forget 启动 GC，应委托给 stop hook"。修改注释时未预先检查有无测试在断言注释文本内容，导致测试失败。

#### 下次预防

- [ ] 修改任何 cleanup.sh / stop-dev.sh 的注释文本前，先 `grep -r '该注释关键词' tests/` 确认没有测试断言这段文字
- [ ] cleanup.sh 中的注释字符串（尤其是 echo 输出）有多处测试依赖，改注释要谨慎
- [ ] Section 4.5 的设计意图（不在此处 fire-and-forget GC）由测试保护，在 Section 10.5 新增真正的 GC 触发是正确架构

**影响程度**: Low

**预防措施**：
- 改 cleanup.sh 注释前先检查 `packages/engine/tests/scripts/` 中有无断言对应文本
- 新增 GC 触发逻辑放在新的 Section（10.5），不修改有测试保护的 Section（4.5）
