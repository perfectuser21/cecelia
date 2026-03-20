# Learning: 合并审查 Skill 为 4 个 Codex Gate

## 任务概述

将 5 个重叠的审查 Skill（decomp_review、prd_audit、cto_review、code_quality、initiative_verify）合并为 4 个清晰的 Gate Skill 定义。

### 根本原因

旧的审查 Skill 职责重叠严重，同一份代码可能被多个相似的审查流程检查，造成重复劳动和结果不一致。需要整合为标准化的 4 阶段 Gate 流水线。

### 下次预防

- [ ] 新建审查 Skill 前先对照现有 Gate 列表，避免职责重叠
- [ ] 每个 Gate 明确定义触发时机和唯一职责
- [ ] Skill 定义应包含"与其他 Skill 的关系"章节

## 关键决策

- prd-review 合并了结构质检 + PRD 覆盖度，因为这两个审查发生在同一时机（拆解完成后）
- spec-review 在 Stage 1 后触发，是写代码前的最后拦截点
- code-review-gate 与现有 /code-review 不冲突：前者是门禁，后者是巡逻
- initiative-review 分 Phase 1（单 PR）和 Phase 2（整体），覆盖了完整验收周期
