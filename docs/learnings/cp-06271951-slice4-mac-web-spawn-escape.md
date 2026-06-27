# Learning: Slice4 — generator/fix 节点补 mac_web 宿主逃逸

> 2026-06-27 · harness pipeline 9-slice 之 Slice 4 · PR cp-06271951-mac-web-spawn-escape

## 背景
harness pipeline 真 run 阻断之一（20-agent 审计「执行层环境错配」根因 #3）：
target_environment=mac_web 的 generator 无条件走 docker 容器派发，容器内无真实浏览器，
Playwright 自验物理跑不通 → evaluator 永远 FAIL → fix loop 同样走 docker 空转烧轮次，
run 永远到不了 merge/staging/promote。

### 根本原因
只有 `evaluate_contract` 节点做了 mac_web→宿主 ssh 逃逸（executeOnHost，PR #3441）；
`spawnNode`（generator + fix 复用）**从未实现** host 分支。新增执行环境时只改了验证节点，
漏了执行节点 —— 同一个 target_environment 路由需求散落在 spawn / evaluate 两处，没有 SSOT。

## 非显然的设计洞察（接缝）
generator 是**两段式异步**：`spawnNode`（docker run -d detached）→ `awaitCallbackNode`
（interrupt() 挂起等 callback router resume）。而 host 执行是**同步**的（executeOnHost 等结果）。

干净接缝 = **复用已有幂等门**，不改 graph 边：
- spawnNode 的 mac_web 分支同步跑完 → 把 stdout 作 `generator_output` 返回。
- `awaitCallbackNode` 开头已有幂等门 `if (state.generator_output) return passthrough` → 自动跳过 interrupt。
- `routeAfterSpawn = state.error ? 'end' : 'await_callback'` 只看 error，无需改。
- host 失败 → 落 `ci_status=fail`，awaitCallbackNode 新增 ci_status passthrough（否则没有
  generator_output 会 interrupt 死等一个永不到来的 docker callback）→ routeAfterCallback 走 fix_dispatch。

## 下次预防
- [ ] 新增/改 target_environment 路由时，**spawn 与 evaluate 两个节点都要覆盖**（不是只改验证侧）。
- [ ] target_environment 提取统一走 `extractTargetEnv(state)` SSOT，禁止再就地写正则（已消两处漂移）。
- [ ] host localhost env 统一走 `buildHostLocalEnv(baseEnv, cid)`，禁止再就地拼 BRAIN_URL/CALLBACK/DB。
- [ ] regression 守卫：`harness-task.graph.test.js` 已含 mac_web host 分支 + ci_status passthrough 测试，永久留 CI。
