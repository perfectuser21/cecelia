---
branch: cp-04080112-15ded60e-4704-4ec8-b8c4-a32ed0
created: 2026-04-08
task: KR进度采集链路修复 — current_value 回填
---

# Learning: resetAllKrProgress 同款漏写 + backfill API 缺失

### 根本原因
PR #2017 只修复了 `runAllVerifiers()` 的 `current_value` 写入，但 `resetAllKrProgress()` 是独立函数，拥有相同的 `UPDATE key_results` 语句却未同步修复。  
`resetAllKrProgress` 永远不会被 tick 触发，只在"手动修复"场景使用 — 但由于没有暴露 API 端点，事实上无法被调用。  
结果：Brain 重启后 or 紧急 backfill 场景下，`current_value` 无法被恢复。

### 下次预防
- [ ] 修复一类 bug 时，全文搜索同类模式（`UPDATE key_results SET progress`），确保所有修改路径都同步更新
- [ ] "repair/reset" 函数必须与主逻辑保持字段一致性；或统一调用同一个内部更新函数避免重复
- [ ] 暴露 repair 端点：`/backfill-current-values` 让 Brain 重启后可立即执行无 side-effect 的回填
- [ ] 新字段加入 UPDATE 时，检查所有写该表的 UPDATE 语句（kr-verifier.js 有 2 处、okr-hierarchy.js 有 1 处）
