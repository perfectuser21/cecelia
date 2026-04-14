# Learning: kr3-config-checker 使用了不存在的 decisions 表列

**分支**: cp-0414062114-c988c0c8-9ae2-4f25-8b95-59b035  
**日期**: 2026-04-14

## 现象

`GET /api/brain/kr3/check-config` 返回：
```json
{"ok": true, "allReady": false, "summary": "检测失败: column \"key\" does not exist"}
```

## 根本原因

`kr3-config-checker.js` 在写入（PR #2329）时，查询语句使用了 `key`/`value` 列：
```sql
SELECT key, value FROM decisions WHERE key = ANY($1)
```

但 `decisions` 表实际 schema 没有这两列，正确的列名是：
- `topic`（varchar(200)）— 决策主题，用作唯一标识符
- `decision`（text）— 决策内容，用作值存储

## 修复

1. 查询：`SELECT topic, decision ... WHERE topic = ANY($1)`
2. 结果处理：`byKey = rows.map(r => [r.topic, r])`，取 `r.decision` 作为 note
3. 写入：改为两步法（先 UPDATE 废弃旧记录，再 INSERT 新记录），而非 `ON CONFLICT(key)`（topic 无唯一约束）

## 下次预防

- [ ] 新增操作 decisions 表的模块时，先用 `psql cecelia -c "\d decisions"` 确认实际列名
- [ ] 不要参考旧代码/注释中的"key-value"用法，decisions 表不是 KV store，是决策记录表
- [ ] 写入时因 topic 无唯一约束，必须用 UPDATE+INSERT 两步法，不能用 `ON CONFLICT(topic)`
