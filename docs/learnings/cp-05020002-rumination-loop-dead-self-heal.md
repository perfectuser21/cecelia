# RCA — PROBE_FAIL_RUMINATION loop_dead 自愈机制

- 事件日期：2026-05-02
- 影响链路：Brain capability-probe `rumination`
- 严重度：P1（反刍知识消化停止 10 天，undigested 累积 1547 条）
- 状态：自愈机制已落盘（cp-05020002）

---

## 1. 表象

`probeRumination` 连续返回 `ok=false`，detail 形如：
```
48h_count=0 last_run=Wed Apr 22 2026 undigested=1547 recent_outputs=0 heartbeats_24h=0 (loop_dead)
```

last_run 停在 4 月 22 日，10 天内无任何 synthesis 产出，1547 条 learnings 积压。

---

## 2. 根因

`loop_dead` 表示 `runRumination` 从未被 tick-runner 调用，原因是 `isConsciousnessEnabled()` 返回 false（被 DB 中 `consciousness_enabled = {enabled: false}` 禁用）或 `BRAIN_MINIMAL_MODE=true` 阻断了 section 10.x。

本次为 DB 禁用场景（env var 未设，DB 中 consciousness 被关闭后未恢复），导致反刍循环自 4/22 彻底静默。

历史修复轨迹：
- #2663: 心跳事件 `rumination_run` + LLM 全失败不标 digested
- #2717: 3 级心跳区分（invoke/run/output）+ loop_dead 根因透出（consciousness 状态、last_tick）
- #2728: MINIMAL_MODE + 上次 tick 时间透出增强
- 本次（cp-05020002）: 增加 **自愈机制** — 发现 loop_dead 时主动恢复

---

## 3. 修复方案

**`packages/brain/src/capability-probe.js`**

在 `probeRumination` 的 `loop_dead` 分支末尾，diagnostics 收集完毕后，新增两路自愈：

- **Case A — consciousness 被 DB 禁用（非 env override）**：调用 `setConsciousnessEnabled(pool, true)` 自动恢复，写 `self_heal=consciousness_reenabled` 到 detail
- **Case B — consciousness 已启用但 tick 未调用 rumination**：动态 import `runRumination`，直接运行，写 `self_heal=direct_run digested=N` 到 detail

两路都跳过 env_override（`CONSCIOUSNESS_ENABLED=false` / `BRAIN_QUIET_MODE=true`）和 `BRAIN_MINIMAL_MODE=true` 场景，这些是人工开关，不应自动覆盖。

**`packages/brain/src/__tests__/capability-probe-rumination.test.js`**
- 新增 6 个测试断言，覆盖：import 检查、self_heal 标记存在性、env_override 跳过逻辑、Case A（setConsciousnessEnabled）、Case B（动态导入 runRumination）、minimal_mode 跳过逻辑

---

## 4. 验证

- 单元测试：`vitest run capability-probe-rumination capability-probe-highlevel rumination*` → 全部通过（24+9+64 tests）
- 自愈 detail 格式：`loop_dead ... self_heal=consciousness_reenabled` 或 `self_heal=direct_run digested=N`
- 下一个 probe 周期（1h 后）应 48h_count > 0，探针转 ok=true

---

## 5. 不再发生的措施

1. `loop_dead` 场景不再只记录和报警，而是**主动自愈**，避免 10 天积压
2. DB 禁用 consciousness 的原因应写入 decisions 表，防止状态丢失
3. env override / minimal_mode 人工开关不被自动覆盖，人工操作保持幂等性
