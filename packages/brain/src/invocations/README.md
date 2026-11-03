# Skill Invocation：Runner vs Commander

`invoke()` 将完整 Activity 合同、固定 Skill 字节与 `runner_policy` 封进摘要快照；authoring 和目录调用使用同一入口。执行时 `runInvocationActivities()` 复用公共 `runActivityContract()`，按快照顺序逐项运行，旧整包 Agent 提示词停用。

每个 Activity 登记独立 research 子任务和 task_run，再调用既有 Codex Bridge `/run`。单次请求只含本 Activity 的 Skill、合同、输入、身份和 Commander 指导。HTTP 接受不算完成；必须独立读回同一子 run 的终态及 task callback 结果。子任务回调不会结束父任务。未知派发不重发；Bridge 缺少可核验停止接口时，超时/中止保留 execution_unknown，暂停后续 Activity。

父控制器是 Brain 内的真实异步 Promise，不对应父任务 OS 进程。活性探针须核对冻结 envelope、dispatch/current_run_id、tenant/input/target 摘要及真实 task_run 来源；同 run 控制器在内存才判活。重启丢失控制器后转待审并记录 execution_unknown/readback_only，保留 claim 和原运行账，不按父 PID 回队或重发整包调用。任意 payload 标记不能取得豁免。

Runner 检查输入/输出 schema，并执行独立 Validator。只有固定合同显式声明 `validation.kind: schema` 时，结构检查足以验收；其他质量标准缺独立 Validator 时为 unknown/needs_review。执行者或 Commander 的 verdict 字段不能替代检查。Commander 来自固定中心 Skill，只观察、答复、纠偏或中止；恢复最多一次，指导进入下一回合，预算沿用公共 Runner 剩余时间。

服务端 `skill-invocation-runner-v1` 策略在建快照时固定：每 Activity 300 秒、5 秒心跳，done→next，其他状态→pause，无自动重试。缺策略、合同、schema 或验收标准的旧快照直接 needs_review。该入口仍只允许无资源绑定、无外部写入的纯 Skill；没有把账号、设备或发送授权迁入此入口。

所有事件保存 tenant、request_key、目标、输入和 envelope 摘要。父任务成功回调必须匹配公共 Runner 签发的终态 receipt 摘要；schema 正确的整包 Agent 自述也不能绕过此证明。独立 Validator 未配置与现役 Bridge 无停止 RPC 是明确限制，不能作为已完成质量验收或已停止执行报告。
