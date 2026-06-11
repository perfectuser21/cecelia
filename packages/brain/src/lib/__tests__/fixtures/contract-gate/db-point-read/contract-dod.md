# DB-Point-Read Fixture — 定点读 + 写语句，db-no-time-window 应放行

> 永久回归样本（生产 run fa2b3e21）：`INSERT ... RETURNING id` 写语句 + `SELECT ... WHERE id=...`
> 主键等值定点读，都不查历史、无"拿历史冒充本轮产出"风险 → 不应要求时间窗，gate 应全过（exit 0）。

## BEHAVIOR 条目

- [ ] [BEHAVIOR] 写入 ability 记录并按主键读回校验状态
  Test: 见下方验收脚本

```bash
NEW_ID=$(psql "$DB" -tAc "INSERT INTO journey_features (name, kind) VALUES ('x', 'ability') RETURNING id")
STATUS=$(psql "$DB" -tAc "SELECT status FROM journey_features WHERE id='$NEW_ID'")
[ "$STATUS" = "active" ] || { echo "FAIL: 状态不符"; exit 1; }
```
