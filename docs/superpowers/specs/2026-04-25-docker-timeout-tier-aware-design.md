# Docker Executor Timeout — 默认 90min + per-tier override

## 背景

`docker-executor.js:36` 的 `DEFAULT_TIMEOUT_MS = 900000`（15 分钟）对 Generator 容器跑大改动严重不足。
Gen2 复杂任务（多文件 + GAN 多轮 + CI 等待）正常需要 1-2 小时，第一次就被 SIGKILL。
临时改 `.env.docker` 不持久，需要把默认值持久化到代码，并允许按 `tier` 细粒度调整。

## 设计

### 1. DEFAULT_TIMEOUT_MS 提升到 90 分钟

`packages/brain/src/docker-executor.js:36`：

```js
const DEFAULT_TIMEOUT_MS = parseInt(process.env.CECELIA_DOCKER_TIMEOUT_MS || '5400000', 10); // 90 min
```

env 仍可 override，但代码默认从 15min → 90min。

### 2. RESOURCE_TIERS 加 timeoutMs 字段

`packages/brain/src/spawn/middleware/resource-tier.js`：

```js
export const RESOURCE_TIERS = {
  light:           { memoryMB: 512,  cpuCores: 1, timeoutMs: 30  * 60 * 1000 }, // 30 min
  normal:          { memoryMB: 1024, cpuCores: 1, timeoutMs: 90  * 60 * 1000 }, // 90 min
  heavy:           { memoryMB: 1536, cpuCores: 2, timeoutMs: 120 * 60 * 1000 }, // 2 h
  'pipeline-heavy':{ memoryMB: 2048, cpuCores: 1, timeoutMs: 180 * 60 * 1000 }, // 3 h
};
```

`resolveResourceTier(taskType)` 返回值自然带上 `timeoutMs`。

### 3. executeInDocker 优先级

`packages/brain/src/docker-executor.js:executeInDocker`：

```js
const tier = resolveResourceTier(taskType);
const timeoutMs = opts.timeoutMs                          // 1. 调用方显式传入
              || tier.timeoutMs                            // 2. tier 配置
              || DEFAULT_TIMEOUT_MS;                       // 3. 全局默认
```

环境变量 `CECELIA_DOCKER_TIMEOUT_MS` 仍 override DEFAULT_TIMEOUT_MS（即 fallback 兜底），
但 tier.timeoutMs 比 fallback 优先 — 让"轻任务不要等 90min"成立。

### 4. 新增 / 更新测试

#### A. `packages/brain/src/__tests__/docker-executor-timeout.test.js`（新建）

- mock `harness_task` task_type=normal → executeInDocker 计算出 timeoutMs = 90 * 60 * 1000
- mock `content_research` task_type=pipeline-heavy → 180 * 60 * 1000
- `opts.timeoutMs` 显式传入 → 覆盖 tier
- 通过 mock `runDocker` 捕获实际传入的 timeoutMs

#### B. 既有断言更新

`packages/brain/src/spawn/middleware/__tests__/resource-tier.test.js`：
- `toEqual({ memoryMB, cpuCores })` → 加 `timeoutMs` 字段
- 加新断言：4 个 tier 的 timeoutMs 数值精确匹配 spec

## 兼容性

- `RESOURCE_TIERS` 加字段不会破坏既有读取（解构只取 memoryMB/cpuCores 的 caller 不感知）
- `buildDockerArgs` 用 `tier.memoryMB / tier.cpuCores`，新字段不影响现有逻辑
- 旧测试 `toEqual` 严格匹配会炸（既有 6 处） → 一并更新

## DoD 映射

- `[ARTIFACT] DEFAULT_TIMEOUT_MS=5400000` → grep 验证 docker-executor.js:36
- `[ARTIFACT] resource-tier 含 timeoutMs per tier` → grep 验证 4 个 tier 都含 timeoutMs
- `[BEHAVIOR] mock harness_task tier=normal → 90min timeout` → docker-executor-timeout.test.js
- `[BEHAVIOR] mock content-pipeline tier=pipeline-heavy → 180min timeout` → 同测试

## 风险

- **Gen 容器跑超长导致资源占用**：90min 默认对 normal 偏长，但实际 normal 任务 LLM 自然结束在 5-30min 之内，超时只是兜底；改动符合"宽松默认"原则。
- **既有 resource-tier.test.js 严格 toEqual 断言**：必须同步更新，否则 CI 红。
