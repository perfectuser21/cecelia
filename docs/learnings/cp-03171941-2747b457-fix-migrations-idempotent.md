# Learning: 批量修复不幂等 migration（013, 052, 112 等17个）

## 任务
修复所有剩余的不幂等 migration，防止 CI DB 积累状态时 `CREATE INDEX` / `ADD CONSTRAINT` 报 "already exists"。

### 根本原因
CI DB 可能在以下情况下积累状态：
1. schema_version 被部分重置，而实际 schema 对象（索引、约束）仍然存在
2. 同一 run_id 下某个 shard 重试时复用了已有 pgdata 目录

三类真正非幂等操作：
- `CREATE INDEX`（无 `IF NOT EXISTS`）→ 013 中4个索引
- `INSERT INTO schema_version`（无 `ON CONFLICT`）→ 052
- `ADD CONSTRAINT`（无 `DROP CONSTRAINT IF EXISTS` 前置）→ 112 中3个约束

其余14个 migration（070/072/076/078/091/095/096/114/119/126/127/140/148/154）已使用 `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` 模式，本身已幂等。

### 下次预防
- [ ] 新 migration 写 `CREATE INDEX` 时必须加 `IF NOT EXISTS`
- [ ] 新 migration 写 `ADD CONSTRAINT` 时必须先写 `DROP CONSTRAINT IF EXISTS <name>`
- [ ] `INSERT INTO schema_version` 必须带 `ON CONFLICT (version) DO NOTHING`
- [ ] 已有 `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` 的 migration 视为已幂等，不需要额外包装
