# Learning: pipeline-patrol dedup 漏洞 — quarantined 未计入冷却期

**分支**: cp-04072134-6d464cce-f5b4-4951-a782-0c1bb0  
**日期**: 2026-04-07  
**影响**: 成功率从 94.8%(04-05) 跌至 17.8%(04-07)，根本原因

---

### 根本原因

`pipeline-patrol.js` 的去重 SQL 查询中，`quarantined` 状态未被纳入 24h 冷却期检查。

原逻辑：
```sql
status NOT IN ('completed', 'cancelled', 'canceled', 'failed', 'quarantined')
OR (status IN ('completed', 'cancelled', 'canceled') AND created_at > NOW() - INTERVAL '24 hours')
```

`quarantined` 在第一条件中被视为"非活跃"（正确），但在第二条件中未被纳入冷却期（漏洞）。
结果：rescue 任务死亡 → quarantined → 下次巡检找不到有效去重记录 → 再次创建 → 循环。

数据佐证：同一 branch 被创建 rescue 任务最多 **50 次**（cp-04062246-fix-eslint-hard-gate）。

---

### 下次预防

- [ ] 写去重 SQL 时，所有"终态"（completed/cancelled/canceled/quarantined/failed）都应出现在冷却期检查中
- [ ] 对"rescue 本身失败"应用更长冷却（72h），因为底层问题若未修复，重试无意义
- [ ] 去重逻辑变更后必须运行 `pipeline-patrol-dedup.test.ts` 验证所有状态分支
- [ ] 类似的"创建任务防重复"模式在其他地方也存在，应审查同类逻辑
