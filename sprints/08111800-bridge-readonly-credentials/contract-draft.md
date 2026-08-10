# Sprint Contract Draft (Round 1)

**journey_type**: agent_remote
**target_environment**: local_api
**contract-gate**: 存在 packages/brain/src/lib/contract-gate.js（cecelia worktree，正常执行代码层 gate）
**gp-anchor**: skipped (product-map.json not found)

> 锚定父路声明：**覆盖父路 e6f803f2（工厂·F1 开发闭环）· 步 3bf6c116（接单进车间即分档 — 动作=修复）**。
> 本 sprint 是该步下的宿主 bridge 凭据投递缺陷根因修复，无独立小路。

---

## Response Schema（推导来源: PRD字面 — bridge `/llm-call` 既有响应契约，本 sprint 不改字段）

### Endpoint: POST /llm-call（宿主 cecelia-bridge，端口 3457）
**Success (HTTP 200)**:
```json
{"ok": true, "text": "<string>", "model": "<string>", "elapsed_ms": 0}
```
- `ok` (boolean, 必填): 本 sprint 唯一被断言的字段——true = attempt 成功跑完；来源——现有 `/llm-call` 契约
- `text`/`model`/`elapsed_ms`: 既有字段，本 sprint 不改、不断言其值

**Failure (HTTP 500 或 200+degraded)**:
```json
{"ok": false, "error": "<string>", "elapsed_ms": 0}
```
- `ok` (boolean, 必填): false = 主流程失败（含临时目录创建失败）；来源——现有契约
- `error` (string): 失败原因文本

**禁用字段名**: 无（本 sprint 不新增/改名任何响应字段）
**说明**: 本 sprint 改的是**凭据投递的副作用**（权威文件是否被写），不改 HTTP 响应 schema；因此 oracle 落在「权威文件 mtime+sha256 不变」+「claude 子进程 CLAUDE_CONFIG_DIR 指向临时目录」等**进程/文件系统侧可观测量**，而非响应字段漂移。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [packages/brain/src/__tests__/docker-executor-mount-strategy.test.js] → 容器路径 `-v {hostDir}:/host-claude-config:ro` 只读挂载 + buildDockerArgs 行为（本 sprint 不得改动，零回归）
- [packages/brain/src/__tests__/dockerfile-config-copy.test.js] → entrypoint config-copy 语义（本 sprint 的临时副本复制对齐其做法，但不改容器文件）
- [packages/brain/src/__tests__/docker-executor.test.js] → docker executor 主路径（零回归）
- [packages/brain/scripts/fleet-worker/credential-envelope.test.cjs] → Codex `credential-envelope/v1` 消费方（本 sprint 不得改动，零回归）
- [packages/brain/src/__tests__/bridge-llm-timeout.test.js / bridge-timeout.test.js] → `/llm-call` timeout 行为（本 sprint 不改 timeout，须保持）

### 累积 FR（Step 1.3，来源 context-manifest）
- context-manifest: 本 line（journey e6f803f2）暂无已验收 golden_path 历史（PRD 累积 FR 段查得 ability 均为 planned 态）。无累积 FR 约束需继承。

### 历史铁律 → INV 映射（见 contract-dod.md INV 段）
- 铁律清单 4 条（单写入者 / 顺序不可颠倒 / 不碰让位 / 证据分流）已逐条映射为 contract-dod.md 的 INV-1..INV-4 条目。

---

## Golden Path

[bridge 收到 POST /llm-call（带 accountId）] → [为本 attempt 复制独立临时 config dir] → [spawn claude，CLAUDE_CONFIG_DIR 指向临时副本] → [claude 只读/写临时副本，权威文件零写入] → [attempt 结束清理临时副本]

### Step 1: bridge `/llm-call` 解析 accountId
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 点「bridge `/llm-call` 解析出 accountId（如 account1）」

**可观测行为**: bridge 收到带 `accountId` 的 POST /llm-call，解析出目标账号（无 accountId 时走默认 account1 路径）。

**验证命令**:
```bash
# 见 E2E 验收脚本 run_redline：bridge 起来后 /health 200 且 /llm-call 接受 accountId
curl -sf "http://127.0.0.1:$PORT/health" | jq -e '.ok == true'
```
**硬阈值**: /health 返回 200 且 `.ok==true`；/llm-call 接受含 accountId 的 body。

---

### Step 2: 为本 attempt 复制独立临时 config dir（核心变更）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点 + 「必须实现 第 1 步.1」：不再让 CLAUDE_CONFIG_DIR 指向权威 `~/.claude-account{N}`，改为按 attempt 创建独立临时 config dir（对齐 entrypoint.sh 从权威目录复制内容的做法）。

