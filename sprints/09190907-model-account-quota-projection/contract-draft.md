# Sprint Contract Draft (Round 2) — 模型账号配额+机器可达性投影（工厂·F5 指挥舱 刀2）

> **Round 2 修订（回应 R1-1）**：补 PRD Golden Path 第4条「Notion 配额列」的 token-free 可执行 oracle——新增冻结测试 `describe('buildOpsUnitNotionProperties 配额列')` + DoD `B-08` + Step5 去 `|| echo` 兜底改硬断言 + Test Contract 补 Notion 行。真 Notion API 推送仍属 logic-done-pending（依赖 token）。净变化仅此一处漏覆盖，未扩 scope。

**锚定父路声明**：覆盖父路 `工厂 · F5 指挥舱`（journey 8bb8252f-29b4-4c34-acb9-1accda7ddfcf）刀1 只读投影之上追加「账号维度」子路（thin feature 01c792d9，PrepPRD 未锚定具体 step）。属父路延伸，非独立小路。

**runtime 约束（决定测试形态）**：本 attempt `runtime_resources.postgres=false`（Fleet 不注入 DB，实测 psql 连接被拒），`node_deps=true`。故冻结合同测试全部为**纯函数 + capturing 假 pool**（沿用刀1 `agent-ops.test.js` / `ops-collector.test.js` 既定 idiom，仓库根 vitest 即可跑，无需 Postgres）；真 PG 落库端到端登记进「未覆盖真实链路清单」，由 CI + generator 首次真跑覆盖。

**MAP_NOT_CONFIGURED**：`task.payload.map_repo` 缺失，Unified Map 未配置；scope 锚定仅依据 PrepPRD，environment 由后端路径推断。

---

## Response Schema（推导来源：api_registry 推导 + [NEW_PATTERN]）

api_registry 现有 agent-ops 端点统一走 `handle()` 包装 → `{ success: true, data: {...} }`（见 `routes/agent-ops.js:186`）。新端点字面复用该外壳。

### Endpoint: GET /api/brain/agent-ops/model-accounts

