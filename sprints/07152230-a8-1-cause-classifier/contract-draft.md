# Contract Draft — A8-1 死因分类器 + 路由骨架

- task_id: 431d24b1-de5e-4002-8581-8740c8a73232
- sprint_dir: sprints/07152230-a8-1-cause-classifier
- 日期: 2026-07-15
- GAN 轮次: 第 1 轮

---

## 交付物定义

### 1. `packages/brain/src/harness-death-classifier.js`

**接口签名**：

```js
/**
 * 纯函数死因分类器。三源取证，无 I/O，无副作用，无 DB 调用。
 *
 * @param {{
 *   exitCode: number | null,
 *   stdoutTail: string | null,
 *   tmuxPane: string | null
 * }} evidence
 * @returns {{
 *   cause: 'oom' | 'auth' | 'rate_limit' | 'interactive_stuck' | 'ci_red' | 'green_waiting_merge' | 'unknown',
 *   action: 'oom_upgrade' | 'auth_retry' | 'rate_limit_defer' | 'kill_refire' | 'ci_red_refire' | 'await_merge' | 'log_only'
 * }}
 */
export function classifyDeath({ exitCode, stdoutTail, tmuxPane }) { ... }
```

**cause 枚举与判定优先级**（高→低）：

| 优先级 | cause | 判定条件 | action |
|--------|-------|----------|--------|
| 1 | `oom` | exitCode === 137 | `oom_upgrade` |
| 2 | `auth` | stdoutTail 含 `401`/`403`/`Unauthorized`/`Invalid API key`/`credentials` | `auth_retry` |
| 3 | `rate_limit` | stdoutTail 含 `429`/`quota`/`rate limit`/`overloaded`/`too many requests` | `rate_limit_defer` |
| 4 | `interactive_stuck` | tmuxPane 含 `Press enter`/`press esc`/`choose`/`Select`/`[Y/n]`（大小写不敏感） | `kill_refire` |
| 5 | `ci_red` | 由 watchdog 传入 CI 状态推断（stdoutTail 含 `CI_RED` 标记或 watchdog 逻辑明确传入）| `ci_red_refire` |
| 6 | `green_waiting_merge` | stdoutTail 含 `GREEN_WAITING` 标记（watchdog 侧注入）| `await_merge` |
| 7 | `unknown` | 上述均不符 | `log_only` |

**取证源优先级**：exitCode > stdoutTail > tmuxPane（同时命中多源时，高优先级 cause 胜出）。

**不变量**：
- 模块行数 ≤ 120 行
- 无任何 `import`（除类型注释），无 async，无 fs/net/db 调用
- 执行耗时 < 1ms（纯同步函数）

---

### 2. `packages/brain/src/harness-relay-watchdog.js` — 收尸路径接分类器

**集成点**（在现有 resumeStalledRelayRuns 中，OOM 判定代码块 附近）：

```js
// 新增：调用死因分类器
const { classifyDeath } = await import('./harness-death-classifier.js');
const classified = classifyDeath({
  exitCode: task.payload?.last_container_exit_code ?? null,
  stdoutTail: task.payload?.stdout_tail ?? null,
  tmuxPane: null, // headless 路径无 tmux（headed 路径见 _handleHeadedRun）
});

// 审计日志（INV-06）
console.log(`[relay-watchdog] cause=${classified.cause} action=${classified.action} initiative=${run.initiative_id}`);

// 路由分叉
if (classified.cause === 'oom') {
  // → 现有 A7 路径（spawnOpts.memoryTier='oom_upgrade'）
} else if (classified.cause === 'ci_red') {
  // → fall through，走现有 CI 红路径
} else {
  // auth / rate_limit / interactive_stuck / green_waiting_merge / unknown
  // → action=log_only，走现行路径（不修改 attempt 计数，不触发额外 spawn）
  continue; // 或保留现有 continue 逻辑
}
```

**约束**：
- 分类器调用在 attempt cap 检查之后（防止消耗 attempt 配额无效）
- OOM 路径沿用现有 `isOomExit` + `spawnOpts.memoryTier='oom_upgrade'` 实现（不重复造轮子）
- INV-02：`oomUpgraded && exitCode === 137` 分支保持不变（二次升档墙）
- 现有日志格式保持兼容（只追加，不修改旧 console.log 格式）

---

### 3. `packages/brain/src/__tests__/harness-death-chain.test.js`

**测试框架约定**（TDD — 先写 failing test，再写实现）：

覆盖三条全链用例：

#### 用例 1：OOM 全链
```
S1: container 消失（exitCode=137）
→ S2: classifyDeath → cause='oom'
→ S3: 路由 → spawnFn 收到 spawnOpts.memoryTier='oom_upgrade'
→ 验收: DB payload.oom_upgraded=true 回写
```

