# Bug PrepPRD:投影无自动重建者——kernel 派发确定性撞 map_radius_stale

## 症状
09-05/06 实证两轮:active map 投影钉 08-30 fact_revisions(1ef19bd6),fact 快照(每5分钟自动刷)已到当前 main 头 → 所有 kernel 派发在 preflight 确定性抛 map_radius_stale,任务两次失败后被打 blocked。手动 POST /api/brain/map/rebuild 后立即自愈(生产实证)。

## 根因
fact 快照有自动刷新链,投影没有:重投影旧靠 kernel 活跃期的换代节奏,08-30 后 kernel 闲置即停转。fact 与投影脱钩无人对齐。

## 关联上下文
- Notion Issue: 「kernel 派发确定性撞 map_radius_stale:投影无自动重建者」(P1,09-05)
- 手动应急 SOP: POST /api/brain/map/rebuild body {"scope_key":"cecelia"}(internalAuth;字段名 scope_key)
- 临时哨兵: 本 session Monitor bngeruj9u(2.5min 巡,本修复上线后退役)
- 决策链: 28ca1f69(结晶五步循环)

## 修法
packages/brain/src/scheduler-jobs.js 新增周期 job `map-projection-refresh`:
1. 对每个 map_scope_repositories 的 scope:比较 fact_snapshot_headers(四 kind 齐且同 revision)与 active map_projection_runs.fact_revisions
2. 漂移 → 调 map-read-service.rebuild(pool,{scopeKey,now})
3. 单飞(job 框架自带 per-name 串行即可,验证)+超时(DEFAULT_TIMEOUT_MS)+失败留原因(console.error 带 scope 与两侧 revision)
4. headers 四 kind 不齐/revision 不一致(扫描中窗口)→ 跳过本轮不报错(下轮再看)

## Regression Test 计划
failing test 先行(commit-1):mock pool——active 投影 fact_revisions 旧于 headers revision 时,job handler 必须调用 rebuild 一次;对齐时必须不调用;headers 四 kind revision 不一致时必须跳过。修完变绿(commit-2),永久留 CI。

## 哨兵(proven-to-fire)
逻辑接缝 → CI regression test 即守卫;上线后生产验证 = 撤临时 Monitor 哨兵前观察一次自动重建日志(真环境 fire 一次)。

## 验收标准
- [ ] failing test 先 commit(commit-1)
- [ ] 修复让 test 变绿(commit-2)
- [ ] DevGate 三件套过(facts-check/version-sync/dod-mapping)
- [ ] CI 全绿
- [ ] 部署后生产观察到一次自动重建(替换临时哨兵)
