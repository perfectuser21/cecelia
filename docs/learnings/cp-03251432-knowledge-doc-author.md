# Learning: 知识文档系统完善 — 补全author/made_by字段

**Branch**: cp-03251432-knowledge-doc-author
**Date**: 2026-03-25
**PR**: feat(brain): 知识文档系统完善

## 背景

CTO级别审计发现知识文档系统存在根本性缺陷：decisions表10,539条记录无author字段，无法区分人类决策和系统决策（机器355条/天）。design_docs type被硬锁死5种。没有conversation_captures表导致Claude Code会话零持久化。

### 根本原因

- 原有表设计时未考虑多来源写入（人类/Cecelia/系统自动）的区分需求
- design_docs的CHECK约束在设计时太保守，仅考虑了技术文档场景，忽略了会议/战略/路线图等实际使用场景
- conversation_captures表在最初PRD中有定义但尚未实现，导致会话内容一直无法持久化
- migration编号冲突：初始规划 192/193/194，但 main 分支在开发期间合并了 192_fix_thalamus_model.sql，最终使用 193/194/195
- DoD `[BEHAVIOR]` Test 引用格式必须是 `tests/` 开头（斜杠），`tests:` 冒号格式不被 check-dod-mapping.cjs 识别
- 更改 `EXPECTED_SCHEMA_VERSION` 时，3 个测试文件中有硬编码断言（desire-system/selfcheck/learnings-vectorize），必须同步更新

### 下次预防

- [ ] 开始实现前先检查最新的migration编号（`ls packages/brain/migrations/ | tail -5`）
- [ ] Task Card中的migration编号要与实际文件系统中的编号一致，避免DoD测试用错误路径失败
- [ ] design_docs等配置型表的CHECK约束应该使用更宽松的允许列表，便于未来扩展
- [ ] 知识类表从一开始就应该包含author/made_by字段，方便追溯来源
- [ ] [BEHAVIOR] Test 字段只能用 `tests/`（斜杠）前缀，不能用 `tests:`（冒号）
- [ ] 修改 selfcheck.js EXPECTED_SCHEMA_VERSION 时，同步更新 desire-system/selfcheck/learnings-vectorize 三个测试文件中的版本断言

## 实现要点

**migration 193**（author/made_by字段）：
- 用 `IF NOT EXISTS` 防止重复执行报错
- decisions表额外加了 priority/area/alternatives/decided_at，为人类决策提供完整元数据
- 索引：decisions(made_by)、decisions(author)、decisions(priority)

**migration 194**（conversation_captures）：
- session_id+summary为必填，area/key_decisions等为可选
- made_by默认cecelia（会话结束自动写入场景）

**migration 195**（design_docs type扩展）：
- 先 DROP CONSTRAINT IF EXISTS，再 ADD CONSTRAINT，安全扩展
- 新增6种类型：meeting/strategy/roadmap/retrospective/idea/context

## 已知问题

无，所有DoD验证通过（CI L1/L2/L3/L4 全部 ✅）。
