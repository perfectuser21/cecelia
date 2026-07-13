# Learning: 协议卫生包——三处系统性卫生债的共同根因是"内存态当持久态用"

### 根本原因
Brain 的重试/去抖/去重三块能力都长成了"局部应急补丁"形态：重试策略散在 5 层（quarantine/retry-policies/retry-circuit/llm-caller/零散 requeue）各自分类；告警去抖 4 处手搓（feishu-alert 连败3、notifier 60s、alerting P0 5min、publish-monitor 连续2）；副作用去重全是进程内 Map——蓝绿部署每次 merge 自动重启，所有内存态清零，重启窗口期双 Brain 并发时重复建任务/双 spawn/重复告警无任何 DB 级防线。timeout 和 5xx 一直混在 NETWORK 类里吃同一条退避曲线，是分类表从未被当成 SSOT 维护的直接后果。

### 修复
- retry-policy.js 查表 SSOT（四类各自 backoff 数组）+ isTransientClass 集中判定替换 4 处散落枚举；quarantine 拆 TIMEOUT/SERVER_ERROR，getRetryStrategy 签名返回零变更。
- alert-debounce.js 通用封装（连续 N + 冷却，opt-in 参数不改 raise 全局语义，P0 禁套）。
- side_effect_dedupe 表 + claimDedupeKey（ON CONFLICT 过期重占免清理循环，fail-open + P2 降级告警拍板写死注释）；三入口接线（createTask/executor 派发层/notifier）。
- 终审抓住并修复：executor 的 claim 若放在资源检查之前，server_overloaded 提前 return 会泄漏 key，叠加 dispatcher 把 spawn_deduplicated 计为失败可误触 cecelia-run 熔断停派——claim 挪到资源检查后 + dispatcher carve-out。

### 下次预防
- [ ] 任何"防重入/防重复"机制设计时先问一句：Brain 重启后它还在吗？内存态只配当性能优化，正确性必须落 DB
- [ ] 副作用入口新增时（建任务/spawn/通知类）默认考虑接 claimDedupeKey，kind 用既有三值或新增并写进 dedupe.js 注释
- [ ] "在入口处 claim 资源"类改动必须逐 return 路径核对释放（本次 server_overloaded 泄漏正是结构断言测试测不出的形态；行为出口多的巨型函数加 claim，审查时要求列出全部 return 清单）
- [ ] thalamus.js 独立分类表与 quarantine 不一致的 TODO 已埋，后续迁移方向是删表改调 classifyFailure
