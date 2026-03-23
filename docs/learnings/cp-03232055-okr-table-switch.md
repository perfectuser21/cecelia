# Learning: PR2 — Migration 180 OKR 双向同步触发器

## 分支
`cp-03232055-okr-table-switch`

## 根本原因

**挑战 1：goals.id 是 UUID，测试时用非 UUID 字符串报 syntax error**

DoD5 行为测试初版用 `'__trig180_smoke__'` 作为测试 ID，goals.id 是 UUID 类型，导致 `invalid input syntax for type uuid`。

**挑战 2：goals.status 有 check constraint，不接受 'active'**

goals 表 status 允许值为 `pending/needs_info/ready/decomposing/reviewing/in_progress/completed/cancelled`，不含 `'active'`。触发器函数里把 `in_progress` → `active` 是写到新表（visions），这是正确的；但测试时 INSERT INTO goals 时必须用旧表的合法 status 值（如 `in_progress`）。

**挑战 3：spec_review 第一次拒绝全静态文件检查 DoD**

Task Card 初版 DoD 五条全部是 `grep` 文件内容，没有真实行为验证。spec_review 拒绝，要求补充端到端 INSERT → SELECT 验证。

### 下次预防

- [ ] 行为测试中插入旧表时，检查该表的 status check constraint，使用合法枚举值
- [ ] 测试数据 ID 用 UUID 格式（如 `'00000000-0000-0000-0000-000000000180'`）
- [ ] DoD 必须至少有一条端到端行为验证（psql INSERT → SELECT）；纯文件内容检查不够
- [ ] psql 行为测试需在 DB 不可达时 `exit 0`（优雅降级），避免 L1 CI 误报
- [ ] 触发器函数设计：`goals.status`（旧表枚举）→ `visions.status`（新表枚举）需明确转换规则，在 Task Card 列映射中写清楚
