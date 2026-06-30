### 根本原因

`PROBE_FAIL_RUMINATION`（`loop_dead` + `consciousness=DISABLED(db)`）触发 self-heal 后形成派发死循环：

1. Probe 检测到 `loop_dead` → 自愈（重启 consciousness + 运行 runRumination）
2. 但 `runRumination` 有 10min 冷却期，若同进程内刚调用过，则跳过 `rumination_invoke` 事件写入
3. 下次 probe 仍看到 `invocations_24h=0` → 误判 `loop_dead` → 再次返回 `ok=false` → auto-fix 再次派发任务
4. 自愈效果无法被 probe 感知，导致自修复任务无限堆积

### 修复方案

**修复 1（capability-probe.js）：Grace period 机制**
- 自愈触发后写入 `rumination_self_heal_initiated` 事件到 `cecelia_events`
- 2h 内有 self_heal 事件 + 30min 内有 `rumination_invoke` 证据 → 返回 `ok=true`，避免重复派发 auto-fix

**修复 2（rumination.js）：runRuminationForce 函数**
- 新增 `runRuminationForce(pool)`：绕过 10min 冷却期 + 日预算限制
- self-heal 改用 Force 版本，调用前无条件写入 `rumination_invoke` 心跳事件
- fire-and-forget（不 await），防止 LLM 调用阻塞探针（>30s 超时）

### 教训与预防

- **自愈必须可观测**：self-heal 后必须留下可查询的事件标记，让下次探针能感知"正在愈合中"
- **冷却期是把双刃剑**：保护生产免受过度调用，但同时可能让"有无调用"这一状态信号失真 → 确保 Force 版本在紧急路径可用
- **探针异步安全**：探针内任何 LLM/耗时操作必须 fire-and-forget，探针本身要求 <30s 内返回
- **Grace period 必须双重验证**：只凭 self_heal 事件不够（事件可能是旧的），需同时确认 rumination_invoke 在近期存在

### 下次预防

- [ ] 任何 self-heal 机制引入时，同步设计 grace period 检测（heal 事件 + 效果确认事件双重验证）
- [ ] 探针超时阈值（PROBE_TIMEOUT_MS=30s）视为硬约束，所有探针内部操作若可能 >5s 须异步化
- [ ] `runRumination` 类函数设计时同步提供 `Force` 变体，供紧急路径使用（避免冷却期阻断可观测性事件写入）
