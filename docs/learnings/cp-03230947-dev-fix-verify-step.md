## fix(/dev): verify-step.sh 4个硬门禁 + 5个bug修复（2026-03-23）

### 根本原因

/dev 工作流行为审计发现两类问题：
1. **4个"强制门禁"名不副实**：PRESERVE基线快照、TDD红灯确认、垃圾清理、周边一致性扫描，仅存在于AI指令文本，hook层完全不拦截。AI可以无声跳过这些步骤。
2. **5处脚本bug**：
   - S1-7: `01-spec.md` Stage 1 末尾调用 `check-dod-mapping.cjs`，但该脚本要求所有条目已勾选[x]，Stage 1 阶段条目全是[ ]，必定失败
   - S4-7: `fire-learnings-event.sh` 用 `**预防措施**` 匹配"下次预防"内容，但 Learning 模板用 `### 下次预防`，永远提取不到
   - S4-8/S4-9: `04-ship.md` 4.2/4.4节有手动 `gh pr merge` 和 Brain callback，但 devloop-check.sh 统一负责这两个动作，造成职责重叠和混乱
   - S4-12: `04-ship.md` cleanup 清理的是 `.dev-seal.{branch}`（幽灵文件，从未被创建），真实 seal 文件是 `.dev-gate-spec.*` 和 `.dev-gate-crg.*`

### 下次预防

- [ ] 任何新增的"强制行为"在文档里描述的同时，必须同步在 verify-step.sh 中加 Gate 代码，不允许只写AI指令
- [ ] 修改 Learning 模板时，同步检查 fire-learnings-event.sh 的提取逻辑，确保两者匹配
- [ ] devloop-check.sh 统一负责的动作（合并PR、Brain callback）不能在 04-ship.md 里重复，避免"做两遍"的歧义
- [ ] cleanup 清理的文件路径必须与实际创建路径一致，定期 grep 检查
