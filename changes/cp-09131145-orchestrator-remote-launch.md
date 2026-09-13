## Brain {VERSION} — orchestrator 远程化 + 机器角色模型：CI 闸配套

- 新增 `sprints/09131144-orchestrator-remote-launch/contract-draft.md`：orchestrator 远程化 + machine-registry 角色模型的 Test Contract，覆盖 machine-registry primary 唯一性 / step3 远程派发 / step3 非 kernel 拒绝 / orchestrator-runner 槽位 / kernel-liveness 租约判死 / credential-broker 权威判据锁定 六条 BEHAVIOR + 一条 SMOKE。
- 新增 smoke `packages/brain/scripts/smoke/orchestrator-remote-launch-smoke.sh`：锁住生产不变量——`local_execution.enabled=false`（调度器闸关）时 `fleet_transport` 必须就绪且有 worker 机器，否则等于 harness 全类任务无任何执行路径、静默停摆（96054a8b 铁律的反面）。已登记进 `packages/quality/smoke-allowlist.txt`。
- 新增配置守卫 `scripts/ci/__tests__/machine-registry-role-guard.test.sh`：machine-registry 必须恰好一台 primary；`us-mac-m4` 字面量收窄为**文件级白名单 + 每文件命中数棘轮**（只许降不许升）——白名单即 Mac Studio 到货时的迁移清单，届时每个白名单文件都要动。
