# LEARNINGS — PROBE_FAIL_RUMINATION loop_dead 根因透出增强

- 事件日期：2026-05-02
- 任务 ID：cp-05020002
- 影响链路：Brain capability-probe `rumination`，`loop_dead` 故障路径
- 状态：已修复并提交

---

## 1. 问题

上一轮修复（PR #2717）为 `loop_dead` 增加了 `consciousness_enabled` 和 `tick_last` 透出，但存在两个诊断盲区：

**盲区 A — BRAIN_MINIMAL_MODE 未检测**

`tick-runner.js` 中，整个 section 10.x（含 rumination）被 `if (!MINIMAL_MODE)` 包裹。若 `BRAIN_MINIMAL_MODE=true`，rumination 永不运行，但探针 detail 对此完全沉默，自动修复任务无法从 detail 判断根因。

**盲区 B — 意识状态只读 DB，忽略 env var**

`probeRumination` 的 loop_dead 分支直接查 `working_memory.consciousness_enabled`，但 `isConsciousnessEnabled()` 的优先级顺序是：
1. `CONSCIOUSNESS_ENABLED` env var（最高优先）
2. `BRAIN_QUIET_MODE` env var（deprecated alias）
3. DB `working_memory`
4. 默认 true

若 `CONSCIOUSNESS_ENABLED=false` 被设置但 DB 未写，探针会报 `consciousness=enabled` 而实际系统意识已禁用。

---

## 2. 修复

**`packages/brain/src/capability-probe.js`（`probeRumination` loop_dead 分支）**

新增 MINIMAL_MODE 检查（在 consciousness 检查之前，因为是更外层的守卫）：
```javascript
const minimalMode = process.env.BRAIN_MINIMAL_MODE === 'true';
if (minimalMode) {
  loopDeadContext += ' minimal_mode=ENABLED(blocks_rumination)';
}
```

意识状态检查引入 env var 优先级：
```javascript
const envOff = process.env.CONSCIOUSNESS_ENABLED === 'false' || process.env.BRAIN_QUIET_MODE === 'true';
const consciousnessEnabled = !envOff && (consciousnessVal?.enabled !== false);
// DISABLED 时附加 (env_override) 或 (db) 后缀说明来源
```

---

## 3. 不再发生的措施

- **探针诊断必须与实际运行路径对齐**：probe 用的守卫顺序要和 tick-runner 的守卫顺序一致，不能只检查内层守卫而忽略外层守卫
- **env var 优先级逻辑只在一处定义**（`isConsciousnessEnabled()`），probe 中对意识状态的判断应和该函数逻辑完全一致，不要手写重复逻辑

---

## 4. 测试

新增 5 个测试用例（`capability-probe-rumination.test.js`）：
- `env override 导致的 DISABLED 包含 (env_override) 后缀`
- `意识状态检查同时考虑 env var`
- `loop_dead 分支检查 BRAIN_MINIMAL_MODE`
- `MINIMAL_MODE 启用时 detail 包含 minimal_mode=ENABLED(blocks_rumination)`
- `MINIMAL_MODE 检查在 consciousness 检查之前`

全部 18/18 PASS。