**可观测行为**: 每次 /llm-call spawn claude 前，helper 在 `os.tmpdir()` 下 `fs.mkdtemp` 一个独立目录，把权威目录内容复制进去（`.credentials.json` 为**真实副本，非 symlink 回权威**——与容器 entrypoint 对凭据做 symlink 不同，bridge 必须复制，否则 claude 写回穿透 symlink 命中权威文件）；spawn claude 时 `CLAUDE_CONFIG_DIR` 指向该临时目录。

**验证命令**:
```bash
# 见 E2E 验收脚本 run_wiring：stub claude 记录它收到的 CLAUDE_CONFIG_DIR
# 断言该目录 != 权威目录 AND 不在 $HOME/.claude-* 账号家族内（即落在 os.tmpdir 临时区）
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh wiring | grep -q 'OK\[wiring\]'
```
**硬阈值**: 子进程 CLAUDE_CONFIG_DIR 指向临时目录（非 `~/.claude-account{N}`）；临时目录含 `.credentials.json` 独立副本。

---

### Step 3: 权威文件零写入（核心红线）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点 + 「必须实现 第 1 步.3」+ NFR「权威文件整个 attempt 生命周期只读、零写入」+ Invariant「单写入者」。

**可观测行为**: 经 bridge 跑完一次 attempt 后，权威 `~/.claude-account{N}/.credentials.json` 的 mtime 与内容 sha256 **前后完全不变**；claude 的刷新回写全部落在临时副本。

**验证命令**:
```bash
# 见 E2E 验收脚本 run_redline：记录权威 .credentials.json mtime+sha256，跑完一次 /llm-call attempt 后断言不变
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh redline | grep -q 'OK\[redline\]'
```
**硬阈值**: 权威 `.credentials.json` mtime 不变 **且** sha256 不变；任一变化即判失败。

---

### Step 4: attempt 结束清理临时副本
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点「claude 退出后清理临时目录；清理失败记日志不影响主流程」+ 「必须实现 第 1 步.2」。

**可观测行为**: claude 子进程退出后，helper 清理该临时目录；清理失败仅记日志、不影响 /llm-call 结果。

**验证命令**:
```bash
# run_wiring 末尾断言临时目录已不存在；cleanup-fail 模式断言清理失败时不抛错
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh cleanup-fail | grep -q 'OK\[cleanup-fail\]'
```
**硬阈值**: attempt 结束后临时目录不存在；cleanup 在目标缺失时不抛异常。

---

### Step 5: 临时目录创建失败 → 主流程失败且不回退（防静默降级）
**来源**: `[AI_ADDED]` — 理由：PRD 边界情况明确「创建失败 → 主流程应失败并告警，不得静默降级回权威目录起 claude」。若无此断言，generator 可能用 try/catch 回退到权威目录「保可用性」，直接把缺陷改回原样（多写入者复活），故必须有一条把「回退」钉死为失败的验证。

**可观测行为**: 临时目录创建失败（如 TMPDIR 不可用）时，/llm-call 返回 `ok:false`（不成功），且**绝不**回退到权威目录起 claude；权威文件仍零写入。

**验证命令**:
```bash
# run_creation_fail：TMPDIR 指向不存在路径 → 临时目录创建失败；断言 ok!=true 且 sentinel 不含权威路径 且权威文件不变
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh creation-fail | grep -q 'OK\[creation-fail\]'
```
**硬阈值**: 响应 `ok` 非 true；claude 未被以权威目录为 CLAUDE_CONFIG_DIR spawn；权威 `.credentials.json` 不变。

---

### Step 6: 并发两 attempt 各用互不相同临时目录
**来源**: `[FROM_PRD]` — PRD 边界情况「并发：并行两个 bridge attempt，各自使用互不相同的临时目录，权威文件仍零写入」。

**可观测行为**: 并行两个 /llm-call，各自的临时 config dir 路径互不相同；权威文件零写入。

**验证命令**:
```bash
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh concurrency | grep -q 'OK\[concurrency\]'
```
**硬阈值**: 两 attempt 的临时目录 distinct 计数 ≥ 2；权威 `.credentials.json` 不变。

---

## 真实调用方请求 shape

