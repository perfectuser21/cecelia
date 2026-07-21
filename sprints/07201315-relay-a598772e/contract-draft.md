# Contract Draft — harness relay 收编 grok executor（三厂商走量格局落地）

**TASK_ID**: a598772e-7f74-40f0-a022-d0e8d2b35dc0
**SPRINT_DIR**: sprints/07201315-relay-a598772e
**日期**: 2026-07-20
**目标文件**: `packages/brain/src/harness-skill-relay.js`、`packages/brain/src/__tests__/harness-skill-relay.test.js`、`sprints/07201315-relay-a598772e/e2e-verify.sh`

---

## 合同范围

本合同覆盖将 `executor=grok` 接入 `harness-skill-relay.js` 主路由的全部行为断言。改动须严格对齐 codex 路径先例（L101-L152、L295、L334-L336），不触碰 isCodex/claude 既有逻辑。

---

## 行为断言（[BEHAVIOR] 测试条目）

### [BEHAVIOR-1] isGrok 分支识别

- **描述**：`task.payload.executor === 'grok'` 时，`spawnSkillRelaySession` 应走 grok 路径，不走 codex 路径，不走 claude 路径
- **输入**：`task.payload = { orchestrator: 'skill-relay', executor: 'grok' }`
- **期望**：`spawnFn` 被调用；`spawnOpts.env.CECELIA_EXECUTOR` 等于 `'grok'`；containerId 含 `-gk` 后缀（对齐 codex 的 `-cx` 先例）
- **回归保护**：`isCodex` 判断路径不变，`_activeCodexRelays` 不被 grok 路径修改

### [BEHAVIOR-2] GROK_RELAY_HOME 空字符串 loud-fail + task 回滚

- **描述**：`GROK_RELAY_HOME=''`（显式配置为空字符串）时必须拒绝 spawn，task 回滚到 queued，返回 `{ ok: false, error: ... }`
- **输入**：`process.env.GROK_RELAY_HOME = ''`，`task.payload.executor = 'grok'`
- **期望**：
  - `spawnFn` 未被调用
  - `pool.query` 含 `UPDATE tasks SET status='queued'` 调用
  - 返回值 `ok === false`，`error` 含 `GROK_RELAY_HOME` 字样
- **铁律**：与 CODEX_RELAY_HOME L141-152 先例完全对称，不得倒置

### [BEHAVIOR-3] GROK_RELAY_HOME 未配置（undefined）允许继续

- **描述**：`GROK_RELAY_HOME` 未设置时（undefined），grok 路径应放行 spawn（extraMounts 为空，凭据挂载跳过），测试注入 spawnFn 覆盖
- **输入**：`delete process.env.GROK_RELAY_HOME`，`task.payload.executor = 'grok'`，spawnFn 为 vi.fn().mockResolvedValue
- **期望**：`spawnFn` 被调用，`spawnOpts.extraMounts` 为 undefined 或为空数组（无 .grok 挂载），`r.ok === true`
- **铁律**：与 CODEX_RELAY_HOME L140-141 行为对称

### [BEHAVIOR-4] grok headless spawn：extraMounts + 启动命令正确

- **描述**：`GROK_RELAY_HOME` 已配置（非空）时，spawn 参数含正确挂载路径和 grok 启动命令
- **输入**：`process.env.GROK_RELAY_HOME = '/tmp/fake-grok'`，`task.payload.executor = 'grok'`
- **期望**：
  - `spawnOpts.extraMounts` 含 `'/tmp/fake-grok:/home/cecelia/.grok:rw'`
  - `spawnOpts.env.CECELIA_EXECUTOR === 'grok'`
  - `spawnOpts.prompt` 含 `SKILL_CONTENT_MARKER`（skill 全文 inline）和 task.id（上下文头）
  - `initiative_runs INSERT` 中 `orchestrator_host = 'skill-relay-grok'`（区别于 codex 的 `skill-relay-codex`）
  - deadline = 8h（对齐 `GROK_RELAY_DEADLINE_HOURS=8`）

### [BEHAVIOR-5] 额度撞墙检测：detectQuotaWall 返回正确

- **描述**：grok 输出含 QUOTA_WALL_PATTERNS 文本时，`detectQuotaWall` 函数返回 true
- **输入**：各 pattern 字符串（`'out of credits'`、`'rate limit'`、`'429'`、`'quota exceeded'`、`'quota reached'`、`'usage limit'`）
- **期望**：每个 pattern 均返回 `true`；不含任何 pattern 的正常输出返回 `false`

### [BEHAVIOR-6] 额度撞墙 fallback：grok → claude 降级重试

