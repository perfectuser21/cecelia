## Brain {VERSION} — 棒3a 补丁：business-probe-judge 只判 active=true 的探针（任务 32d0109a）

- 棒2（#5589）漂移语义：仓库 YAML 删探针后 step_probes 库行置 `active=false`；棒3a（#5590）判定查询未过滤该列，停用探针会一直以 probe_missing 把格子打红
- `lib/business-probe-judge.js` 查 step_probes 加 `sp.active = true`；单测断言 SQL 含该过滤，pg 集成加一条停用探针断言不出回执、不拖红同格