- **真实调用方**: Brain `packages/brain/src/llm-caller.js`（L370-378）——`fetch(\`${BRIDGE_URL}/llm-call\`)`，`BRIDGE_URL=http://localhost:3457`。
- **认证方式**: 无鉴权 header（localhost 本机信任），`Content-Type: application/json`。
- **关键字段（逐字，camelCase）**: `{ prompt, model, timeout?, accountId?, image_base64?, image_mime? }`——`accountId` 为 camelCase，与 llm-caller.js L377 `...(accountId ? { accountId } : {})` 逐字段一致。
- **本合同 DoD/E2E 构造的请求逐字段对齐**: body 用 `accountId`（非 `account_id`/`account`），无 auth header，`Content-Type: application/json`——与生产调用方一致，无双路径分叉。
- **默认账号路径**: 无 accountId 时 bridge 走 `DEFAULT_CLAUDE_CONFIG_DIR`（默认 `~/.claude-account1`）；此路径同样必须走临时副本（PRD 边界情况第 4 条），不得直用权威目录。

---

## 未覆盖真实链路清单

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划 |
|---|---|---|---|
| 真实 `claude` CLI 的 token 刷新回写行为 | stub CLAUDE_BIN（bash 脚本，模拟向 `$CLAUDE_CONFIG_DIR/.credentials.json` 回写） | evaluator 环境不保证有真 claude 二进制，且用真权威账号跑有污染/失效风险 | stub 的回写方向与真 claude 一致（写 CLAUDE_CONFIG_DIR/.credentials.json）；真 claude 侧由主理人在 us-mac-m4 用**一个隔离备用账号**跑一次 bridge attempt 做接缝确认，标 `logic-done-pending` 直至真机确认 |
| 真实权威账号目录 `~/.claude-account{N}` | 隔离 HOME 下构造的假 `.claude-account1`（含 .credentials.json + settings.json） | 直接对真权威文件断言写入=零，若实现有缺陷会真损坏生产凭据 | 同上，接缝确认在隔离备用账号上做，不碰生产 account1/account2 |

（注：本 sprint 的 stub 替换属**接缝层不可避免的替身**，非逻辑造假——被测的隔离边界=「宿主 fs 复制/指向/清理」全部真实执行，只有 claude 进程本身被 stub。见「禁 mock 边清单」。）

---

## 禁 mock 边清单

本单改动涉及**生命周期钩子**（/llm-call spawn 前的临时目录准备 + spawn 后的清理）与 **fs 写路径**（config dir 复制/删除），故以下边**禁 mock**：

- **bridge 代码 ↔ 文件系统（临时 config dir 复制 / 清理）**：测试必须真 `fs.mkdtemp` / 真复制 / 真 `rm`，禁止 `vi.mock('fs')` 或 stub 掉复制/删除本身（`bridge-ephemeral-config.test.mjs` 全程真 fs）。
- **bridge ↔ claude 子进程 spawn 的 CLAUDE_CONFIG_DIR 环境传递**：集成断言必须真 `spawn` 一个真子进程（stub CLAUDE_BIN 是真进程，只是内容是替身），断言子进程**实际收到**的 CLAUDE_CONFIG_DIR 指向临时目录；禁止 mock `child_process.spawn` 来「假装」env 正确。
- **权威 `.credentials.json` ↔ attempt 生命周期**：真文件、真 mtime、真 sha256 前后比对，禁止用内存假对象替代权威文件。

允许 mock 的更外层：真 claude 二进制（见未覆盖清单，接缝替身）；claude 的网络/LLM 调用（与本隔离边界无关）。cleanup-fail 单测对「清理目标」做外部删除以触发真实删除失败，属真实故障注入而非 mock 被改的边。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 宿主 bridge `/llm-call` spawn claude 时，改为按 attempt 复制独立临时 config dir 并指向它，权威文件只读；attempt 结束清理临时副本 |
| **NFR（做得多好）** | | 权威文件整个 attempt 生命周期零写入（核心红线）；沿用现有 /llm-call timeout 不改；创建失败必告警、清理失败必记日志 |
| **Invariant（永不违反）** | | [单写入者] 权威凭据文件只有一个写入者（refresh-claude-tokens.sh），bridge 侧写入归零；[顺序不可颠倒] 先落地第 1 步才谈收窄让位；[不碰让位] 不改 infrastructure 仓库/不削弱让位逻辑 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | 临时 config dir 生命周期 = 单次 attempt；attempt 结束即退役（清理）。无长期 token/缓存产物 |
| **死亡告警（停了谁知道）** | | 临时目录创建失败 → /llm-call 返回 ok:false + console.error 告警（bridge.log），调用方 llm-caller 记 bridge exit；bridge 进程整体死由既有 bridge-keepalive-check.sh 兜底（本 sprint 不改） |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | | 每次 attempt 后以「权威文件 mtime+sha256 不变」+「子进程 CLAUDE_CONFIG_DIR 指向临时目录」双证据确认隔离真实生效，非「跑通即算」 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ 权威文件是否被写入（隔离是否真生效） | A. 比对 attempt 前后 mtime+sha256; B. 仅看 /llm-call 返回 ok | A（mtime+sha256 双量） | 仅看 ok 无法反映副作用；sha256 防 mtime 精度盲区 | 误判「隔离生效」放行→多写入者复活→refresh 让位→token 空窗→attempt 全体判死（正是本任务要根治的事故） |
| 临时目录创建是否失败 | A. helper throw 冒泡到 /llm-call ok:false; B. 静默 catch 回退权威目录 | A（throw，不回退） | 回退=把缺陷改回原样 | 误判「可用性优先」回退权威目录→隐蔽复活多写入者 |
| 临时目录是否已清理 | A. attempt 后 fs.existsSync 为假; B. 不检查 | A | 泄漏累积占满 tmp | 临时目录泄漏（非红线，记日志级别） |

