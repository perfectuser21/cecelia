# Learning: decomposition-checker KR type/status 匹配错误

## 背景
decomposition-checker.js 的 Check A/B/C/D 中，SQL 查询使用 `type = 'area_okr'` 匹配 KR，但数据库中可拆解的 KR 实际类型是 `area_kr`，导致拆解飞轮完全不转。

### 根本原因
goals 表的 type 层级体系中，`area_okr` 是 Objective 层（OKR 的 O），`area_kr` 才是 Key Result 层（OKR 的 KR）。代码作者混淆了 OKR 和 KR 的 type 值。同时 Check A 只查 `status = 'pending'`，但用户审核后的 KR 状态是 `ready`，两个条件叠加导致查询永远返回空。

### 下次预防
- [ ] goals 表的 type 枚举值应有清晰的文档说明（area_okr = Objective, area_kr = Key Result）
- [ ] decomposition-checker 应有基于真实数据的集成测试，确保 SQL 查询能匹配到预期数据
- [ ] 新增 SQL 查询时，先在 psql 中验证 `SELECT DISTINCT type, status FROM goals` 确认真实数据

## 修复内容
- Check A: `type = 'area_okr'` + `status = 'pending'` 改为 `type IN ('area_kr', 'kr')` + `status IN ('pending', 'ready')`
- Check B/C: `type = 'area_okr'` 改为 `type IN ('area_kr', 'kr')`
- Check D: 子 KR 查询的 `type = 'area_okr'` 改为 `type IN ('area_kr', 'kr')`
