# Learning: Vision 数据补全 — ZenithJoy OKR Vision 链修复

## 问题描述

intent_expand pipeline 触发后，context_found 中 `has_vision: false`，
Vision 上下文无法被 Codex agent 读取，导致 OKR 拆解缺少愿景对齐信息。

### 根本原因

`goals` 表中 ZenithJoy Q1 OKR（`33a45167`）的 `parent_id = NULL`，
而 Vision 目标节点（`4911164a`）已存在，仅缺少链接关系。
数据录入时遗漏了 parent_id 字段的赋值。

### 修复方式

migration 158：一条 UPDATE 语句补上 parent_id 链接。
同步更新 EXPECTED_SCHEMA_VERSION '157' → '158' 和测试基线。

### 下次预防

- [ ] OKR 数据录入时，前端应强制要求选择 Vision 父节点（不允许 NULL）
- [ ] intent_expand context check 可以在 `has_vision: false` 时打印警告日志，
      提示管理员补全 Vision 链路
- [ ] migration 文件命名规范：`NNN_description.sql`，描述要精确到"做了什么"