#### 用例 2：CI 红全链
```
S1: container 消失，gh pr checks → CI FAILURE
→ S2: classifyDeath → cause='ci_red'
→ S3: 路由 → spawnFn 正常重点火（无特殊参数）
→ 验收: out.resumed++ && 无 memoryTier
```

#### 用例 3：Unknown 全链
```
S1: container 消失，exitCode=1，无关键词
→ S2: classifyDeath → cause='unknown'
→ S3: 路由 → action='log_only'，不触发 spawnFn
→ 验收: out.resumed 不变，console.log 含 'cause=unknown action=log_only'
```

**Mock 边界**（INV-04）：
- 只 mock 外部命令面：`docker ps`、`gh pr view`、`gh pr checks`、`gh pr list`、`tmux capture-pane`
- 不 mock：classifyDeath（纯函数，直接调用）、watchdog 路由逻辑、spawnFn 参数构造
- spawnFn 可 stub（记录调用参数），但参数构造逻辑不 mock

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `../../packages/brain/src/__tests__/harness-death-chain.test.js` | oom → 升档 spawn / ci_red → 正常重点火 / log_only，不触发 spawn | Red commit ce71b97 — harness-death-classifier.js 不存在时 import 报 ERR_MODULE_NOT_FOUND |
| WS2 | `../../packages/brain/src/__tests__/harness-death-classifier.test.js` | exitCode=137 → cause=oom / exitCode 优先） / 无 import 约束 — 模块无任何 import 语句 / 函数执行耗时 < 1ms | Red commit ce71b97 — 同上，import 失败 |

## E2E 验收

### E2E-01：OOM 死亡全链（brain-ci.yml，headless）

**前置**：
- DB 中有一条 `status=in_progress, orchestrator='skill-relay'` 的 task
- `payload.last_container_exit_code=137`, `payload.oom_upgraded=false`
- docker ps 返回空（容器已消失）

**验收断言**：
1. `resumeStalledRelayRuns` 调用 `spawnFn` 时，`spawnOpts.memoryTier === 'oom_upgrade'`
2. `console.log` 输出含 `cause=oom action=oom_upgrade initiative=<id>`
3. DB `tasks.payload.oom_upgraded` 回写为 `true`

### E2E-02：CI 红重点火链（brain-ci.yml，headless）

**前置**：
- task `status=in_progress`，pr_url 存在
- `gh pr view` → state=OPEN，mergeStateStatus=CLEAN
- `gh pr checks` → state=FAILURE

**验收断言**：
1. `classifyDeath` 返回 `cause='ci_red'`
2. `spawnFn` 被调用（`out.resumed++`）
3. 无 `spawnOpts.memoryTier`（ci_red 不升档）
4. `console.log` 含 `cause=ci_red action=ci_red_refire initiative=<id>`

### E2E-03：Unknown 死亡不乱打（brain-ci.yml，headless）

**前置**：
- task `status=in_progress`，exitCode=1，stdout_tail=''，tmuxPane=null

**验收断言**：
1. `classifyDeath` 返回 `cause='unknown' action='log_only'`
2. `spawnFn` 不被调用（`out.resumed` 不变）
3. `console.log` 含 `cause=unknown action=log_only`

### E2E-04：分类器纯函数单测（独立，无外部依赖）

```bash
node --test packages/brain/src/__tests__/harness-death-chain.test.js
```

全部 pass，耗时 < 5s。

---

## 未覆盖真实链路清单

| 链路 | Mock 情况 | 说明 |
|------|-----------|------|
| `docker ps` 容器存活检测 | mock 返回空字符串 | 真实 docker 环境不在 CI 中；mock 复现"容器消失"语义 |
| `gh pr view` PR 状态查询 | mock 返回 JSON 字符串 | 真实 GitHub API 调用被 mock；mock 复现 OPEN/MERGED/state 语义 |
| `gh pr checks` CI 状态查询 | mock 返回 JSON，含非零退出（err.stdout 兜底路径保留） | 复现 FAILURE 状态；execTolerant 路径被测到 |
| `gh pr list` PR 发现反查 | mock 返回 JSON 数组 | 真实 API 被 mock |
| `tmuxPane` 内容 | L1 测试直接传字符串（headless 路径无 tmux）| headed 路径 tmux capture-pane mock 留 A8-2 |
| `spawnSkillRelaySession` | stub（只验参数，不执行真实容器 spawn）| 真实 docker run 不在 CI 沙箱内执行 |
| DB PostgreSQL 写入 | 使用 fake pool（in-memory stub）| 真实 DB 不在 unit/chain test 中 |

**N/A（真实调用，无 mock）**：
- `classifyDeath` 纯函数（直接调用，不 mock）
- watchdog 路由逻辑（真调用相邻环节，不 mock）
- attempt cap 计算逻辑（真调用）
