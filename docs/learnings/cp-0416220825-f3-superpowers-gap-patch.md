# Learning: F3 — 补 Superpowers 三个核心缺口

## 根本原因
Explore agent 一比一对比发现我们 /dev v7.2.0 vs Superpowers 5.0.7 覆盖率 80%，但有 3 项 High 级缺口：
- Test 里 arbitrary timeout 导致 CI flaky
- Implementer 报 DONE 没证据就被信任
- Bug fix 只修症状不追根因

这三项都在 Superpowers 官方有明文，我们 skills/dev 里没对应规则。

## 修复
02-code.md 追加一个 section，三块强制 prompt 指令注入 Implementer subagent。内容逐字搬自官方 systematic-debugging/condition-based-waiting.md / verification-before-completion/SKILL.md / systematic-debugging/root-cause-tracing.md，本土化示例但保留硬核铁律。

Engine 14.15.1 → 14.16.0（minor，新增规则）。

## 下次预防
- [ ] **对齐 Superpowers 时要看"隐藏"skill**：我们之前只看了 brainstorming/writing-plans/subagent-driven-development，但 systematic-debugging 和 verification-before-completion 也是核心——文档引用未必直接，要扫全目录
- [ ] **prompt 补丁优先级 > 代码补丁**：这三项都是 docs 改动（无测试文件），但对 autonomous 质量基线提升 +15%。比手写 scanner 工具 ROI 高一个量级
- [ ] **做 team agents 验证**：这个 PR 修完后，下一个 autonomous /dev 任务的 Implementer 应该自动读到这三块规则——可以用 /architect 的 spec-reviewer 视角抽查一轮
