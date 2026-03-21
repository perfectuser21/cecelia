# Learning: projects.current_phase CHECK 约束

## 背景
为 projects 表的 current_phase 字段添加 CHECK 约束和初始数据。

### 根本原因
current_phase 字段在 migration 057 中作为 TEXT 类型添加，无约束限制。随着 SelfDrive update_roadmap 功能的使用，需要数据库层面的约束防止非法值写入。

### 下次预防
- [ ] 添加 DB 字段时，如果值域有限（枚举型），应在第一次 migration 就加 CHECK 约束
- [ ] 修改 EXPECTED_SCHEMA_VERSION 时同步更新 DEFINITION.md 的 schema_version
- [ ] CHECK 约束需考虑所有已有使用方的值（如 initiative orchestration 的 'plan' 值）
