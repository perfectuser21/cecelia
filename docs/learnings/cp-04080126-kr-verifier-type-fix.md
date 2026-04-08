# Learning: KR Verifier 采集链路两个隐蔽 bug

## 背景
任务：修复 ZenithJoy KR3/KR4 进度采集链路

### 根本原因

**Bug 1: PostgreSQL $2 类型歧义**
```sql
UPDATE key_results
SET current_value = $2,  -- PostgreSQL 推断为 numeric
    metadata = ... jsonb_build_object('metric_current', $2::text)  -- 推断为 text
```
同一个 `$2` 参数被用于 numeric 列 AND `::text` 强转，PostgreSQL 无法确定类型。
错误：`inconsistent types deduced for parameter $2`。
修复：`$2::numeric` + `($2::numeric)::text` 消除歧义。

**Bug 2: status 映射伪进度**
KR3/KR4 verifier SQL 用 `CASE WHEN status='active' THEN 50.0` 伪造进度。
`active` 意味着"工作已开始"，不意味着"50% 完成"。
结果：1 active + 1 inactive 项目 = avg(50,0) = 25%，但实际 0 行代码。

### 下次预防

- [ ] 在同一 UPDATE 语句中重复使用同一参数时，始终加显式类型转换（`$N::numeric`）
- [ ] KR verifier SQL 应基于 **事实字段**（`progress` 字段），不应基于 **状态派生伪值**
- [ ] 设计 verifier SQL 时：`current_value` 应反映实际可测量的进展，status='active' 不是进度
- [ ] `last_error` 非空的 verifier 会持续阻断 key_results 更新，需定期巡检