> ⚠️ 行说明：「权威文件是否被写入」误判后果不可逆（可致账号 invalid_grant / 生产 attempt 批量判死），属升拍板级；PrepPRD 已把「mtime+sha256 双量断言」写死为核心红线（决策 4ce29c14 背书），无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 临时目录**创建**失败 | /llm-call 返回 ok:false + console.error 告警；**不 spawn claude、不回退权威目录** | 是（无副作用，调用方可重试） | **无降级到权威目录**——宁可本次失败也不复活多写入者 |
| 临时目录**清理**失败 | 仅 console.warn 记日志；/llm-call 结果不受影响（已拿到 claude 输出照常返回） | 是 | 泄漏的临时目录由 OS tmp 回收/后续兜底，不阻塞主流程 |
| claude 子进程失败/超时 | 沿用既有 /llm-call 失败/timeout 分支（本 sprint 不改） | 是 | 既有 degraded 响应 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | — |

> 本 sprint 不新增对外暴露 agent 输入面：/llm-call 是本机 Brain→bridge 内部调用（localhost，无鉴权按既有设计），accountId 仅用于拼本机目录名。N/A。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: agent_remote
**target_environment**: local_api

> 无 DB 依赖（runtime_resources.postgres=false）：本验收用真实 cecelia-bridge.cjs 进程 + 隔离 HOME + stub CLAUDE_BIN 子进程，断言权威文件零写入等进程/文件系统侧可观测量。全部逻辑封装在已提交的 `tests/bridge-readonly-e2e.sh`（bash -n 已过），evaluator 直接跑 `all`。

```bash
#!/bin/bash
set -euo pipefail
# 全段集成 + 单测：redline（核心红线）/ wiring / creation-fail（不回退）/ concurrency / cleanup-fail
bash sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh all
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: POST /llm-call 传 `accountId` 含路径穿越字符（如 `../account2`、`account1/../../etc`）——断言 bridge 不因 accountId 逃逸出 `$HOME/.claude-*` 家族、临时目录仍隔离、权威文件零写入
- 重复提交: 连发 3 次相同 /llm-call——断言每次独立临时目录、每次都清理、权威文件始终不变（无累积泄漏、无写入）
- 中途中断: /llm-call 处理中 kill claude 子进程（SIGTERM/timeout 路径）——断言临时目录仍被清理或至少权威文件零写入（清理失败仅记日志）
- 边界值: 无 accountId（默认账号路径）——断言默认路径同样走临时副本，不直用 `~/.claude-account1`
发现分级: P0/P1（权威文件被写 / 回退到权威目录 / accountId 路径穿越命中权威文件）→ 阻塞 merge；P2/P3（临时目录偶发泄漏未清理但权威零写入）→ 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| helper 隔离/复制/清理/失败语义 | `sprints/08111800-bridge-readonly-credentials/tests/bridge-ephemeral-config.test.mjs` | `创建独立临时目录且复制凭据`；`cleanup 删除临时目录`；`权威源目录缺失时抛错`；`临时目录创建失败时抛错`；`cleanup 在目标已被外部删除时不抛错` | helper 模块不存在 → `require` MODULE_NOT_FOUND，5 个 it 全红（已实测 `node -e require(...)` exit=1） |
| 权威文件零写入端到端 | `sprints/08111800-bridge-readonly-credentials/tests/bridge-readonly-e2e.sh` | redline / wiring / creation-fail / concurrency / cleanup-fail | 当前 bridge 直用权威目录 → redline/wiring/creation-fail/concurrency 全 FAIL |
| 零回归（容器 + Codex 信封路径） | `packages/brain/src/__tests__/docker-executor*.test.js` + `packages/brain/scripts/fleet-worker/credential-envelope.test.cjs` | 既有用例全绿、行为不变 | N/A（回归基线，须保持绿） |
