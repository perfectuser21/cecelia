# Learning：架构巡检必须核对“超时后的旧执行是否真的停止”

本轮巡检从 health 的 `last_duration_ms=255539` 反查生产日志，确认 60 秒 safety timer 只释放 tick 互斥锁，旧 `doTick()` 仍继续运行；后续两轮 scheduler 已在旧执行结束前完成。单看 `tickRunning` 已清、服务 healthy 或 circuit breaker CLOSED 都会漏掉这种并发重叠。

同时，`SYSTEM_MAP.md` 的 `updated` 已改成当天，但正文版本和 Schema 仍停在旧值；只看 frontmatter 会把“更新过文档”误当成“事实已刷新”。`/dev` worktree 脚本也把 GNU `flock -w` 当成通用接口，在 BusyBox 执行环境首步即失败。

### 根本原因

系统把“释放控制面状态”误当成“数据面执行已终止”：tick 超时逻辑只修改共享锁，没有取消、join 或租约代际检查。文档与工具链也缺少消费环境的事实校验，导致时间戳更新和本机测试通过无法证明正文、依赖或运行语义真实成立。

### 下次预防

- [ ] 超时保护测试必须断言旧执行已终止或失去副作用权限，不能只断言锁已清除。
- [ ] CURRENT_STATE 文档更新时运行机器校验正文中的版本、Schema 与 API 路径，禁止仅改 frontmatter。
- [ ] 核心 shell 入口在 GNU 与 BusyBox 工具集下各跑一条兼容性回归，避免把非 POSIX 参数当成通用能力。
- [ ] 架构巡检优先从异常 runtime 指标反查时间线日志，确认进程/任务生命周期是否真实闭合。
