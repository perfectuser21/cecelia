# Brain 双层架构：调度层与意识层分离

**日期**：2026-05-04  
**状态**：已批准  
**目标**：消除 tick loop 对 LLM 的阻塞依赖，实现"调度永不卡，意识可插拔"

---

## 问题陈述

`tick-runner.js` 主链路有 5 处串行 `await` LLM 调用，总耗时 50-100s，超过 `TICK_TIMEOUT_MS=60s`。任何一个 LLM 超时，任务派发延迟最高 3 分钟。行业六大框架（Temporal、AIOS、LangGraph、OpenHands、HiveMind、Google ADK）均遵循同一原则：**调度器绝不调 LLM**。

---

## 架构设计

### 核心原则：预计算制导（Pre-computed Guidance）

LLM 异步跑，把决策写进 `brain_guidance` 表。调度器读表（1ms），按便条派发。无便条则用默认规则。两层完全解耦，意识层挂掉不影响调度。

### Layer 1：调度层（Scheduler）

- **文件**：`packages/brain/src/tick-scheduler.js`（从 tick-runner.js 剥离）
- **运行频率**：每 5 秒
- **目标耗时**：< 500ms
- **规则**：
  - 永远不 `await` LLM
  - 查队列 → 按优先级 + 依赖排序 → 派发
  - 读 `brain_guidance` 表获取路由建议
  - 无建议时使用 `EXECUTOR_ROUTING` 默认路由表
  - Circuit breaker 状态从 DB 读取（持久化）

### Layer 2：意识层（Consciousness Loop）

- **文件**：`packages/brain/src/consciousness-loop.js`（新建）
- **运行频率**：每 20 分钟（可配置）
- **规则**：
  - 完全异步，结果写入 `brain_guidance` 表
  - 挂掉或超时不影响 Layer 1
  - 可通过环境变量 `CONSCIOUSNESS_ENABLED=false` 关闭
- **包含**：丘脑路由分析、反思、记忆更新、皮层 RCA

---

## 数据层

### brain_guidance 表

```sql
CREATE TABLE brain_guidance (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  source      TEXT NOT NULL,  -- 'thalamus' | 'cortex' | 'reflection' | 'memory'
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_brain_guidance_expires ON brain_guidance (expires_at);
```

Key 命名规范：
- `routing:${task_id}` — 单个任务路由建议，有效期 1 小时
- `strategy:global` — 全局策略建议，有效期 24 小时
- `cooldown:${executor}` — executor 冷却信号，有效期按错误类型
- `reflection:latest` — 最新反思结果，有效期 24 小时

### circuit_breaker_states 表

```sql
CREATE TABLE circuit_breaker_states (
  key           TEXT PRIMARY KEY,
  state         TEXT NOT NULL DEFAULT 'CLOSED',  -- CLOSED | OPEN | HALF_OPEN
  failures      INT NOT NULL DEFAULT 0,
  last_failure_at BIGINT,
  opened_at     BIGINT,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 执行计划

### Wave 1（3 个 agent 并行，约 2 天）

**Agent A — tick-runner.js 去阻塞**
- `runRumination` → fire-and-forget（`.then().catch()`）
- `generateDecision` → fire-and-forget + 15 分钟频率限制
- `planNextTask` → fire-and-forget
- `thalamusProcessEvent` → `Promise.race([call, timeout(30000)])` + fallback `{action: 'fallback_to_tick'}`
- 文件：`packages/brain/src/tick-runner.js`

**Agent B — circuit breaker DB 持久化**
- 新建 migration：`circuit_breaker_states` 表
- 修改 `circuit-breaker.js`：启动时从 DB 加载状态，状态变更时异步写 DB
- 文件：`packages/brain/src/circuit-breaker.js` + migration

**Agent C — brain_guidance 基础设施**
- 新建 migration：`brain_guidance` 表
- 新建 `packages/brain/src/guidance.js`：`getGuidance(key)` / `setGuidance(key, value, source, ttlMs)` / `clearExpired()`
- 文件：新建 guidance.js + migration

### Wave 2（Wave 1 合并后，2 个 agent，约 3 天）

**Agent D — 提取 tick-scheduler.js**
- 从 `tick-runner.js` 剥离纯派发逻辑到 `tick-scheduler.js`
- 集成 `getGuidance` 读取路由建议
- tick-runner.js 保留意识层调用（已改为 fire-and-forget）

**Agent E — consciousness-loop.js**
- 新建独立 loop，每 20 分钟触发
- 丘脑分析 → 写 `routing:${task_id}` guidance
- 反思 → 写 `reflection:latest` guidance
- 支持 `CONSCIOUSNESS_ENABLED` 开关

### Wave 3（Wave 2 合并后，1 个 agent，约 2 天）

**Agent F — executor 路由统一 + LLM 错误分类**
- `EXECUTOR_ROUTING` 统一路由表（task_type → executor_type）
- `arch_review` → `bridge`（修复 codex CLI 不存在问题）
- `classifyLLMError(err)` → 按错误类型 cooldown
  - `InsufficientFundsError` → cooldown 24h
  - `RateLimitError` → cooldown 1min
  - `AuthError` → cooldown 1h
- 写入 `cooldown:${provider}` guidance key

---

## 成功标准

- [ ] tick loop 耗时 < 500ms（无 LLM 阻塞）
- [ ] Brain 重启后 circuit breaker 状态从 DB 恢复，不清零
- [ ] `CONSCIOUSNESS_ENABLED=false` 时调度正常运行
- [ ] `arch_review` 任务不再触发 `codex ENOENT` 错误
- [ ] circuit breaker 不再因 LLM 超时积累失败计数

---

## 不在本次范围内

- BullMQ 任务队列引入（中期，待评估）
- 完整 Temporal 模式重构（长期）
- Layer 2 意识层的具体 LLM 提示词优化
