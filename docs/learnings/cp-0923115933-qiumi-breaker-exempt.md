# 秋米 qiumi_task 被 cecelia-run 熔断误伤 + 每 tick 重复路由（2026-09-23）

## 根本原因

- 执行体与闸不对齐：`qiumi_task` 的执行体是 `openclaw-agent`（Brain ssh 直派 MMV，不经 cecelia-bridge），但 `needsBridgeCheck` 只按「不在 HARNESS_INFLIGHT」判定，把它拉去过 `cecelia-run` 熔断与 bridge 健康两道闸。别人的任务（map_stale / codex ENOENT 连败）把 `cecelia-run` 打 OPEN，秋米跟着停摆——生产一天内两次（03:50、12:24）靠手动 reset 续命。
- 副作用在闸之前：Jev 路由 + `persistDecision` 在候选循环里就落库，闸拒了再回 queued，下一 tick 重打 Jev、换 run_id，账本上留两条 `qiumi_route_decided` 却没有 spawn。
- 熔断计数不分键：openclaw 路径 spawn 失败也 `recordFailure('cecelia-run')`，MMV 故障反向污染 bridge 熔断。
- 事后记账落在事故边界内：新增的 `recordSuccess` 原本裸放在 `try` 里、`postClaimException` 覆盖范围内——agent 已 spawn 之后若记账抛错，任务会被标 failed 并放 claim，正是该处大段注释禁止的事；今天不炸只因下游都吞异常。
- 静态守卫钉字面量：三个既有测试用 `indexOf("recordFailure('cecelia-run')")`、整行正则钉 import 与 `needsBridgeCheck`，本刀一改就红；实现者只跑固定文件命令，四位实现者全没发现，终审实跑 fs 守卫组才抓到。
- 顺带发现一处既有假绿：`dispatcher-config-error-no-breaker.test.js` 在 800 字节窗口里找 `configError`，命中的是注释——删掉整个 `if (execResult.configError)` 分支照样绿（守卫一个词 ≠ 守卫一个行为）。

## 下次预防

- [ ] 派发链上任何按「任务类型」的豁免/闸，判据一律从 `lib/task-type-registry.js` 的 surface 派生，不手抄名单（铁律 76cb816c）；新加表面时先问「它经不经 bridge」
- [ ] 有副作用的路由/落库必须放在所有前置闸之后，或做成幂等（payload 已有 `run_id` 就复用）——「先决策后拒绝」= 每 tick 白烧一次
- [ ] 熔断键 = 执行体，不 = 调度器：每个 surface 自己的 `recordFailure/recordSuccess`，互不牵连
- [ ] spawn 成功之后的一切记账（熔断、事件、日志）必须各自包 try/catch，不得让 `postClaimException` 有机会把已起跑的任务标 failed
- [ ] 静态源码守卫改用「定位真实语句 + 窗口内钉真实分支」的正则，不钉整行字面量；改 dispatcher 关键行前先 `grep -rn "<字面量>" src/__tests__` 找钉子
- [ ] 每个 Task 的固定测试命令之外，终审前必跑 `bash .github/workflows/scripts/list-fs-guard-tests.sh` 列出的全部守卫（本刀 257 文件 2465 用例）
- [ ] 版本不手 bump：写 `changes/<分支>.md` 碎片，`check-brain-version-bump.sh` 第 41 行认碎片，合并后 auto-version bot 按 `fix:` 前缀升 patch
- [ ] 留债：ssh 探针回 ALREADY 时 executor 返回 `success:true` 不带 `already_running`，会用一次「没起新 agent」的成功关掉 `openclaw-agent` 的 HALF_OPEN——executor 需多带字段
