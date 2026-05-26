# Learning: dev-visibility-ws2-4 — harness 可见性三修

## 根本原因

1. **WS2**：/dev SKILL 缺少 Brain 任务登记步骤，Route A（--task-id）存在但 Route B（无 task-id 时新建）从未写入 Brain DB，导致 initiative 无法追踪 /dev 启动事件。

2. **WS3**：`buildGeneratorPrompt` 只传 DoD + 文件列表，不含 Sprint PRD 全文。Generator 容器缺乏 "Why" 上下文，只知道要改哪些文件，不知道为什么改，导致实现偏差。

3. **WS4**：harness-generator SKILL.md 残留"并行派发"表述（实际为串行），且保留了 contract-draft.md 退化路径（实际 proposer 已统一输出 sprint-contract.md）。

## 下次预防

- [ ] generator prompt 构造时检查是否透传 prdContent（可用 `grep prdContent harness-utils.js`）
- [ ] /dev SKILL 改动时同步检查 Route A/B 任务登记段是否完整
- [ ] SKILL.md 架构描述变更（串行/并行）时同步更新所有引用该架构的 SKILL 文件
- [ ] sprint test 覆盖三处：dev SKILL 登记段 / buildGeneratorPrompt prd 注入 / generator SKILL 串行表述
