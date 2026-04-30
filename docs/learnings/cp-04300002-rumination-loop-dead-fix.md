# Learning: PROBE_FAIL_RUMINATION loop_dead 根因细分 + 心跳位置修复

**Branch**: cp-04300002-rumination-loop-dead-fix
**Date**: 2026-04-30

## 背景

`rumination` 探针持续返回 `ok: false`，告警信息：
```
48h_count=0 last_run=Wed Apr 22 2026 08:55:55 undigested=1204 recent_outputs=0 heartbeats_24h=0 (loop_dead)
```

Brain auto-fix 任务方向错误：每次收到 `loop_dead` 标签后都尝试修代码，
但实际问题可能在于 consciousness 被禁用或 MINIMAL_MODE 开启，
导致修复任务反复打转、无效循环。

## 根本原因

### 原因 1：心跳写入位置错误（最关键）

旧代码把 `rumination_run` 心跳写在 `digestLearnings()` 内部。
当 `runRumination()` 因预算耗尽或冷却期未过而提前返回时，
`digestLearnings` 从未被调用，无心跳写入。

Probe 查询 24h 内 `rumination_run` 事件数量：
- 0 条 → 报告 `loop_dead`（误报：循环实际是健康的，只是被跳过）
- >0 条 → 报告 `degraded_llm_failure`

只要循环每天跳过（预算消耗完或冷却），probe 就会误报 `loop_dead`，
触发错误方向的自动修复任务。

### 原因 2：probe 无法区分三种不同的"无心跳"场景

旧代码只有两路：`degraded_llm_failure` vs `loop_dead`。
但"无心跳"实际有三种完全不同的根因：

| livenessTag | 真实含义 | 修复方向 |
|-------------|---------|---------|
| `loop_dead` | 意识开启但循环未知原因未运行 | 代码修复 |
| `consciousness_disabled` | `isConsciousnessEnabled()=false` | 检查 DB 或 env var |
| `minimal_mode` | `BRAIN_MINIMAL_MODE=true` | 移除 env var |

`loop_dead` 标签导致 auto-fix 任务一律尝试代码修复，
但后两种情况根本不需要改代码。

## 修复内容

### 1. `rumination.js`

- **将 `rumination_run` 心跳从 `digestLearnings` 移至 `runRumination` 入口**（所有 guard 检查之前）
  - 无论 runRumination 是否提前返回，心跳都会写入
  - Probe 现在能区分"循环被调用但跳过"vs"循环根本未被调用"
- **将 `digestLearnings` 内的心跳重命名为 `rumination_digest_run`**（更精确语义）

### 2. `capability-probe.js`

- 导入 `isConsciousnessEnabled` from `consciousness-guard.js`
- 心跳=0 时三路细分 `livenessTag`：
  - `BRAIN_MINIMAL_MODE === 'true'` → `minimal_mode` + 修复提示
  - `!isConsciousnessEnabled()` → `consciousness_disabled` + DB/env var 修复提示
  - 否则 → `loop_dead`（真正未知故障）
- `detail` 末尾透出 `consciousnessInfo`，auto-fix 任务的 prompt 自带根因方向

### 3. 测试更新（5 个文件）

- `capability-probe-rumination.test.js`: 新增 5 条断言（`consciousness_disabled`/`minimal_mode`/注释位置）
- `rumination.test.js`: mock 队列首部加 heartbeat INSERT + 新增"预算耗尽时仍写心跳"测试
- `rumination-suggestions.test.js`: 同步 heartbeat INSERT mock
- `rumination-fallback-context.test.js`: 同步心跳新位置 + digest_run 心跳

**测试结果**：103 条（基线）→ 108 条（新增 5 个测试），全部通过。

## 下次预防

- [ ] 凡是有前置 guard 检查的循环，心跳必须写在所有 guard 之前，而不是写在实际处理逻辑内
- [ ] Probe 的 `livenessTag` 应当精确反映根因，不能把配置问题（env/DB）标为代码问题
- [ ] Auto-fix 任务的 `detail` 字段必须包含足够的根因信息，否则 LLM 会在错误方向上打转
- [ ] 凡是新增"早返回"路径的循环，必须检查是否影响 probe 的心跳检测
