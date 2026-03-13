---
id: learning-cp-03132126-stop-hook-retry-fix
version: 1.0.0
created: 2026-03-13
updated: 2026-03-13
changelog:
  - 1.0.0: 初始版本
---

# Learning: stop hook 重试上限统一 + 双 exit 0 终止条件合并

### [2026-03-13] stop-dev.sh 注释与逻辑顺序修复

**失败统计**：CI 失败 0 次，本地测试失败 0 次（预存在失败不计）

#### 根本原因

**问题1 — 注释与代码不一致**：stop-dev.sh 第 143 行注释写"15 次重试计数器"，但第 322 行代码判断 `RETRY_COUNT > 30`。两者不一致是历史遗留：最早设计为 15，后来代码改为 30，但注释忘记同步。

**问题2 — 逻辑顺序 bug**：超时检查（`RETRY_COUNT > 30`）放在了 `devloop_check` 调用之前。这导致第 31 次重试时，即使 PR 已经合并（完成信号），代码仍然先进入超时失败分支，不会走"正常完成"路径。

**问题3 — 双 exit 0 终止路径**：devloop-check.sh 中有两个不同的退出条件都能让工作流认为"完成"：
1. `cleanup_done: true`（cleanup.sh 设置的主路径）
2. `PR合并 + step_11_cleanup: done`（devloop_check 内联判断）

两者并存会导致行为不一致，当 `step_11_cleanup: done` 被设置但 `cleanup_done: true` 尚未写入时，有竞态风险。

#### 修复方案

1. 引入 `MAX_RETRIES=30` 常量，统一注释与代码
2. 将超时检查整体移到 `devloop_check` 的 `else`（blocked）分支内，先确认工作流未完成，再判断是否超时
3. devloop-check.sh 新增 `_mark_cleanup_done()` 函数，`step_11_cleanup: done` 时调用该函数向 `.dev-mode` 写入 `cleanup_done: true`，而非直接返回 `{"status":"done"}`——由此统一为唯一终止路径

#### 下次预防

- [ ] 超时/上限检查类逻辑，应先调用实际业务判断（`devloop_check`），再做超时保护——"先判完成，再判超时"是安全顺序
- [ ] 任何常量（如重试上限）使用具名常量（`MAX_RETRIES=30`），避免魔法数字导致注释与代码漂移
- [ ] 多个条件都能触发同一终止行为时，应统一为单一路径（Single Exit Point），通过状态文件串联，避免双重出口

**影响程度**: Low（修复了潜在的逻辑顺序 bug，无功能破坏性变更）

**预防措施**：
- 写超时保护时，先 check 正常完成条件，再 check 超时
- 常量统一命名，修改时同步更新所有引用（注释 + 代码 + 测试）
