### 根本原因
Dashboard KR5 阻断 bug 清零验收任务。经过系统扫描（120 tests pass, TypeScript 零错误, API 全部正常），主要阻断 bug 已在前序 PR 中修复。剩余修复：task-goals.js 中 area_okr 的 progress_pct 始终返回 NULL，导致 Live Monitor OKR 总览中 area-level 进度无法直接读取（依赖 fallback 计算，存在误差）。

### 下次预防
- [ ] OBJ_SELECT 中 area_okr 的 progress_pct 应通过子查询从 key_results 聚合，不能硬编码 NULL
- [ ] Dashboard 3 大模块（Live Monitor / Harness Pipeline / Brain Models）验证清单：120 tests pass, TS 0 error, API 全通
- [ ] 演示前确认：area OKR 进度计算与 /api/brain/okr/current 结果一致
