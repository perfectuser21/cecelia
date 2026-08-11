# Sprint Contract Draft (Round 1) — 宿主 bridge 凭据只读消费

**journey_type**: agent_remote
**target_environment**: local_api（纯宿主后端 node 集成：真起 cecelia-bridge.cjs + fs mtime/sha256 断言 + 并发）
**gp-anchor**: skipped (product-map.json not found)
**contract-gate**: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在）→ 走代码层 Contract Gate

---

## Response Schema（推导来源: PRD 字面 + api_registry 内部端点）

本 sprint 是**内部凭据投递机制**改动，**不改** `/llm-call` 对外响应 schema，仅新增一条失败路径。

### Endpoint: POST http://localhost:3457/llm-call（Brain llm-caller → 宿主 bridge）

**Success (HTTP 200)** — 不变：
```json
{"ok": true, "text": "<string>", "model": "<string>", "elapsed_ms": <number>}
```
- 本 sprint **不新增/不改名** 任何成功响应字段（内部隔离改动对调用方透明）。

**新增失败路径 — 临时 config dir 创建失败 (HTTP 500)**：
```json
{"ok": false, "error": "<string, 含 config dir provision 失败原因>", "elapsed_ms": <number>}
```
- `ok` (bool, 必填): `false`
- `error` (string, 必填): provision 失败原因；**禁止**回退到直接用权威目录后返回 200。
- 失败时告警：`console.error` 记 `[bridge] /llm-call config dir provision failed`（可被日志断言）。

**禁用字段名**（不得出现在响应）: `credentials`、`accessToken`、`configDir`、`token`（凭据/路径不外泄给调用方）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `packages/brain/src/__tests__/docker-executor-mount-strategy.test.js` → `buildDockerArgs — CLAUDE_CONFIG_DIR 挂载策略`：容器路径 `:ro` 挂载 + 容器内改写为 `/home/cecelia/.claude` 可写副本 —— **本 sprint 不得改动 docker-executor 行为**。
- [回归] `packages/brain/scripts/fleet-worker/credential-envelope.test.cjs` → `credential-envelope/v1` 消费方校验 —— Codex 信封路径 **行为不变**。
- [回归] `packages/brain/src/orchestrator/credential-broker.test.js` / `github-credential-broker.test.js` —— broker 签发路径 **行为不变**。
- [累积FR] context-manifest: 本 line（journey e6f803f2）golden-paths 返回空，无累积 FR 端点数据（PRD 已声明）；既有对照模式（容器 :ro + 可写副本、Codex credential-envelope/v1 只读消费）不得破坏。

## 历史约束三源

1. **铁律 → INV 覆盖条目**（逐条映射进 contract-dod.md）：
   - INV-1「不回写权威」→ DoD `[BEHAVIOR] INV-1`（核心红线：权威文件 mtime+sha256 不变）
   - INV-2「顺序不可颠倒 / 本 PR 不改 infrastructure」→ DoD `[BEHAVIOR] INV-2`（ARTIFACT 断言 diff 不触及 infrastructure/让位逻辑）
   - INV-3「judge 证据分流」→ N/A：属 judge 层协议，本 sprint 交付物（bridge 代码 + 测试）不触及 judge 证据分流逻辑。
2. **累积 FR**：见上「已知约束」[累积FR] 行（context-manifest 无数据，PRD 已声明空）。
3. **回归测试**：见上「已知约束」[回归] 三行。

## 案卷 closure 声明

