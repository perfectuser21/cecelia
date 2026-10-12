## 删除 kernel-v1 无头派发路径与已孤立的 harness 模块（A5-1，2026-10-12）

### 根本原因

- A1~A4 关掉了无头 harness_initiative 的派发和建单，但执行代码还在：harness-skill-relay 保留 kernel-v1 的本机 / 远程桥 / 有头三条启动分支，relay watchdog 仍会对 kernel-v1 run 恢复 attempt、本机重启、远程 requeue、续有头心跳。生产 initiative_runs / harness_attempts 10-02 后停写、无未终结 kernel run，这些分支只剩风险没有用途。
- 一批 harness 模块早已没有运行时引用（只剩测试和 smoke 在引用）：LangGraph 旧 GAN 图及其依赖（session-bridge、contract-verify、git-fence、retry-policies）、harness-dag、harness-ci-gate、harness-heartbeat 等。它们靠测试「保活」，看起来像在用。
- 不能整体删 harness-skill-relay / relay watchdog：golden_path_proposal（决策 0d4519b7 保留）仍走同一个 relay 咽喉（runHarnessInitiativeRouter → spawnSkillRelaySession 的非 kernel 路径）。

### 下次预防

- [ ] 删旧链先做可达性盘点：以 server.js、scripts/**、跨包 import 和 CI/部署脚本里按路径引用的文件为根，算 import 闭包；只被测试 / smoke 引用的模块就是死代码。只按文件名 grep 会被注释和测试里的路径误导。
- [ ] 删模块要连带清理：smoke 清单（allowlist / debt / write-targets / sql-targets）、vitest.config.js 的显式文件列表、CI invariant 里按路径读源码的断言、GP/回归测试里的旧用例。
- [ ] 共享咽喉（同一函数服务多条链）只删死分支，并为保留链加一条「不被新拒绝码误伤」的用例。

- 接续核验：历史守卫仍断言已退役 kernel 会重启/续租，必须随退役合同改为零执行；历史排队统计 SQL/JS 一致性继续保留。
- PG 混合回归也必须按退役合同更新；单元配置排除 integration，不能把单元全量当作 PG 通过。保留真实数据库验证零恢复、零租约改写。
