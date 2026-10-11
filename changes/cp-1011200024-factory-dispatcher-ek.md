## Brain {VERSION} — 技能工厂派发器 claim 的 executor_kind 改 openclaw-agent

- 上产实测：推进器建出的 stage 3 执行单被派发器 claim 时 Brain 回 500（`tasks_executor_kind_check` 不认 `factory-dispatcher`），执行单永远认领不了；改用已登记的 `openclaw-agent`
- 回归测试：Brain 客户端 claim 请求体断言