**Success (HTTP 200)**：
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "provider": "claude|codex|grok",
        "account_key": "account1",
        "plan": "max",
        "five_hour_pct": 42,
        "seven_day_pct": 60,
        "reset_at": "2026-09-19T10:00:00.000Z",
        "host_alias": "mmv",
        "forwardable": false,
        "forward_targets": [],
        "status": "ok|unknown|key_expired|no_credential",
        "last_checked_at": "2026-09-19T08:00:00.000Z",
        "last_error": null
      }
    ],
    "server_now": "2026-09-19T12:00:00.000Z"
  }
}
```
- `accounts` (array, 必填，长度 8): 来源——PRD 明确（8 账号）
- `accounts[].provider` (string enum claude/codex/grok, 必填): PRD 明确
- `accounts[].account_key` (string, 必填): [NEW_PATTERN]，账号标识（account1/account2/team1..team5/grok）
- `accounts[].plan` (string, 必填): PRD 明确
- `accounts[].five_hour_pct` / `seven_day_pct` (number 0-100 或 null, 必填): PRD 明确；采不到=null（禁编造）
- `accounts[].reset_at` (ISO string 或 null, 必填): PRD 明确
- `accounts[].host_alias` (string, 必填): PRD 明确（凭据所在机器，当前 mmv）
- `accounts[].forwardable` (boolean, 必填): PRD 明确（静态配置）
- `accounts[].forward_targets` (string[], 必填): PRD 明确（Codex→['xian-m4','xian-m1']；其余 []）
- `accounts[].status` (string enum, 必填): PRD 明确（ok/unknown/key_expired/no_credential）
- `accounts[].last_checked_at` (ISO string 或 null, 必填): PRD 明确
- `accounts[].last_error` (string 或 null, 必填): PRD 明确（失败原因透出）
- `server_now` (ISO string, 必填): 对齐刀1 各端点 `server_now`（api_registry 推导）

**禁用字段名**（PRD 判定点·主理人拍板「不造分层标签」+ 命名漂移防护）：`tier`、`level`、`layer`、`capability_tier`（model_role 禁造能力分层）；`usage`、`pct5h`、`quota`（five_hour_pct 命名漂移）；`vendor`（provider 命名漂移）。

**Error (状态语义)**：
- 单账号失败：**不报 HTTP 错**，该条 `status` 置 unknown/key_expired/no_credential + `last_error`，其余账号照常，整体 HTTP 200。
- 表未迁移（42P01）：HTTP 503 `{success:false, error:{code:"migration_pending"}}`（对齐刀1 `handle()`，禁 200 空数组）。

### Endpoint: GET /api/brain/agent-ops/agents（刀1 端点·追加字段）

`data.agents[i]` 追加：
```json
{ "model_role": { "model": "openai/gpt-5.6-terra", "primary_count": 2, "fallback_count": 1 } }
```
- `model_role.model` (string 或 null): 原始 model id（PRD 明确，不造标签）
- `model_role.primary_count` (number): 全局有几个分身把该 model 设为 primary（真实计数）
- `model_role.fallback_count` (number): 全局有几个分身把该 model 设为 fallback（真实计数）
- model_role **只有这三个键**（无 tier/level/layer）。

---

## 已知约束

### 来自回归测试（刀1，`routes/__tests__/agent-ops.test.js` / `__tests__/ops-collector.test.js`）
- [agent-ops.test.js] `buildAgentsPayload`：per-source freshness、42P01→migration_pending、source_status 非 ok 即 stale ——本 sprint 给 agents 追加 model_role **不得破坏** 上述现有断言。
- [ops-collector.test.js] `runOpsCollector`：OpenClaw 写死容器内路径、per-source 隔离、0 行=parse_error、凭据白名单（`JSON.stringify(rows)` 不含 SECRET）——本 sprint 扩 `extractOpenclawAgents` 捕获 model_fallbacks **不得回退** 凭据白名单铁律。

### 累积 FR（`context-manifest` 端点不可达，取自 PRD 刀1 记录）
- [累积FR] 刀1 `agent_ops_agents` 只读投影已上线：`ops-collector.js` 采三表 → GET /agent-ops/{agents,calendar,graph} → notion-push-sync 两库。本 sprint 追加维度不得回退/重复该行为。
- `context-manifest: unavailable`（journey golden-paths API 返空，同 PRD 记录）。

### 铁律清单 → Invariant 覆盖映射（PRD Invariant 段逐条）
- INV-1 [不碰refresh_token]：collector 任何路径绝不调用/刷新 refresh_token → DoD B-03 + INV-1（静态断言 collector 源码无 refresh_token 调用路径 + parseGrokUsage 纯函数无 refresh 字段）。
- INV-2 [不阻塞]：单账号失败只标 status+last_error，其余正常，HTTP 200 → DoD B-02。
- INV-3 [不造标签]：model_role 只出原始 model id + 真实计数 → DoD B-04（model_role 键集恰为 {model,primary_count,fallback_count}）。
- INV-4 [只观测]：本 sprint 只产出可观测数据，无派单/选模型决策 → N/A 断言：合同不含任何写决策/派单端点；scope 仅只读端点 + 采集表 + parser。
- INV-5 [凭据隔离]：读账号资源用其本人 token，禁混用 → 由 collector 逐账号读各自 `~/.claude-account{1,2}` / `~/.codex-team{n}` / `~/.grok` 凭据保证；测试断言凭据白名单不外泄（extractOpenclawAgents SECRET 断言）。

---

## Golden Path

[主理人调运行舱 API] → [collector ssh 逃逸 mmv 读凭据 → 三家 parser 归一 → 写快照表] → [看到 8 账号配额 + agents model_role + Notion 配额列]

### Step 1: 主理人调 `GET /api/brain/agent-ops/model-accounts`
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（L18）

**可观测行为**: 返回 8 条模型账号配额快照，每条含 provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error。

**验证命令**（postgres:false → 用只读投影纯函数验；DB 就绪时另有 live curl，见 E2E 可选段）:
```bash
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "返回全部 8 条且每条字段齐全"
```
**硬阈值**: accounts 长度 == 8，每条 11 个必填字段齐全。

---

### Step 2: 系统侧 collector 采集账号配额（ssh 逃逸 mmv + 三家 parser + 逐账号隔离 + 写表）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（L19）+ 边界情况（L27-29）

**可观测行为**: collector 沿用刀1 `ops-collector.js` scheduler 框架（5min 自 gate），逐账号 ssh 到 mmv 读各自凭据、三家 provider-specific parser 归一到同一 schema、单账号失败只标 status+last_error 不阻塞、写入 `ops_model_accounts` 表。

**验证命令**:
```bash
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "单账号 fetch 抛错"
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "INSERT INTO ops_model_accounts"
```
**硬阈值**: 单账号抛错时该条 status=unknown+last_error 且其余账号正常；每账号发一条 `INSERT INTO ops_model_accounts ... ON CONFLICT` 幂等 upsert。

---

### Step 3: Grok key 过期只标 key_expired，绝不触碰 refresh_token（proven-to-fire）
**来源**: `[FROM_PRD]` — PRD 边界（L28）+ Invariant INV-1（主理人拍板）
**理由标注**: `[AI_ADDED]` 补一条静态源码断言（防止 generator 引入任何 refresh 调用路径），理由：脚本刷新 refresh_token = 整条链被撤销，只能人工 device-auth，属不可逆事故。

**可观测行为**: Grok gRPC-web 返回 grpc-status 7 PERMISSION_DENIED → parseGrokUsage 返回 status=key_expired；collector 源码任何路径无 refresh_token/device-auth 调用。

**验证命令**:
```bash
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "key_expired"
! grep -nE 'refresh[_-]?token|refreshToken|device-auth' packages/brain/src/ops-model-accounts-collector.js
```
**硬阈值**: parseGrokUsage(grpc_status:7) → status=key_expired；collector 源码 grep refresh_token/device-auth 命中 0 处。

---

### Step 4: 主理人调 `GET /api/brain/agent-ops/agents` → 每条含 model_role
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（L20）

**可观测行为**: agents 端点每条追加 model_role（原始 model id + 该 model 全局 primary/fallback 真实计数），不造分层标签。

**验证命令**:
```bash
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "model_role"
```
**硬阈值**: 每条 agent.model_role 键集恰为 {model, primary_count, fallback_count}；计数与分身配置一致。

---

### Step 5: Notion「Agents&机器」库对应行出现 5h%/7d%/更新时间列
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（L21）

**可观测行为**: `buildOpsUnitNotionProperties`（`notion-push-sync.js:1122`）对有配额数据的 agent 行追加 5h%/7d%/更新时间 Notion 属性（契约固定属性名 `Quota5h`/`Quota7d`/`QuotaUpdatedAt`），随现有 notion-push-sync 推送（不新开同步管道）；无配额的行不产出这三列（不误填 0）。

**验证命令**（Notion 真推送依赖 token，本地不可跑 → 验 properties builder 纯函数产出对应列；**硬断言驱动 exit code，无兜底吞错**）:
```bash
npx vitest run sprints/09190907-model-account-quota-projection/tests/ --no-cache -t "Notion"
```
**硬阈值**: buildOpsUnitNotionProperties 对含配额的行产出 `Quota5h`(number)/`Quota7d`(number)/`QuotaUpdatedAt`(date) 三属性，无配额时不产出（见 DoD **B-08**）。真 Notion 推送验证登记进未覆盖真实链路清单（依赖 token，logic-done-pending）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | 新增只读端点 GET /agent-ops/model-accounts（8 账号配额快照）；agents 端点追加 model_role；账号级快照表 ops_model_accounts + collector（三家可单测 parser）；Notion「Agents&机器」加配额列 |
| **NFR（做得多好）** | | collector 5min 周期自 gate + 单账号查询超时保护；端点单账号失败不阻塞、始终 HTTP 200；三家 parser 为可单测纯函数 |
| **Invariant（永不违反）** | | 见「铁律映射」INV-1~5：不碰 refresh_token / 不阻塞 / 不造标签 / 只观测 / 凭据隔离 |
| **判定点（怎么知道）** | | 见下方登记表（账号 status 判定） |
| **保质期（何时过期）** | | 配额快照 5min 刷新；stale 判定沿用刀1 `STALE_FACTOR*INTERVAL_MS`；Grok key 约月周期过期（人工 device-auth 续） |
| **死亡告警（停了谁知道）** | | collector 失败写 `ops_source_heartbeats`（source=model_accounts）source_status+last_error，沿用刀1 心跳机制；端点 stale 透出 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明（放行/拦截/幂等） |
| **效果确认（已发≠已生效）** | | 端点回读快照表 last_checked_at + status；单账号失败可见 last_error；表未迁移 503 而非假绿 |

### 判定点登记表（对模糊现实的判断假设 — 主理人已拍板）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 聊天记录 API 不稳定 | 静默丢消息 |
| ⚠️ 账号是否「配额可用/失败/key过期/无凭据」 | A. 仅看 HTTP 200; B. 按 provider 错误分型（超时/token过期→unknown、grpc-status 7→key_expired、ENOENT/损坏→no_credential、其余→ok+pct） | B. 错误分型（classifyAccountStatus 纯函数） | 三家错误结构不同，单看 200 会把限流/过期误判为可用 | 误判「可用」→ 主理人据此派活撞满额/撞过期账号（面客链路延误）；故标 ⚠️ |
| Grok gRPC-web 帧是否 key 过期 | A. 解 grpc-status 7 PERMISSION_DENIED; B. 试刷新看是否恢复 | A（只读判定，绝不刷新） | B 会触碰 refresh_token=不可逆事故 | 误刷新→整条链撤销，只能人工 device-auth |
| forwardable 能否借道转发 | A. 静态配置表; B. 实时网络探测 | A（静态） | 转发是代码能力非网络状态，误判后果轻 | 静态表过期→显示可转发但实际不通（轻，可人工纠） |

> `judgment-pending-user`: 无（上述判定点主理人 PrepPRD 已拍板，见 PRD 判定点段）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 单账号 ssh/token/超时失败 | 该条 status=unknown+last_error，其余账号照常 | 是（下轮 5min 重采覆盖，upsert 幂等键=(provider,account_key)） | 端点仍 HTTP 200，主理人据 status 判断 |
| Grok key 过期 | status=key_expired，**不刷新** | 是（幂等，只读） | 人工 grok login --device-auth |
| Codex auth.json 缺失/损坏 | status=no_credential | 是 | 人工补凭据 |
| ops_model_accounts 表未迁移 | 端点 503 migration_pending | 是 | 跑迁移，禁 200 空数组假绿 |
| collector 整体 ssh 到 mmv 不可达 | 写心跳 source_status=unreachable+last_error | 是 | 端点透出 stale，禁假数据 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A | — | — | — |

> 本端点为**内部只读投影**（无对外暴露 agent、无用户可写入参数、无 LLM 消费外部内容），N/A。唯一敏感面为读 mmv 凭据——由 INV-5 凭据隔离 + 凭据白名单（不落盘、不入库、不入 API 响应）约束，非输入对抗面。

---

## 禁 mock 边清单

本单涉及「DB 写路径（新表 ops_model_accounts upsert）」「跨模块数据传递（collector → 三家 parser → upsert）」，逐条列禁 mock 的边：

- **collector ↔ 三家 parser**（本单新增该数据流）：测试**不 mock parser**——`collectAccountSnapshots` 直调真实 parser 逻辑，仅注入最外层 `fetchUsage`（ssh 逃逸边界，规则允许「mock 更外层无关依赖」）。断言 parser 归一输出经 collector 落到快照。
- **collector ↔ ops_model_accounts DB 写**（本单新增写路径）：`writeModelAccountsSnapshot` 用 capturing 假 pool 断言**真实 `INSERT INTO ops_model_accounts ... ON CONFLICT` SQL 与逐账号 params**（沿用刀1 `ops-collector.test.js` 同 module 既定 idiom，已过刀1 GAN）。**说明**：本 attempt `runtime_resources.postgres=false`（bundle 硬约束，实测 psql 连接被拒），冻结测试无法起真 PG；真 PG 落库端到端登记进「未覆盖真实链路清单」，由 CI brain-integration + generator 首次真跑覆盖。此非规避——是 postgres:false 运行时约束下、与刀1 一致的既定做法，透明呈现。
- **agents model_role 聚合 ↔ ops_agents rows**（本单新增聚合）：`attachModelRoles` / `buildModelAccountsPayload` 只读投影用 `poolReturning` 假 pool 喂**真实 fixture rows**（与刀1 `buildAgentsPayload` 测试同 idiom），投影计算逻辑不 mock。

---

## 未覆盖真实链路清单

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划（谁/何时/什么环境） |
|-----------|-----------|--------|--------------------------------|
| 真 Postgres 落库 & live GET /model-accounts 端到端 | capturing 假 pool + 纯函数投影 | 本 attempt postgres:false（Fleet 不注入 DB） | generator：跑迁移后 CI brain-integration（真 PG）+ E2E 可选段（DB_URL 就绪时 live curl）；logic-done-pending |
| 三家 usage API 真实 payload 字段名（Anthropic oauth/usage、ChatGPT wham、Grok gRPC-web 帧） | [NEW_PATTERN] 代表性 fixture 验归一化契约 | 凭据在 mmv、参考实现 `~/.claude-account2/skills/llm-quota/SKILL.md` 不在本仓，合同阶段不可得真实 shape | generator：参照 SKILL.md 落地字段提取 + 首次真跑对齐真实字段；接缝 logic-done-pending |
| ssh 逃逸到 mmv 读真实凭据 | 测试注入 fake `fetchUsage`/exec（外层边界） | CI 无 mmv 访问权、且禁凭据落 CI | 生产 collector 沿用刀1 host-exec ssh 模式真读；logic-done-pending |
| Notion「Agents&机器」真推送出现配额列 | properties builder 纯函数产出断言 | 真推送依赖 Notion token，本地/CI 不注入 | generator/运维：token 就绪环境验真推送；logic-done-pending |

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 真实调用方请求 shape

N/A — 本端点无外部设备/agent 调用方（内部只读投影，主理人/Commander 脚本 GET 无 body、无认证字段分叉）。collector 侧为**主动出站** ssh 读凭据，非被调；其真实调用形态（ssh 逃逸到 mmv 读 `~/.claude-account{1,2}/.credentials.json`、`~/.codex-team{1..5}/auth.json`、`~/.grok/auth.json`）沿用刀1 `ops-collector.js` 已验证的 host-exec 模式（见 `ops-collector.js:245/448/673`）。

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串） | 预期红证据 |
|---|---|---|---|
| 三家 parser 归一 | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 映射 5h/7d 利用率到 pct、映射 wham 用量到统一 pct schema、正常帧解出 pct、pct 超界 clamp | 模块不存在 → import 失败 → 全红 |
| 账号 status 判定 | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | token 过期/超时 → unknown、凭据文件缺失/损坏 → no_credential、grok PERMISSION_DENIED → key_expired | 同上 |
| 逐账号失败隔离 | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 单账号 fetch 抛错、每条快照字段齐全 | 同上 |
| DB 写 upsert | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 对每个账号发 INSERT INTO ops_model_accounts | 同上 |
| 只读投影端点 | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 返回全部 8 条且每条字段齐全、单账号 status=unknown、表缺失 42P01 | 同上 |
| model_role 聚合 | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 每条 agent 追加 model_role、不造分层标签 | 同上 |
| collector 捕获 fallbacks | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | meta.model=primary 且 meta.model_fallbacks=fallbacks | 同上 |
| Notion 配额列（PRD 第4条） | `sprints/09190907-model-account-quota-projection/tests/model-account-quota.test.ts` | 5h%/7d%/更新时间三个 Notion 属性、无配额数据的行不产出这三列 | 同上（import buildOpsUnitNotionProperties 成功但列缺失 → RED） |

> 补充（非冻结、brain-integration CI 跑真 PG）：generator 落地时可在 `packages/brain/src/__tests__/integration/*.pg.integration.test.js` 补真 PG 落库测试覆盖写边（postgres:false 下本 attempt 不跑）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，postgres:false 适配）

**journey_type**: autonomous
**target_environment**: local_api

> 本 attempt postgres:false：核心验收面（三家 parser / 状态判定 / 采集隔离 / upsert SQL / 只读投影 / model_role）全部为纯函数 + capturing 假 pool，从仓库根 vitest 跑，无需 Postgres。真 PG 端到端为可选加强段（DB_URL 就绪时执行；否则由 CI brain-integration 覆盖，已登记未覆盖清单）。全段单 bash 块。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_DIR="sprints/09190907-model-account-quota-projection"

# 1) 核心冻结测试（纯函数 + 假 pool；postgres:false 亦可跑，驱动 exit code）
npx vitest run "$SPRINT_DIR/tests/" --no-cache --reporter=verbose

# 2) 铁律 proven-to-fire：collector 源码任何路径不得调用/刷新 refresh_token 或 device-auth
COLLECTOR="packages/brain/src/ops-model-accounts-collector.js"
test -f "$COLLECTOR" || { echo "FAIL: collector 未实现 $COLLECTOR"; exit 1; }
if grep -nE 'refresh[_-]?token|refreshToken|device-auth' "$COLLECTOR"; then
  echo "FAIL: collector 出现 refresh_token/device-auth 调用路径（INV-1 禁止）"; exit 1
fi
echo "OK: collector 无 refresh_token 调用路径"

# 3) [ARTIFACT] 迁移文件 + 路由挂载存在
ls packages/brain/migrations/ | grep -qE 'ops_model_accounts' || { echo "FAIL: 缺 ops_model_accounts 迁移文件"; exit 1; }
grep -q 'model-accounts' packages/brain/src/routes/agent-ops.js || { echo "FAIL: agent-ops 路由未挂 model-accounts"; exit 1; }
echo "OK: 迁移与路由挂载就位"

# 4) 可选真 PG 端到端（仅 Fleet 注入 DB_URL 时；本 attempt postgres:false 默认走 else，核心面已由 1-3 验过）
if [ -n "${DB_URL:-}" ]; then
  export DATABASE_URL="$DB_URL"
  ( node packages/brain/scripts/run-migrations.mjs || node packages/brain/migrate.js ) 2>/dev/null || true
  psql "$DB_URL" -tAc "SELECT to_regclass('ops_model_accounts') IS NOT NULL" | grep -qx t || { echo "FAIL: ops_model_accounts 表未建"; exit 1; }
  echo "OK: 真 PG 表就绪"
else
  echo "SKIP-REGISTERED: postgres:false，真 PG 端到端由 CI brain-integration 覆盖（核心验收已由步骤 1-3 通过，非静默跳过）"
fi

echo "OK: Golden Path 可验收面全过"
```

**通过标准**: 脚本 exit 0（步骤 1-3 恒执行并驱动退出码；步骤 4 为可选加强）。

gate-allow: cheat/or-true 步骤4 迁移 runner 命令名跨仓不定用 `( ... ) 2>/dev/null || true` 容错，其失败不判绿——紧随的 `psql ... to_regclass('ops_model_accounts')` 才是真断言并驱动 exit；且此段仅在 DB_URL 注入时执行（本 attempt postgres:false 不触发）。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: parser 收到半截/非 JSON/字段类型错的 provider payload（如 five_hour.utilization 为字符串"abc"或 >1）→ 应返回 null/clamp，不抛
- 重复提交: collector 5min 内二次触发 → 应自 gate skipped（沿用刀1 lastRunAt）
- 中途中断: collector 采到第 4 个账号时 ssh 断 → 前 3 条已写、该条+其余标 unknown，不整体回滚
- 边界值: 8 账号全部失败 → 端点仍 HTTP 200 返 8 条全 status≠ok（不整体 500）；model_role 计数在 model 全为 null 时不崩
发现分级: P0/P1（误标账号可用致派单撞额、任何 refresh_token 调用路径、凭据泄漏进响应/日志）→ 阻塞 merge；P2/P3（列展示/命名）→ 记 findings 不阻塞

---

## Contract Gate

contract-gate: present（cecelia repo，`packages/brain/src/lib/contract-gate.js` 存在）——合同 [BEHAVIOR]/E2E 断言按 gate 惯用法：curl 带 -f 或捕获后 jq -e 断言、DB 计数带时间窗、负向测试用 `! grep` 显式、无裸 `|| true` 吞错。
