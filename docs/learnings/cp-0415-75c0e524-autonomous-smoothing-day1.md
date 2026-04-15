# Learning: autonomous 顺化 Day 1 — Stop Hook self-heal 孪生 bug + bypass env + Plan Self-Review type scan

**Branch**: cp-0415071846-75c0e524-1818-40c0-82cf-e1c7da
**Date**: 2026-04-15
**Engine Version**: 14.14.1 → 14.15.0

---

### 根本原因

**B1**: PR #2373 修复了跨 session orphan 隔离不对称问题，但留下了孪生 bug——self-heal 整块代码被 `if [[ -n "${CLAUDE_SESSION_ID:-}" ]]` 门控，headless/nested Claude Code 场景下 CLAUDE_SESSION_ID 为空时，即使 dev-mode 存在且分支 HEAD 匹配，自愈也永远不触发。内层三条所有权验证规则本来足以处理空 sid 场景（规则 3：无 owner/session 标识 + 主仓库 HEAD 匹配），但被外层门控提前短路。

**B2**: Stop Hook 误 block 时唯一的解除方式是等自愈或手动改文件，没有显式逃生通道，操作不可观测。

**F2**: 今天 Explore agent 深度对比 Superpowers writing-plans 官方版和 autonomous Self-Review，发现 Step 4（跨 task 类型一致性）缺失。历史上 clearLayers()/clearFullLayers() 这类隐性不匹配都没有被 plan 阶段捕获。

---

### 下次预防

- [ ] 凡修改 Stop Hook 所有权验证逻辑，同步检查「门控条件」是否会在 headless 环境下把正确的自愈路径短路
- [ ] 新增任何环境判断（`if CLAUDE_SESSION_ID`）时，先问：空值场景下应该 fail-open 还是 fail-close？
- [ ] 逃生通道必须与功能块一起设计，不能事后追加
- [ ] 修改 01-spec.md 时对照 Superpowers writing-plans 官方文档做完整 diff，避免版本漂移

---

### 测试注意（B1 对旧测试的影响）

B1 去掉外层门控后，无 owner/session 且主仓库 HEAD 匹配的 dev-mode 会被自愈。旧测试中有两个场景隐式依赖"CLAUDE_SESSION_ID 为空时 self-heal 不触发"的行为：
1. `fail-closed` 测试：移除了 `toContain("dev-lock")` 断言（路径从 orphan 检测变为 devloop-check）
2. `cleanup_done` 测试：改为检查输出最后一行是 "0"（devloop-check 可能输出 JSON）

这两个调整不影响功能正确性，exit 2/exit 0 行为不变。