- **描述**：grok spawn 过程中检测到撞墙信号时，executor 降级到 claude，以 claude executor 重试一次，原任务不标 terminal failed
- **输入**：spawnFn 第一次调用时 mock 输出 `'out of credits'`（或 `detectQuotaWall` 被 spy 注入返回 true），`task.payload.executor = 'grok'`
- **期望**：
  - 第二次 spawn 调用时 `spawnOpts.env.CECELIA_EXECUTOR === 'claude'`（已降级）
  - 有 `console.warn` 含 `fallback` / `quota` 字样（可观测性）
  - 若二次 claude 重试成功，`r.ok === true`
  - 若二次 claude 重试失败，task 回滚到 queued

### [BEHAVIOR-7] headed 分支 grok 入口白名单

- **描述**：`task.payload.mode = 'headed'`，`task.payload.executor = 'grok'` 时，`_spawnHeadedSession` 的 `headedExecutor` 映射应包含 `'grok'` 分支（L471 入口白名单同步更新）
- **输入**：headed task + executor=grok
- **期望**：`_spawnHeadedSession` 走 grok headed 路径，tmuxPrefix 使用 `'grok-relay-'`（HEADED_TMUX_PREFIXES.grok），headedHost 使用对应 HEADED_HOSTS.grok 配置；`GROK_RELAY_HOME=''` 时 headed 分支同样 loud-fail（对齐 L478-491 codex headed 门禁）

### [BEHAVIOR-8] 回归：isCodex/claude 既有路径不变

- **描述**：本次改动后，所有现有 harness-skill-relay 测试必须全量通过，codex 和 claude executor 行为不变
- **输入**：现有测试套件（harness-skill-relay.test.js 全量）
- **期望**：
  - `_activeCodexRelays` 仍由 isCodex 路径专有管理
  - `codexRelayHome` 变量不被 grok 路径引用或覆盖
  - `orchestrator_host='skill-relay-codex'` 仅出现在 isCodex 路径
  - `orchestrator_host='skill-relay-session'` 仍出现在 claude 路径

---

## 不变量约束（Invariant）

1. `isGrok` 分支改动不得触碰 `isCodex`、`codexRelayHome`、`_activeCodexRelays` 的任何判断逻辑
2. `GROK_RELAY_HOME=''` → loud-fail + task 回滚；`GROK_RELAY_HOME=undefined` → 放行（不得倒置）
3. 额度撞墙 fallback 路径必须有独立单测（[BEHAVIOR-5] + [BEHAVIOR-6]）
4. grok 容器日志必须能证明是 grok 二进制在跑（Final E2E 硬断言）
5. secrets（auth.json 路径）不进 git、不进容器日志
6. PR 推出前必须 smoke.sh + smoke-allowlist 登记（CI 两连红铁律 3efefc23）
7. 全量 harness-skill-relay 测试必须绿（回归保护）

---

## 受影响文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `packages/brain/src/harness-skill-relay.js` | 修改 | isGrok 分支、GROK_RELAY_HOME 检查、headless/headed spawn、额度撞墙+fallback、HEADED_HOSTS/TMUX_PREFIXES 扩展 |
| `packages/brain/src/__tests__/harness-skill-relay.test.js` | 新增测试 | [BEHAVIOR-1] ~ [BEHAVIOR-8] 8 个测试条目 |
| `sprints/07201315-relay-a598772e/e2e-verify.sh` | 新建 | Final E2E 验收脚本 |

---

## E2E 验收

见 `contract-dod.md` ## E2E 验收 段落及 `e2e-verify.sh`。

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| BEHAVIOR-1 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | CECELIA_EXECUTOR=grok 注入 spawnFn env | Red commit 8a2304b91: 24 failures |
| BEHAVIOR-2 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | GROK_RELAY_HOME="" → spawnFn 未被调用 | Red commit 8a2304b91: 24 failures |
| BEHAVIOR-3 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | GROK_RELAY_HOME 未设置 → spawnFn 被调用，r.ok===true | Red commit 8a2304b91 |
| BEHAVIOR-4 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | extraMounts 含 GROK_RELAY_HOME | Red commit 8a2304b91 |
| BEHAVIOR-5 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | detectQuotaWall 是导出的函数 | Red commit 8a2304b91 |
| BEHAVIOR-6 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | grok 撞墙 → 第二次 spawnFn 调用使用 CECELIA_EXECUTOR=claude | Red commit 8a2304b91 |
| BEHAVIOR-7 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | HEADED_HOSTS 含 grok 条目 | Red commit 8a2304b91 |
| BEHAVIOR-8 | `../../tests/regression/relay-a598772e/harness-skill-relay-grok.test.js` | executor=codex（CODEX_RELAY_HOME 配置）→ orchestrator_host=skill-relay-codex（不变） | Red commit 8a2304b91 |
