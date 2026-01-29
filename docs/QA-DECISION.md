# QA Decision - M1 Database Connection + Focus Migration

Decision: NO_RCI
Priority: P1
RepoType: Engine

## Analysis

### Change Type
- **Type**: Feature (新功能)
- **Scope**: 添加 PostgreSQL 数据库连接层 + Focus 逻辑迁移

### Impact Assessment
- **Risk Level**: Medium
- **Affected Areas**: 新增 db/pool.py, state/focus.py, API 路由
- **Breaking Changes**: None (纯新增)

## Tests

| DoD Item | Method | Location |
|----------|--------|----------|
| Python 能连接 PostgreSQL | auto | tests/test_db.py |
| 所有表可读写 | auto | tests/test_db.py |
| /api/brain/focus 返回 OKR 焦点 | auto | tests/test_state_api.py |
| 手动覆盖焦点正常工作 | auto | tests/test_state_api.py |
| 自动选择焦点逻辑正确 | auto | tests/test_focus.py |

## RCI

```yaml
new: []
update: []
```

## Reason

M1 是新功能模块（数据库连接 + Focus 迁移），不涉及现有功能修改。需要单元测试覆盖新增代码，但无需回归契约更新。
