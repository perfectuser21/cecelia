# Learning: KR Verifier SQL 类型冲突根因

## 根本原因

KR verifier 有两类 SQL 类型冲突：

### 类型1: UPDATE $N 类型歧义（kr-verifier.js，已由 PR #2028 修复）
`UPDATE key_results SET current_value = $2, ... jsonb_build_object('metric_current', $2::text)` 中，
`$2` 同时出现在 `numeric` 列和 `::text` 转型上下文，pg Extended Query Protocol 无法推断类型。

### 类型2: GREATEST(integer, bigint) 类型混合（verifier query SQL）
`GREATEST(1, COUNT(*))` 中 `1=integer` 与 `COUNT(*)=bigint`，在 pg Extended Protocol 下
多态返回类型推断失败，即使在 psql（简单查询协议）下完全正常。

## 下次预防

- [ ] **SQL 参数规则**：同一 `$N` 不能在不同类型上下文出现（拆为独立参数或用 `$N::type` 统一）
- [ ] **GREATEST 避免混合整数类型**：用 `NULLIF(expr, 0)` + COALESCE 替代，或显式 `1::bigint`
- [ ] **测试标准**：verifier SQL 必须通过 `pool.query()` 调用测试，`psql -c` 不等价
- [ ] **排查关键词**：`inconsistent types deduced for parameter $N` = 找该参数所有出现位置

## 修复模式

```sql
-- ❌ GREATEST 类型混合（在 Extended Protocol 下失败）
SUM(...) / GREATEST(1, COUNT(*))

-- ✅ NULLIF 替代（类型安全）
SUM(...) / NULLIF(COUNT(*), 0)

-- ✅ AVG 子查询（彻底避免）
SELECT COALESCE(ROUND(AVG(score)), 0) FROM (...) sub
```
