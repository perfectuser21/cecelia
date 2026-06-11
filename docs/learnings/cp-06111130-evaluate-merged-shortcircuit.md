# Learning — 动作前先查终态：evaluate 不该在已 merge 的 PR 上跑

分支：cp-06111130-evaluate-merged-shortcircuit
日期：2026-06-11

## 背景

每次 merge → auto-version 重启 brain → checkpoint 断在 merge 节点后 → 成功 run 恢复时重跑 evaluate
→ PR 已 merge/分支已删 → evaluate FAIL → fix loop 在已 merge PR 上 spawn generator。

### 根本原因

**有副作用的图节点在执行前没有检查"目标对象是否已到终态"。** evaluate 的前提是"有一个待验证的
开放 PR + 存在的分支"，但它没校验这个前提就无条件 checkout 分支跑 E2E。PR 一旦 merge（终态），
分支删除，前提不再成立 → 必然 FAIL → 触发本不该有的 fix。这在"merge 即重启"的系统里是**常态**：
每个成功 run 的 checkpoint 都大概率断在 merge 后。

### 下次预防

- **有副作用的节点（evaluate/spawn/fix）执行前，先查目标对象的权威终态**（PR merged/closed、
  task completed/failed），到终态就短路，不在"已结束的东西"上重复动作。
- checkpoint-resume 系统里，"重启后重跑某节点"是常态，节点必须对"世界已经往前走了"鲁棒（幂等 +
  终态短路），不能假设 checkpoint 落点 == 世界当前状态。
- 查终态失败要 fail-open 到"安全的那一侧"：这里查不到就当未 merge 继续 evaluate，绝不因查询失败
  误判 PASS（误判 PASS 会放过真未达标的合同）。

## checklist

- [ ] 有副作用节点执行前查目标权威终态，终态则短路
- [ ] checkpoint-resume 节点对"世界已前进"鲁棒（幂等 + 终态短路）
- [ ] 终态查询失败 fail-open 到安全侧（不误判通过）
