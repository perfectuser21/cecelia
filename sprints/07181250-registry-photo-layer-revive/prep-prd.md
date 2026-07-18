# 小改动 PrepPRD:刀0 照相层复活——扫描器接定时重扫 + registry GET 改道 + 账龄哨兵

## 改什么
1. **扫描器定时化**:scripts/scan/{scan-api-registry,scan-db-schema,scan-test-registry}.js 接 host cron(跟 write-current-state.sh 同模式,每日一次,LA 时区),提供一个统一入口脚本 scripts/scan/run-all-scans.sh(git pull 主仓最新 + 依次跑三扫描器 + 失败落日志)。
2. **GET 改道**:packages/brain/src/routes/registry.js 的 GET /api/brain/registry,当 type=api|db_schema|test 时改读照相层三表(api_registry/db_schema_registry/test_registry),响应字段映射为现有消费方兼容形状(name/type/location/description),并附 scanned_at 与 freshness 字段:max(scanned_at) 距今 >24h → 顶层 stale:true + stale_warning 文案。其余 type(skill/machine/other)照旧读 system_registry。
3. **写路径不动**:POST/PATCH /api/brain/registry 继续写 system_registry(账本层增量,reviewer planned/report actuals 照旧)。

## 为什么改
2026-07-18 审计确诊(Notion issue 2288b43c):proposer 开工查询命中率 8%/3%/1%(system_registry 54 API/6 表/18 测试 vs 真实 660+/209/1816);三扫描器 5/26 起无人触发。主理人拍板照相层/账本层分层(今日 architecture 决策×3)。

## 关联上下文
- 决策:照相层/账本层永久分离、存量认领制、锚点焊接(2026-07-18 三条 architecture)
- Issue:2288b43c(P1 registry 双账断链)
- Handoff:docs/handoffs/202607181100-info-logic-rebuild.md

## 影响范围
- 消费方:harness-contract-proposer Step1.1 三条 curl、engine dev skill 的 registry 查询——curl 命令不变,返回数据从近空变全量;需响应形状兼容(映射 method+path→name, file_path:line→location)
- system_registry 的 api/db_schema/test 行继续存在(账本层),GET 不再返回它们——report 阶段 planned-vs-actual 对比走 POST 侧不受影响
- 账龄哨兵即 proven-to-fire 守卫:cron 一旦死掉,>24h 后 stale:true 自动亮,消费方可见

## 验收标准
- [ ] 单测:GET ?type=api 返回照相层数据+freshness 字段;>24h 场景 stale:true(时间可注入);type=skill 行为不变
- [ ] 单测:响应形状含 name/location 兼容字段
- [ ] run-all-scans.sh 真跑一次:api_registry 行数从 598 刷新到当前真实值,scanned_at=今天
- [ ] proven-to-fire:人为把 scanned_at 改老 25h,GET 返回 stale:true(亲眼见红)
- [ ] cron 条目已装(LA 时区),cron 日志路径明确
- [ ] CI 全绿
