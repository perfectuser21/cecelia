## 九要素T3：注入扩容+蒸馏接线+context-manifest 端点（2026-07-10）

### 根本原因
T5 dreaming L1 每晚产出 line_ledger 蒸馏摘要后一直没有消费方（写了没人读=断线）；同时三角色 prompt 注入 4000 字符上限在铁律与累积 FR 增长后成为瓶颈，planner Step 0.4 需要多次 curl 拼上下文、无一次拉全端点。

### 修法
- harness-line-context：PROMPT_MAX_LEN 4000→12000、MAX_FR_ABILITIES 20→50；第四路 best-effort 查询最新 line_ledger 并注入新段（排最后，clamp 优先牺牲本段保 E1 契约两段）
- line-dreaming buildLineDreamData 参数化 { since }（COALESCE 回落 24h 向后兼容）
- warroom 新端点 GET /line/:id/context-manifest：ledger + 自蒸馏时刻起增量事实 + invariants + cumulative_fr + prompt_block

### 下次预防
- [ ] 新增夜间蒸馏/账本类产物时，同一计划内必须排"消费方接线"任务，禁止只写不读（本次 T5 产出到 T3 接线隔了一个 plan 周期）
- [ ] 计划文档引用脚本路径前先 ls 验证：check-dod-mapping 真身在 packages/quality（engine 路径已废）、brain server.js 在包根非 src/——CLAUDE.md 的 SSOT 清单该同步修
- [ ] upsertLineLedger 20h 内 UPDATE 只刷 updated_at 不动 created_at → manifest since 取 created_at 会低估新鲜度（安全方向重复），后续 T 系任务顺手改 GREATEST(created_at, updated_at)
