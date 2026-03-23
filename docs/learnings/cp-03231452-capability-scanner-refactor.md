# Learning: 重构 capability-scanner.scanCapabilities（圈复杂度 42 → ~6）

**分支**: cp-03231452-4d2020e3-8779-41f8-8e71-3bbf4e
**日期**: 2026-03-23

## 根本原因

`scanCapabilities` 函数将 5 个独立的检查逻辑（BRAIN_ALWAYS_ACTIVE 白名单、Brain 嵌入事件源、关联技能活跃度、关键表数据、状态判断）全部内嵌在一个大循环内，没有按职责分层，导致：
- 圈复杂度高达 42（阈值 10）
- 函数体 194 行，难以单独测试各子逻辑
- 条件嵌套 4-5 层，修改任一分支需理解全局上下文

## 重构方案

提取 6 个命名辅助函数，每个函数职责单一：

| 函数 | 职责 | 复杂度 |
|------|------|--------|
| `checkBrainEmbeddedSources` | Brain 事件源检查 | ~3 |
| `collectSkillActivity` | 技能活跃度收集 | ~4 |
| `collectTableData` | 关键表数据检查 | ~3 |
| `determineStatus` | 状态判断 | ~5 |
| `loadEmbeddedSourcesActive` | 加载事件源活跃状态 | ~2 |
| `evaluateCapability` | 单能力评估协调器 | ~4 |

重构后 `scanCapabilities` 仅剩 47 行（原 194 行）。

## 下次预防

- [ ] 函数超过 60 行时主动考虑拆分
- [ ] 循环体内有多个独立检查块时（3+），提取为命名函数
- [ ] 纯重构（零行为变更）：先确认现有测试覆盖，重构后直接跑测试验证
- [ ] `capability-scanner.test.js` 8 个测试全部通过，证明行为未变
