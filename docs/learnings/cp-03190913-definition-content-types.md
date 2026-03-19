# Learning: DEFINITION.md 补充 content-types 子系统架构说明

**分支**: cp-03190913-definition-content-types
**日期**: 2026-03-19

## 任务概述

在 DEFINITION.md 中补充 `packages/brain/src/content-types/` 子系统的架构说明，包括目录职责、与 Pipeline 的关系、YAML Schema 结构。

### 根本原因

content-types 子目录是新增的内容类型注册表（YAML 驱动），但 DEFINITION.md 作为系统定义文档（SSOT）未记录此子系统，导致文档与代码实现脱节。

### 下次预防

- [ ] 新增子目录/模块时，同步更新 DEFINITION.md 的文件地图和架构说明
- [ ] PR 审查清单中加入"DEFINITION.md 是否需要更新"检查项

## 关键决策

1. 将 content-types 说明放在 Section 3.4（三层大脑之后），因为它是 Brain 的内容工厂配置层
2. 在 Section 10.1 文件地图中同时添加 `content-pipeline-orchestrator.js` 和 `content-types/` 目录
3. YAML Schema 结构用简化表示，只列出必填字段和层级结构