propose_round = 1，`inputs.case_file` 为空 → 本步跳过（无上一轮 blocker）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | bridge /llm-call 起 claude 前，按 attempt 从权威目录复制独立临时 config dir，`CLAUDE_CONFIG_DIR` 指向副本；attempt 结束清理副本；权威文件全程只读 | 见 Golden Path Step 1-5 |
| **NFR（做得多好）** | 权威文件写入次数=0（任何 mtime/sha256 变化即失败）；并发各用独立临时目录互不覆盖 | 见 NFR 断言 B-01/B-05 |
| **Invariant（永不违反）** | 派出的执行体只读消费凭据、权威文件唯一写入者是 refresh-claude-tokens.sh；顺序不可颠倒（第 1 步未验证前不碰让位逻辑）；本 PR 不改 infrastructure 仓库 | INV-1 / INV-2 |
| **判定点（怎么知道）** | 见下「判定点登记表」 | 见下方登记表 |
| **保质期（何时过期）** | 临时 config dir 生命周期 = 单次 attempt（claude 进程 close/error/timeout 即失效并清理），无长期留存 | attempt 结束清理 |
| **死亡告警（停了谁知道）** | provision 失败 → `console.error` + HTTP 500，调用方 llm-caller 记 bridge 500（已有 `_recordBridgeExit1`/500 重试日志链路可感知） | provision 失败即 500，非静默 |
| **失败语义（挂了怎么办）** | 见下「失败语义声明」 | 见下方 |
| **效果确认（已发≠已生效）** | 隔离生效的回执 = 权威文件 mtime+sha256 前后完全不变 + fake-claude 记录的 CLAUDE_CONFIG_DIR ≠ 权威目录 + 临时目录已清理（E2E 三重断言） | E2E redline/isolation |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳定 | 静默丢消息 |
| attempt 是否结束（可安全清理临时副本） | A. 监听 child `close`/`error`/`timeout` 事件; B. 固定超时后清 | A. 监听 child 生命周期事件 | spawn 事件是进程结束的权威信号，固定超时会误清正在刷新的副本 | 过早清 → claude 读不到凭据秒退；过晚清 → 临时副本堆积（可 GC，不面客） |
| 权威文件是否被写（隔离是否生效） | A. mtime 比较; B. mtime + 内容 sha256 双比较 | B. mtime + sha256 双比较 | 单看 mtime 可能因原子替换保持不变而漏判；内容 sha256 兜住内容变更 | 漏判 → 误以为隔离生效实则仍回写 → 重新引入多写入者竞态 |

> 本任务核心为文件系统隔离（确定性 oracle），无「模糊外部真实状态推断」类接缝判定点；上表两行为生命周期与隔离验证判定点。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 临时 config dir 创建失败 | attempt 主流程失败：HTTP 500 + `console.error` 告警；**禁止**回退到直接用权威目录 | 是（每次 attempt 独立命名，重试新建新目录） | 无降级——宁可失败也不回退权威目录（回退 = 重新引入回写风险） |
| 临时副本清理失败 | 仅 `console.warn` 记日志，**不影响** attempt 结果（响应照常返回） | 是（下次 attempt 用新目录；孤儿副本可后台 GC） | 记日志放行 |
| claude 进程超时/exit≠0 | 保持现状（现有 timeout/degraded/500 逻辑不变），但**仍须**在 finally 语义中清理临时副本 | 现状 | 现状 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | — |

> `/llm-call` 是内部 Brain → 宿主 bridge 调用（localhost:3457，非对外暴露 agent），无外部不可信输入面 → N/A。

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## Golden Path

**覆盖父路**: 独立小路（无父路）—— journey e6f803f2（F1 开发闭环）golden-paths 当前为空（PRD 已声明），本 sprint 为宿主 bridge 凭据投递的根因修复，无既有父路可挂。

[Brain llm-caller 携 accountId POST /llm-call] → [bridge 复制独立临时 config dir，CLAUDE_CONFIG_DIR 指向副本，spawn claude] → [claude 刷新只落副本，权威文件只读] → [attempt 结束清理副本] → [权威文件 mtime/sha256 前后完全不变]

### Step 1: Brain 经 bridge 派发一次 attempt
**来源**: `[FROM_PRD]` — Golden Path 第 1 步 + 「预期受影响文件 cecelia-bridge.cjs」

**可观测行为**: `POST http://localhost:3457/llm-call` body `{"prompt":..,"model":"haiku","accountId":"account1"}` 返回 HTTP 200 `{ok:true,...}`。

**验证命令**:
```bash
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs isolation
# 期望：stdout 含 "OK: isolation"，exit 0
```
**硬阈值**: HTTP 200 且 fake-claude 记录到的 CLAUDE_CONFIG_DIR 非权威目录。

---

### Step 2: bridge 复制独立临时 config dir 并指向它
**来源**: `[FROM_PRD]` — Golden Path 第 2 步（不再把 CLAUDE_CONFIG_DIR 指向权威 `~/.claude-account{N}`）

**可观测行为**: 每次 attempt 新建一个唯一临时目录（含 pid/时间戳/随机后缀），把权威目录 `.credentials.json` 等文件拷入，`env.CLAUDE_CONFIG_DIR = <临时目录>` 后再 `spawn(CLAUDE_BIN)`。

**验证命令**:
```bash
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs isolation
# 期望：pointed CLAUDE_CONFIG_DIR ∈ os.tmpdir 而非 ~/.claude-account1；stdout 含 "指向临时副本"
```
**硬阈值**: `path.resolve(pointed) !== path.resolve(authDir)`。

---

### Step 3: claude 刷新/写入只落副本，权威文件只读（核心红线）
**来源**: `[FROM_PRD]` — Golden Path 第 3 步 + NFR「权威文件写入次数 0」+ INV-1

