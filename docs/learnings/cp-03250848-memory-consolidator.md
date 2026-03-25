# Learning: 记忆系统 PR8 — 接入 runConversationConsolidator

Branch: cp-03250848-memory-consolidator
Date: 2026-03-25

## 实现内容

tick.js 新增 10.19 节，fire-and-forget 调用 `runConversationConsolidator()`：
- 每 tick（5min）触发一次
- 内部自判断是否需要压缩（时间窗口检测）
- 失败不阻塞主 tick 循环（.catch 保护）

## 根本原因

conversation-consolidator.js 注释明确说"每 5 分钟调用一次"，但 tick.js 没有 import。
这类"有实现无接入"的模块断链模式在 Brain 中出现了多次（PR7/PR8）。

说明开发模式存在问题：模块实现与接入分离提交，后者容易遗漏。

## 下次预防

- [ ] 新增 Brain 定时模块时，PRD 成功标准应包含"tick.js 接入验证"
- [ ] 接入类测试（检查 tick.js 包含特定调用）应作为模块 PR 的一部分，而非补丁 PR
