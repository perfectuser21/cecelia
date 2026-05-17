# Learning: cp-03232145-okr-biz-migration — Migration 182 新 OKR 表补充运营列

## 背景

OKR 飞轮系统重构第三 PR：Migration 182 为新 OKR 表（visions/objectives/key_results/okr_projects/okr_scopes/okr_initiatives）补充运营列，解锁后续 ~50 个业务文件从旧 goals/projects 表迁移到新表。

## 主要变更

- `packages/brain/migrations/182_okr_operational_columns.sql` — 新增 ALTER TABLE 语句为 6 张新表添加运营列，并更新触发器函数同步新列
- `packages/brain/src/selfcheck.js` — EXPECTED_SCHEMA_VERSION: '181' → '182'
- 测试文件版本更新（selfcheck.test.js / desire-system.test.js / learnings-vectorize.test.js）
- DEFINITION.md Schema 版本更新

## 列分配策略

| 表 | 新增列 |
|---|---|
| `visions` | description |
| `objectives` | description, priority |
| `key_results` | description, priority, progress, weight |
| `okr_projects` | description, progress, completed_at |
| `okr_scopes` | description, progress, completed_at |
| `okr_initiatives` | description, priority, progress, starvation_score, completed_at, last_dispatch_at |

### 根本原因

新 OKR 表建立时只包含结构性字段（id/title/status/area_id），缺少业务代码需要的运营字段。

### 下次预防

- [ ] 新表设计时预先评估业务代码需要哪些列，避免后续补列 PR
- [ ] `objectives` 表实际名称不是 `okr_objectives`，DoD 测试写明正确表名
- [ ] `branch-protect.sh` 会检查 `.dev-mode` 中 `tasks_created: true` 字段，开发前确保已写入
