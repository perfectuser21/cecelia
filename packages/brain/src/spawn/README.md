# Layer 3: Spawn Policy Layer

**状态**: P2 完成（PR1-PR11 全部合并，#2543-#2555）。9 个 middleware 已建立（内层 6 + 外层 4）。执行链整合等待后续 attempt-loop PR。
**对应 Spec**: [`docs/design/brain-orchestrator-v2.md`](../../../../docs/design/brain-orchestrator-v2.md) §5
**归属**: Brain 三层架构的 Layer 3 (Executor)

---

## 1. 目的

**Brain 里任何地方要跑 docker，都只能走 `spawn()`**。这是唯一的 spawn 原语——没有 escape hatch。

这一层承担所有**横切能力**：账号轮换、模型降级、配额检测、熔断重试、成本归账、日志。调用方（Layer 2 Orchestrator、tick、observer）只负责"我要用 X skill 跑 Y prompt"，其它交给 spawn 决定。

## 2. 目录结构（P2 完成后）

```
spawn/
├── spawn.js              ← 唯一对外 API
├── middleware/
│   ├── cost-cap.js       ← 外层：budget 守卫
│   ├── spawn-pre.js      ← 外层：prompt/cidfile/forensic log 前置
│   ├── logging.js        ← 外层：统一日志 + metric
│   ├── billing.js        ← 外层：写 dispatched_account / cost_usd
│   ├── account-rotation.js ← 内层 attempt-loop：选账号
│   ├── cascade.js        ← 内层：模型降级链
│   ├── resource-tier.js  ← 内层：内存/CPU tier
│   ├── docker-run.js     ← 内层：实际 docker run
│   ├── cap-marking.js    ← 内层：429/auth 检测 → markSpendingCap
│   └── retry-circuit.js  ← 内层：熔断 + 有限重试
└── __tests__/
    ├── spawn.test.js         ← 端到端集成测试
    └── middleware/*.test.js  ← 每个 middleware 独立单测
```

## 3. API 骨架

```js
/**
 * 唯一的 spawn 原语。
 *
 * @param {object} opts
 * @param {object} opts.task       { id, task_type }
 * @param {string} opts.skill      skill slash-command，如 '/harness-planner'
 * @param {string} opts.prompt     agent 收到的初始 prompt
 * @param {object} [opts.env]      显式 env（非空项被尊重，见 §5.3 优先级）
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cascade]  模型降级链 override
 * @param {object} [opts.worktree] { path, branch } 挂载点
 *
 * @returns {Promise<{
 *   exit_code, stdout, stderr, duration_ms,
 *   account_used, model_used, cost_usd,
 *   attempts: Array<{ account, model, exit_code, reason }>
 * }>}
 */
export async function spawn(opts) { ... }
```

## 4. Middleware 结构（两层洋葱）

见 Spec §5.2。关键原则：**账号轮换 / 模型降级 / 429 重试是同一个 attempt-loop 的内循环**，不是扁平 middleware。外层 Koa 风格，内层显式 for 循环。

候选遍历顺序（Spec §5.3）：**先横切账号保持 Sonnet，全满再降 Opus/Haiku**。

## 5. 禁忌

- ❌ 不允许在别处直接 import `docker-executor.js`——除 spawn 内部外，必须走 `spawn()`
- ❌ 不允许硬编码 `CECELIA_CREDENTIALS: 'account1'`（PR #2534 + P2 清理完这类残留）
- ❌ 不允许在 middleware 之外调用 `markSpendingCap` / `markAuthFailed`（由 cap-marking middleware 统一）

## 6. 回滚开关

P2 迁移期间加 env var `SPAWN_V2_ENABLED`：
- `true`（默认）：走新的 `spawn()`
- `false`：旧代码路径（`dispatchTask` 里的智能层）

P2 合并后观察 1 周稳定 → **删除 flag + 删除旧路径**，不保留"以防万一"。
