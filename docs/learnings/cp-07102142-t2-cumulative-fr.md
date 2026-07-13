# Learning: 九要素 T2 累积 FR 通电（promoteToRegression 接终态收口 + 读端 key 对齐）

日期：2026-07-10
分支：cp-07102142-t2-cumulative-fr-promote
任务：3127bbbf-af48-4cc3-95dc-bf4f52220e8b

## 做了什么

- promoteToRegression 加 dbOnly（只写 golden_path，不开 yaml PR）+ feature_id 兜底（payload 缺失回退 tasks.ability_id）
- 共享管道 lib/callback-postprocess.js 新增 promoteRegressionOnHarnessMerged，接入 4 个 harness 终态路径（callback 双路径 / tasks PATCH / relay-watchdog 两处直写）
- 读端两处同源 SQL（harness-line-context.js + abilities.js 端点）从 tasks.ability_id 绕行改为 golden_path.feature_id 直连
- 反分叉 smoke 棘轮扩 5 条（proven-to-fire：接线前亲见 4 bad）+ 真 postgres 集成回归 3 用例

### 根本原因

golden_path 表 07-06 建齐后一直 0 行，根因是三重断线叠加：
1. **写入方挂在废弃图上**：promoteToRegression 唯一调用方是已退役的 LangGraph reportNode，relay 模式下零活体调用（架构文档假设"callback-processor 是 harness 终态唯一收口"，实测 relay 任务 completed 走 harness-report PATCH（result 被丢弃）和 relay-watchdog 直写 SQL，callback 管道覆盖率≈0）
2. **写端 FK 断链**：payload 通常不带 feature_id，写出的行 feature_id=NULL
3. **读端 key 错位**：读 SQL 绕 tasks.ability_id（历史上全空），和写端的 feature_id 真 FK 对不上

三根线只接任何一根都仍是 0 行——必须同 PR 全接。

### 下次预防

- [ ] "接通电"类任务开工前先核实事件真实流经的路径（本次靠 Research Subagent 抓到 relay 不走 callback，否则就是死代码）；架构文档的收口假设要在代码里验一遍再接线
- [ ] 改"同源"SQL 时全 repo grep 旧 join 片段（本次漏了 routes/__tests__/abilities.test.js 钉死旧 SQL 的断言，靠审查抓回）
- [ ] 新增终态副作用一律走共享管道 lib/callback-postprocess.js + smoke 棘轮扩条，禁内联进任何单条路径（防第 N 次孪生分叉）
- [ ] 多路触发的写入必须幂等（DELETE by key + INSERT 覆盖写），否则 4 个终态路径会叠加脏数据
