# Wave 2: tick-scheduler.js + consciousness-loop.js 解耦

**分支**：cp-0504210223-wave2-tick-scheduler-consciousness
**日期**：2026-05-04

---

### 背景

从 tick-runner.js 的 executeTick()（1710 行混合了调度 + LLM 意识调用）中，将两类职责彻底解耦：
- tick-scheduler.js：纯调度，无 LLM，< 500ms
- consciousness-loop.js：所有 LLM 调用，每 20 分钟异步跑

---

### 根本原因（解决的核心问题）

**之前的问题**：executeTick() 混合了"调度任务"和"LLM 意识调用"，即使 LLM 已改 fire-and-forget，两层逻辑仍耦合在同一个函数中，难以独立测试、独立控制、独立扩展。

**解决方案**：两层彻底分离：
1. tick-scheduler.js 读 guidance（由 consciousness-loop 预写）→ 检 circuit breaker → 取 KR → dispatch
2. consciousness-loop.js 每 20 分钟：thalamus → decision → rumination → planner，结果写 guidance

---

### 关键发现

1. **guidance_used vs guidance_found**：最初返回 `guidance_used: true` 但 guidance 实际未传入 dispatchNextTask，是语义欺骗。改为 `guidance_found`（表示"DB 中是否有 guidance"），更诚实。

2. **fire-and-forget 需要超时保护**：rumination 是 fire-and-forget，但若不加超时，可能无限期在后台运行。用 `Promise.race + setTimeout(10min)` 解决。

3. **并发 guard 必须用 _isRunning flag**：setInterval 20 分钟一次，单次运行最长 5 分钟，理论上不会并发。但为了防御性设计，加 `_isRunning` flag + `finally { _isRunning = false }` 确保不堆积。

4. **tick-loop.js 才是 setInterval 的真正位置**：PRD 说"修改 tick.js"，但 tick.js 是纯 re-export 文件，真正的 setInterval 在 tick-loop.js 的 `startTickLoop()`。实际修改 tick-loop.js：`doTick = tickFn || runScheduler`，并在 `startTickLoop` 中调用 `startConsciousnessLoop()`。

5. **worktree node_modules 软链接**：worktree 内无 node_modules，vitest 无法启动。用 `ln -sf` 链接根目录 node_modules 解决。

---

### 下次预防

- [ ] worktree 初始化时就检查 node_modules 是否可用（brain 包单独有 package.json）
- [ ] PRD 中如果说"修改 X 文件"，先确认 X 的实际职责再动手（tick.js 是 re-export hub）
- [ ] 凡 fire-and-forget 调用，必须在 review checklist 中检查是否有超时保护
- [ ] `guidance_used` 类字段命名要准确反映语义（"used" ≠ "found"）
