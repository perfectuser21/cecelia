# Learning: OKR 七层表结构建立

**Branch**: cp-03231443-okr-seven-tables
**Date**: 2026-03-23
**PR**: TBD

---

### 根本原因

现有系统用 `goals` 表混存 vision+KR（type 字段区分），用 `projects` 表混存 project/scope/initiative（type 字段区分），没有独立的 objective 层，导致：
1. 查询层级关系需要自查（无清晰的 FK 链）
2. 没有 objective 层，KR→Vision 直挂，缺失战略层
3. 前端无法对不同层级独立建模和展示

### 下次预防

- [ ] 未来新增层级时，优先用独立表 + FK，而非在现有表加 type 字段
- [ ] 数据迁移时用 ON CONFLICT (id) DO NOTHING 保证幂等
- [ ] 测试文件 hardcode 版本号（如 EXPECTED_SCHEMA_VERSION）需要随 migration 同步更新，搜索 `grep -r "175" src/__tests__` 确认是否有遗漏
- [ ] worktree 目录可能被 janitor 清理，在 context 压缩后要先验证 worktree 是否存在

### 关键决策

1. **新表命名**：用 `okr_projects`、`okr_scopes`、`okr_initiatives` 而非覆盖现有表名，保持旧表可用
2. **通用 CRUD 工厂函数**：`mountCrud()` 一次定义，6层复用，避免重复代码
3. **软删除**：DELETE 操作设 status='archived'，数据不丢失
4. **种子数据**：migration 中直接迁移活跃 vision/KR，让新表立即有真实数据可查