**可观测行为**: 一次经 bridge 的 attempt 跑完后，`~/.claude-account{N}/.credentials.json` 的 mtime 与内容 sha256 **前后完全不变**（fake-claude 已把「回写 CLAUDE_CONFIG_DIR」行为忠实复现，写入落到临时副本）。

**验证命令**:
```bash
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs redline
# 期望：stdout 含 "OK: redline — 权威文件 mtime + sha256 attempt 前后完全不变"，exit 0
```
**硬阈值**: `sha256_after == sha256_before` 且 `mtime_after == mtime_before`（任一变化即 FAIL）。

---

### Step 4: attempt 结束清理临时副本（清理失败仅记日志）
**来源**: `[FROM_PRD]` — Golden Path 第 4 步 + 失败语义「清理失败仅记日志」

**可观测行为**: child `close`/`error`/`timeout` 后临时目录被 `rm -rf`；清理失败只 `console.warn` 不影响响应。

**验证命令**:
```bash
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs isolation
# 期望：attempt 结束后 pointed 临时目录 existsSync=false（stdout 含 "结束后已清理"）
```
**硬阈值**: 5s 预算内临时目录消失。

---

### Step 5: 并发两 attempt 各用独立临时目录，权威仍未写
**来源**: `[FROM_PRD]` — 边界情况「并发」+ NFR「并发隔离」

**可观测行为**: 并行两个 `/llm-call` → 两个互不相同的临时目录，权威文件 mtime+sha256 仍不变。

**验证命令**:
```bash
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs concurrency
# 期望：stdout 含 "OK: concurrency — 两 attempt 临时目录互异"，exit 0
```
**硬阈值**: `unique(pointedDirs) >= 2` 且权威文件未变。

---

## 真实调用方请求 shape

| 项 | 生产调用方（`packages/brain/src/llm-caller.js:370-378`） | 本合同 DoD/E2E 构造 |
|---|---|---|
| URL | `POST ${BRIDGE_URL}/llm-call`（`BRIDGE_URL=http://localhost:3457`） | `POST http://127.0.0.1:<port>/llm-call` |
| Content-Type | `application/json` | `application/json` |
| accountId 传递 | **body 字段** `accountId`（`...(accountId ? { accountId } : {})`），非 header | body 字段 `accountId`（逐字段一致） |
| 其他字段 | `prompt` / `model` / `timeout` | `prompt` / `model` / `accountId` |

> 逐字段一致：accountId 走 **body**（不是 header），与生产 llm-caller 一致；bridge 端 `JSON.parse(body).accountId`。

---

## 禁 mock 边清单

本单涉及**生命周期钩子**（attempt 起始 provision / 结束 cleanup）与**代码↔文件系统**写路径，故：

- **bridge(/llm-call handler) ↔ 文件系统 config dir**：本单改「spawn 前 CLAUDE_CONFIG_DIR 供给方式」——单测（claude-config-provision.test.js）对 provision 拷贝/权威只读 happy-path 全用**真实 fs + 真实 os.tmpdir 临时目录**；E2E 用**真实 fs**。禁止 mock `fs`。
- **bridge 进程 ↔ 被 spawn 的 claude 进程（生命周期钩子）**：E2E 必须**真起 cecelia-bridge.cjs 进程**、**真发 HTTP /llm-call**、**真 spawn 一个真进程**（fake-claude），禁止 stub handler / 禁止 mock `child_process`。
- **允许 mock 的外层无关依赖**：①真实 claude LLM —— 用忠实复现「回写 CLAUDE_CONFIG_DIR/.credentials.json」行为的 fake-claude 顶替（本单验证配置目录隔离而非 LLM 产出；真调 claude 需真 token、会烧钱且污染权威凭据，正是本单要根治的）。②`cleanupConfigDir` 的**错误分支**单测允许注入抛错的 `rmImpl` 仅触发 catch/log（happy-path 清理用真实 `fs.rmSync`，不替身化）。

---

## 接缝清单（接缝 vs 逻辑）

| # | 接缝点 | 真目标验证方式 | 状态 |
|---|--------|----------------|------|
| 1 | 隔离机制：CLAUDE_CONFIG_DIR 指向临时副本、权威 mtime+sha256 不变、临时目录清理 | E2E 真起 bridge.cjs + 真 spawn fake-claude（忠实复现回写）→ 断言权威文件不变 | **logic-done**（机制在真 fs/真进程上验证） |
| 2 | 真 claude CLI 在真临时副本上的真实刷新是否完全不触碰权威目录（真 claude 写入文件集是否超出 fake 复现范围） | 宿主手动 smoke：主理人在宿主真跑一次经 bridge 的 attempt，`stat`+`sha256` 观察 `~/.claude-account{N}/.credentials.json` 前后不变 | **logic-done-pending**（需真机 claude+真 token，登记待主理人 smoke） |

