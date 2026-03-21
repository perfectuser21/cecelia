# Learning: decomp-checker type 匹配遗漏 area_okr

## 问题
decomposition-checker.js 的 Check A/B/C/D 只搜索 `type IN ('area_kr', 'kr')`，但 goals 表中实际 KR 数据的 type 字段是 `area_okr`，导致 decomp-checker 完全无法识别现有 KR。

### 根本原因
goals 表中历史数据的 type 字段使用了 `area_okr` 而非 `area_kr`。系统其他模块（kr-progress.js、planner.js、similarity.js、validate-okr-structure.js）已经正确包含 area_okr 作为 KR 类型，但 decomposition-checker.js 在 v2.0 重构时遗漏了这个 type，只写了 `area_kr` 和 `kr`。

### 下次预防
- [ ] 修改涉及 goals type 查询的代码时，检查系统中所有使用 `type IN (...)` 的地方，确保 type 列表一致
- [ ] 考虑将 KR type 列表抽取为共享常量（如 `KR_TYPES = ['area_okr', 'area_kr', 'kr']`），避免各模块各写各的
- [ ] 新增 type 查询时，先查 goals 表实际数据的 type 分布：`SELECT type, count(*) FROM goals GROUP BY type`
