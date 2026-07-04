# Learning: T2 orchestrator 骨架（reconcile loop）

### 根本原因
LangGraph 图的路由/门禁与 LLM 执行耦合在 Brain 进程内,状态活在 checkpoint(第二账本)。T2 把路由/门禁抽成确定性纯函数,状态每跳从外部真相现查(level-triggered),LLM 只在注入的 dispatcher 里。

### 踩过的坑(challenger + 3 轮 review 抓出)
- **在途容器不可观测→崩溃重拉必双 spawn**(challenger P0):observed 必含 inflight(docker label cecelia.run_id/hop/role),derive 加 wait:running 分支
- **verdict 不锚定 SHA→judge FAIL 死锁+stale PASS 误放新 commit**(challenger P0):verdict 权威=决策日志行(带 pr_head_sha),SHA 变化天然作废旧 verdict,fixDispatch 的 reset 清单整个不需要了
- **exit code/auth_failed 在轮询模型无观测源**(challenger P0):docker inspect ExitCode 按最新 intent hop 作用域取(否则 fix 后残留旧 137 白吃 fix round)+熔断状态读 account_usage_cache
- **propose 分支 rN 未按 task 过滤**(review):并发 initiative 时 ganRound 被其他 task 分支污染——凡"从共享命名空间(分支名/label)推导状态"必须带 task 作用域
- **无 sleep 无 hop 的控制分支=死转热循环**(review):persist_contract_approval 在 contract 行缺失时 UPDATE 0 行+continue 会打爆 DB;所有 continue 路径必须有 hop 计数或 sleep 或护栏退出
- **跨 PR 的断言残留**(review Critical):T1 的 migration 测试断言 selfcheck='293',T2 bump 后忘了同步——"承诺给下个任务的改动"要在下个任务的 checklist 里显式列出

### 下次预防
- [ ] reconcile/轮询型设计先过三问:在途任务怎么观测?verdict 锚定什么?exit 信号从哪来?
- [ ] 共享命名空间推导状态必须带作用域过滤并测跨实体污染
- [ ] 循环里每条 continue 路径核对:有没有推进计数/sleep/护栏三者之一
