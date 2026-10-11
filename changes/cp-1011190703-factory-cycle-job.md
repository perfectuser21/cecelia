## Brain {VERSION} — 技能工厂推进器 + 自动裁判改挂调度器（上产实测发现原挂点从未运行）

- `runFactoryCycle` 登记为 scheduler-jobs `factory-cycle`（5 分钟自 gate，调度器每 60s 全调）；`executeTick` 自 Wave 2 起不被调用，#6284 的 tick-runner 挂点删除
- 回归测试：调度接线 + 自 gate + tick-runner 不再挂
