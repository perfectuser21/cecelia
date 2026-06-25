# Learning — Slice 2：人工放行闸 + production promote

> 分支：cp-0625230344-slice2-promote-gate
> 日期：2026-06-25

## 背景

阶段2 Slice2：在 Slice1 的 staging_e2e verdict 上加放行闸。staging E2E PASS 后——
内部线(cecelia) 自动 promote；客户线(zenithjoy) pending_promote + 通知主理人，挂起等 confirm。

## 做了什么

- migration 306：staging_e2e_results 加 `promote_status`（CHECK 约束）+ promote_output + promoted_at（ALTER，不动 304/305）。
- `staging-promote.js`（新）：`resolveLine`(base_repo→customer/internal/unknown) / `decidePromote`(PASS+线→action) / `runInternalPromote`(注入 promoteExec，fail-safe)。
- `runStagingE2E` finalize 接 `handlePromote`：内部线 auto-promote / 客户线+缺失 pending+飞书通知。
- `mergePrNode` `_spawnStagingE2eTask` payload 补 `base_repo`（Slice1 漏的）。
- 回流接口 `POST /api/brain/harness/promote/:resultId`：幂等状态机（行锁 + 仅 pending_promote 可放行，否则 409）。

### 根本原因

本片不是修 bug，是设计抉择落地。两个关键设计点：

1. **pending 怎么安全长期挂起**：客户线放行可能挂数天。错误做法是用 langgraph interrupt 等 confirm
   （memory `harness-langgraph-interrupt-throw`：死循环 + 容器泄漏）。正确做法是 **pending = 一行 DB 状态**
   （promote_status='pending_promote'），**没有任何运行中的进程/图在等**；主理人 confirm 走独立 HTTP 接口
   回流，把状态推进。这是"用数据建模等待，而非用控制流阻塞"。

2. **auto-promote 测试绝不能打真生产**：内部线 auto-promote 真跑会动 live :5211（设计内行为）。
   防误触的做法：`runInternalPromote` **强制注入 promoteExec**，无注入则 fail-safe 拒绝
   （返回 promote_failed，不跑任何脚本）。测试注入 mock，生产注入 `defaultPromoteExec`。
   这样"测试里物理上不可能打到真生产"，而不是靠"记得别在测试里调真脚本"。

### 下次预防

- **长期等待用 DB 状态行建模，不用控制流阻塞**（尤其禁 interrupt 等人）；confirm 走独立幂等接口回流。
- **危险副作用（打生产/删数据）的执行器强制依赖注入 + 无注入 fail-safe**，让测试物理隔离真实副作用，
  而非靠纪律记得 mock。
- **跨 repo 边界明确**：Cecelia 不跨 repo 伸手打别人（zenithjoy）生产；本 repo 只到 pending+通知+接口。
- **放行/promote 必幂等**：状态机 + 行锁 + 接口校验当前态（仅 pending 可放行，否则 409），防重复 promote。

## checklist

- [x] migration 306 ALTER 加 promote_status（不重建已合 304/305）
- [x] resolveLine/decidePromote 判线 + base_repo 缺失保守 pending（决策2）
- [x] runInternalPromote fail-safe（无 promoteExec 注入拒绝跑真脚本）
- [x] runStagingE2E PASS 后 handlePromote 分流；payload 补 base_repo
- [x] 回流接口 POST /promote/:resultId 幂等（仅 pending 可放行，409/404/400）
- [x] 内部线 auto-promote 集成测试用 mock，证明不打真生产
- [x] 真 Postgres 验 CHECK 约束 + 状态机 + 重复 confirm 幂等（affected=0）
- [x] 跨 repo 边界：Cecelia 不打 zenithjoy 真生产（决策1）
- [x] DevGate 三件套全过
