# 设计:map-projection-refresh 投影保鲜 job(Crystal 件9)

日期:2026-09-06 · 任务:5eefece2 · PrepPRD:sprints/09060843-projection-auto-rebuild/prep-prd.md · 决策:8f22f71c

## 问题(生产两轮实证)
fact 快照(fact_snapshot_headers,四 kind)每 ~5 分钟自动刷新;map 投影(map_projection_runs)自 08-30 起无人重建 → 二者脱钩,kernel 派发 preflight 确定性抛 `map_radius_stale`。手动 `POST /api/brain/map/rebuild` 即愈(实证 3 次,含临时哨兵)。

## 方案(三选一,选 A)
- **A · scheduler job 自 gate(选定)**:照 gp-shelf-life/receipt-collector 成例——新模块 + JOBS 注册一行,自带间隔 gate。零新基建、有哨兵死人开关覆盖(scheduler_job_last_run sentinel)。
- B · tick 内联:侵入热路径,派发延迟敏感,否。
- C · 派发失败时惰性重建:失败才修=至少浪费一次派发,且与"早停"原则反向,否。

## 组件
**新文件 `packages/brain/src/map-projection-refresh.js`**
```
maybeRefreshMapProjections(pool, { rebuildFn=rebuild, now=Date.now, intervalMs=env|3min })
  1. 自 gate:now-lastRunAt < intervalMs → {skipped:true}
  2. 读 active 投影:SELECT scope_key, fact_revisions FROM map_projection_runs WHERE status='active'
  3. 读该 scope 各 repo 的 headers(四 REQUIRED kind:api/db_schema/graph/test)
  4. 判定(每 scope 独立):
     - 任一 kind 缺 或 四 kind revision 不一致(扫描中窗口)→ skip 该 scope,记 reason,不报错
     - headers 单一 revision ≠ fact_revisions[repo] → 漂移 → rebuildFn(pool,{scopeKey,now:new Date()})
  5. 失败留原因:单 scope rebuild 抛错 → console.error(scope+两侧 revision),继续其余 scope
  6. 返回 {skipped:false, checked, rebuilt:[…], skipped_scopes:[…]}
```
**JOBS 注册**(scheduler-jobs.js 一行):name=`map-projection-refresh`,needsPool,DEFAULT_TIMEOUT_MS,描述注明自带 gate 与案号。

## 依赖与接口
- `rebuild(pool,{scopeKey,now})` 来自 `lib/map-read-service.js`(生产已验,内部自己 BEGIN/COMMIT)
- 注入点:rebuildFn/now/intervalMs 全可注入 → 测试零真库
- env:`CECELIA_MAP_PROJECTION_REFRESH_INTERVAL_MS`(默认 180000)

## 错误处理
headers 不齐=正常扫描窗口,静默 skip(下轮再看);rebuild 失败=留两侧 revision 的 error 日志并继续(不熔断其它 scope);job 层再有 scheduler 的 timeout+sentinel 兜底。

## 测试(failing 先行,`__tests__/map-projection-refresh.test.js`)
1. 漂移 → rebuildFn 恰好一次、带对 scopeKey
2. 对齐 → rebuildFn 不调用
3. 四 kind 不一致/缺 kind → 不调用,skip 带 reason
4. 间隔 gate:窗口内二次调用 → skipped
5. 双 scope、第一个 rebuild 抛错 → 第二个照常 rebuild(失败不连坐)

## 上线验收
CI 全绿 + DevGate 三件套 + 部署后生产观察到一次自动重建日志 → 撤本 session 临时哨兵(Monitor bngeruj9u)。