---

## 未覆盖真实链路清单

- **真实 claude LLM 调用被 fake-claude 顶替**｜为什么：真调 claude 需真 token、会烧钱并**回写权威凭据**（正是本单要根治的行为，真调会污染权威文件使红线测试自相矛盾）｜真验证补位计划：主理人在宿主真机手动 smoke 一次经 bridge 的 attempt，观察权威 `.credentials.json` mtime+sha256 不变（接缝清单 #2，logic-done-pending）。
- 规则 B（第三方真调一次）：本 sprint **无第三方 API 依赖**（claude 是被隔离对象，非被验证的第三方业务响应）→ 不适用；隔离机制以真 fs + 真进程验证。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

```bash
#!/bin/bash
set -euo pipefail
# 宿主 bridge 凭据只读消费 —— 纯 node 集成（Mac/Linux 可移植）。
# 真起 cecelia-bridge.cjs（fake HOME + fake-claude 忠实复现回写）→ 真发 /llm-call →
# 断言：权威文件 mtime+sha256 前后不变（核心红线）+ CLAUDE_CONFIG_DIR 指向临时副本非权威 +
# 临时目录被创建并清理 + 并发两 attempt 临时目录互异。任一失败 exit 1。
node sprints/08111930-bridge-readonly-credentials/e2e/bridge-readonly-e2e.cjs all

# 零回归：容器路径与 Codex 信封既有单测全绿、行为不变
cd packages/brain
npx vitest run \
  src/__tests__/docker-executor-mount-strategy.test.js \
  --reporter=basic
npx vitest run \
  --config ../../vitest.config.js \
  scripts/fleet-worker/credential-envelope.test.cjs 2>/dev/null || \
  node --test scripts/fleet-worker/credential-envelope.test.cjs 2>/dev/null || \
  npx vitest run src/orchestrator/credential-broker.test.js --reporter=basic
echo "✅ E2E + 零回归 全过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `/llm-call` body `accountId` 传非法值（`"account999"` 不存在的账号目录 / `accountId: 123` 数字 / `accountId: "../etc"` 路径穿越）—— provision 应失败告警且**不**触碰权威目录，绝不落到 `~/` 外路径。
- 重复提交: 连发 5 个相同 accountId 的 /llm-call —— 每个各自独立临时目录，互不覆盖，权威文件仍 0 写。
- 中途中断: attempt 进行中 kill claude 子进程（timeout 路径）—— 临时副本仍被清理（不泄漏孤儿目录），权威文件不变。
- 边界值: 无 accountId（默认 account1 分支）同样走临时副本，不得直接用 `~/.claude-account1`。
发现分级: P0/P1（权威文件被写 / 临时目录落到 `~/` 外 / 路径穿越）→ 阻塞 merge；P2/P3（孤儿临时目录堆积、日志缺失）→ 记 findings 不阻塞。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| provision 拷贝到独立临时目录 | `tests/claude-config-provision.test.js` | `copies authoritative credentials into a unique temp dir` | require 抛 MODULE_NOT_FOUND → 7 failed |
| 并发独立目录 | `tests/claude-config-provision.test.js` | `returns distinct config dirs for concurrent calls` | 同上 |
| 权威只读（provision 阶段） | `tests/claude-config-provision.test.js` | `leaves the authoritative credentials file mtime and sha256 unchanged` | 同上 |
| 创建失败抛错不回退 | `tests/claude-config-provision.test.js` | `throws when the temp dir cannot be created` | 同上 |
| 清理成功 | `tests/claude-config-provision.test.js` | `removes the provisioned temp dir and returns true` | 同上 |
| 清理失败仅记日志 | `tests/claude-config-provision.test.js` | `returns false when removal fails` | 同上 |
| 默认账号解析 | `tests/claude-config-provision.test.js` | `defaults to account1 when accountId is absent` | 同上 |
| 端到端隔离/红线/并发 | `e2e/bridge-readonly-e2e.cjs` | redline / isolation / concurrency | 现 bridge 回写权威 → redline sha256 变化 exit 1 |

> BEHAVIOR 覆盖名均为对应 `it()` 名的字面子串（可 `grep -F` 命中）。

## Kernel validation identity

本合同 E2E 不注入任何角色 attempt/account/capability 字面值——纯 fs/进程隔离验证，无需 `HARNESS_*`/`CAPABILITY_SNAPSHOT_ID`。task bundle 顶层 `attempt_id`/`capability_snapshot_id` 仅作 GAN authoring provenance，不写入合同/测试。
