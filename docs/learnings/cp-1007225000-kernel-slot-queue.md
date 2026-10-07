## 编排槽满排队被记成失败 run，虚增 harness 失败率（2026-10-07）

### 根本原因

- `_spawnKernelRuntimeRemote` 先 `createKernelRun` 再申请编排槽；bridge 429 时 `requeueKernelRunLaunchDeferred` 把这条 run 置 `phase='failed'`，任务回 queued，下个 tick 新建一条。watchdog 的 `kernel_reconcile_remote_requeue:` 走同一函数，同样虚增。
- 四处成功率统计（战报、stats?by=journey、战况室健康度、relay-runs SLO）都把所有 failed run 计入分母。近 60 天 275 条排队 run 被当失败（一个任务占 227 条），盘点时得出被夸大的"81% 失败率"。
- 排队 run 不能换 phase：migrations 里清理触发器依赖 `phase IN ('done','failed')`。

### 下次预防

- [ ] 统计成功率前先问：分母里有没有"非真实尝试"的记录（排队、重试占位、smoke）
- [ ] 同一种状态的识别规则收口到一个模块，写入方与识别方用测试绑定（写入的 reason 必须被识别函数判真）
- [ ] 改一处统计口径时，grep 所有同类统计一起改
