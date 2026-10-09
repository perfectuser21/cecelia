# Sprint Contract Draft (Round 1) — 模型账号配额+机器可达性投影（刀2）

**journey_type**: autonomous
**target_environment**: local_api
**DB**: `${DB_URL:-postgresql://localhost/cecelia}`（cecelia 仓；contract-gate 存在，本仓规则生效）

## 锚定父路声明

覆盖父路 `工厂 · F5 指挥舱`（journey_id 8bb8252f-29b4-4c34-acb9-1accda7ddfcf）刀2 —— 在刀1 只读投影（PR#5161：agents/calendar/graph）基础上追加「模型账号配额+机器可达性」维度。本 sprint 为该父路的增量步骤（新端点 + agents 字段扩展），无独立 GP id（cecelia 仓无 product-map）。

---

## Response Schema（推导来源: PRD 字面 + api_registry 现有 agent-ops 端点惯例）

现有 `/api/brain/agent-ops/*` 端点（agent-ops.js `handle()`）统一封装 `{ success: true, data: <builder 返回> }`，builder 返回「数组字段 + 元数据」对象（如 `buildAgentsPayload` 返回 `{ agents, sources, global_stale, server_now }`）。新端点跟进同惯例。

### Endpoint: GET /api/brain/agent-ops/model-accounts

**Success (HTTP 200)**：
```json
{
  "success": true,
  "data": {
    "accounts": [
      {
        "account_id": "codex-team1",
        "provider": "codex",
        "plan": "team",
        "five_hour_pct": 42,
        "seven_day_pct": 71,
        "reset_at": "2026-09-19T10:00:00.000Z",
        "host_alias": "mmv",
        "forwardable": true,
        "forward_targets": ["xian-m4", "xian-m1"],
        "status": "ok",
        "last_checked_at": "2026-09-19T09:07:00.000Z",
        "last_error": null
      }
    ],
    "server_now": "2026-09-19T09:07:05.000Z"
  }
}
```
- `data.accounts` (array, 必填): 恰好 **8 条**（Claude Code account1/2 + Codex team1-5 + Grok）。
- 每条 account 必含 PRD 约定 **11 字段**（下游 oracle 的 ground truth，字面用 PRD 名，禁改名）:
  - `provider` (string, 必填): 来源——实现定值（claude / codex / grok），单账号计数固定。
  - `plan` (string|null): 套餐；查不到=null。
  - `five_hour_pct` (number|null): 0–100；查不到=null（诚实留空，禁编造 0）。
  - `seven_day_pct` (number|null): 同上。
  - `reset_at` (string ISO|null): 配额重置时刻。
  - `host_alias` (string, 必填): 凭据所在机器，固定 `mmv`。
  - `forwardable` (boolean, 必填): 静态配置。
  - `forward_targets` (array<string>, 必填): 静态配置（Codex=`["xian-m4","xian-m1"]`；Claude/Grok=`[]`）。
  - `status` (string 枚举, 必填): `ok | unknown | key_expired | no_credential`（枚举单份，见下）。
  - `last_checked_at` (string ISO|null): 最近采集时刻。
  - `last_error` (string|null): 失败原文（截断 ≤500 字），与 status 双写。
  - `account_id` (string, 必填, 身份键): 区分 8 条用；非 PRD 11 字段但作为主键必需。
- **禁用字段名**（api_registry 同义替换词，正向断言里绝不出现）: `usage`（用 five_hour_pct/seven_day_pct）、`percent`、`reset`（用 reset_at）、`machine`（用 host_alias）、`error`（account 级用 last_error，非 error）。

**枚举单份（Invariant [枚举单份]）**: `status` 四态常量 `MODEL_ACCOUNT_STATUS` 只允许一份，定义在 `packages/brain/src/ops-model-accounts-collector.js`，collector 与 route builder 共同 import，禁手抄同值副本。

**边界/失败（HTTP 仍 200）**：单账号失败不整体报错——该账号 `status` 置 `unknown`/`key_expired`/`no_credential` + `last_error`，其余账号正常。仅表不存在(42P01) → 503 `migration_pending`（沿用刀1 `handle()` 契约）。

### Endpoint: GET /api/brain/agent-ops/agents（刀1 端点，追加字段）

每条 agent 追加 `model_role`（其余字段不变）：
```json
{ "model_role": { "model_id": "openai/gpt-5.6-terra", "primary_count": 14, "fallback_count": 6 } }
```
- `model_id` (string|null): 该分身的原始 primary model id（如实透出，**不造分层标签**）。
- `primary_count` (number): 全体分身里把该 model 设为 primary 的真实计数。
- `fallback_count` (number): 全体分身里把该 model 列入 fallback 的真实计数。

---

## Golden Path

[主理人/Commander curl model-accounts] → [读 8 账号配额快照 + agents.model_role] → [据配额/状态人工判断账号能否扛活]

### Step 1: 调 model-accounts 端点，返回 8 条账号快照
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 步 + 第 19 行字段清单。

**可观测行为**: `GET /api/brain/agent-ops/model-accounts` 返回 `data.accounts` 恰好 8 条（8 个静态注册账号），每条含 11 字段（provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error）。

**「恰好 8 条」口径统一（R1-2b 修复，全合同一致）**: 端点返回 `ops_model_accounts` **全表行**；collector 只 upsert `MODEL_ACCOUNTS` 的 8 个静态 `account_id`（不新增其它 id），因此**生产环境端点恰好返回 8 条**。CI 场景（E2E psql 预置 `e2e-` 前缀行、integration 段真跑 collector 写 8 个静态 id、失败隔离段预置 `test-` 前缀行）表内会同时含多组行，故**所有端点断言一律先按 `account_id` 前缀过滤到本用例命名空间再断言 `== 8`**（draft Step 1 / DoD B-01 / E2E 三处口径一致，见下）。

**验证命令**（E2E 段预置 `e2e-` 前缀 8 行代表采集器输出后）:
```bash
RESP=$(curl -sf "localhost:5221/api/brain/agent-ops/model-accounts")
echo "$RESP" | jq -e '[.data.accounts[] | select(.account_id|startswith("e2e-"))] | length == 8'
echo "$RESP" | jq -e '[.data.accounts[] | select(.account_id|startswith("e2e-"))] | all(has("provider") and has("plan") and has("five_hour_pct") and has("seven_day_pct") and has("reset_at") and has("host_alias") and has("forwardable") and has("forward_targets") and has("status") and has("last_checked_at") and has("last_error"))'
```
**硬阈值**: 本命名空间 accounts 数 == 8；每条 11 字段齐全。
**验证命令（硬阈值→可执行，同前缀口径）**:
```bash
echo "$RESP" | jq -e '[.data.accounts[] | select(.account_id|startswith("e2e-"))] | all(.status=="ok" or .status=="unknown" or .status=="key_expired" or .status=="no_credential") and ([.data.accounts[]|select(.account_id|startswith("e2e-"))]|length==8)'
```

---

### Step 2: 单账号失败只标该条，其余正常，HTTP 200
**来源**: `[FROM_PRD]` — PRD 边界情况第 1 条（token 过期/超时/限流 → status=unknown+last_error，其余 7 条正常，HTTP 200）。

**可观测行为**: 一个账号采集失败时，该条 `status="unknown"` 且 `last_error` 非空，其余 7 条 `status` 正常，整体 HTTP 200。

**验证命令**（E2E 预置一条 unknown 行后）:
```bash
CODE=$(curl -s -o /tmp/ma.json -w "%{http_code}" "localhost:5221/api/brain/agent-ops/model-accounts")
[ "$CODE" = "200" ] || { echo "FAIL: 单账号失败不该整体非200，实得 $CODE"; exit 1; }
jq -e '[.data.accounts[] | select(.status=="unknown")] | length >= 1 and (.[0]|.last_error|type=="string")' /tmp/ma.json
```
**硬阈值**: HTTP == 200；至少 1 条 status=unknown 且 last_error 为字符串。

---

### Step 3: Grok key 过期只标 key_expired，代码零 refresh_token 调用路径
**来源**: `[FROM_PRD]` — PRD 边界第 2 条 + Invariant [不刷 refresh_token]（脚本刷新=整条链被撤销）。

**可观测行为**: Grok 采集遇 grpc-status 7 PERMISSION_DENIED → 该条 `status="key_expired"`；collector 源码任何路径不调用/刷新 `refresh_token`。

**验证命令**:
```bash
# 语义：过期走 key_expired（E2E 预置 grok key_expired 行后）
jq -e '[.data.accounts[] | select(.status=="key_expired")] | length >= 1' /tmp/ma.json
# 铁律：新 collector 源码无 refresh_token 调用（只允许出现在「禁止」注释里；排除注释行后必须 0 命中）
grep -nE 'refresh_token' packages/brain/src/ops-model-accounts-collector.js | grep -vE '^[0-9]+:[[:space:]]*(//|\*|#)' && { echo "FAIL: collector 出现非注释 refresh_token 引用"; exit 1; } || echo "OK: 无 refresh_token 调用路径"
```
**硬阈值**: 至少 1 条 key_expired；collector 非注释行 refresh_token 命中数 == 0。

---

### Step 4: agents 端点每条追加真实 model_role
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 步（model_id + primary_count + fallback_count，不造分层标签）。

**可观测行为**: `GET /api/brain/agent-ops/agents` 每条含 `model_role{model_id, primary_count, fallback_count}`，计数为全体分身真实聚合。

**验证命令**:
```bash
curl -sf "localhost:5221/api/brain/agent-ops/agents" \
  | jq -e '.data.agents | all(has("model_role") and (.model_role|has("model_id") and has("primary_count") and has("fallback_count")))'
```
**硬阈值**: 每条 agent 含 model_role 三字段。

---

### Step 5: Notion「Agents&机器」库配额列（schema 落定）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 步。真实 Notion 推送不在 local_api CI 覆盖（见未覆盖清单），本步只验 schema/列定义落定。

**可观测行为**: `OPS_DB_PROPS.graph` 含新增配额列（5h%/7d%/更新时间），缺列即补幂等，随现有 notion-push-sync 推送。

**验证命令**:
```bash
(cd packages/brain && node -e "import('./src/ops-notion-schema.js').then(m=>{const g=m.OPS_DB_PROPS.graph;const need=['FiveHourPct','SevenDayPct','QuotaUpdatedAt'];const miss=need.filter(k=>!(k in g));if(miss.length){console.error('FAIL 缺列',miss);process.exit(1)}console.log('OK graph 配额列齐')})")
```
**硬阈值**: graph 库定义含 FiveHourPct/SevenDayPct/QuotaUpdatedAt 三列。

---

## 真实调用方请求 shape

- **端点调用方**（本 sprint 新端点的消费方）: 主理人 / Commander 脚本，走 `curl localhost:5221`，**无鉴权 header**（与刀1 agent-ops 端点一致，Brain 内部只读投影不加 auth）。DoD 断言按此 shape 直接 curl，无需注入 token。
- **collector → 第三方 provider**（采集侧，非本端点调用方）:
  - Anthropic: `GET https://api.anthropic.com/api/oauth/usage`，`Authorization: Bearer <account token>` + `anthropic-beta: oauth-2025-04-20`（参照现有 `account-usage.js`）。
  - ChatGPT/Codex: `GET https://chatgpt.com/backend-api/wham/usage`，账号自身 token。
  - Grok: 计费 gRPC-web 探针，账号自身 key；**过期只读不刷新**。
  - 这三条真调需 mmv 上的真实凭据 → 不在 CI 覆盖，见「未覆盖真实链路清单」。

---

## 未覆盖真实链路清单（规则 C — mock 豁免显式登记）

| 真实链路点 | 被什么顶替 | 为什么 | 真验证补位计划（谁/何时/环境）|
|---|---|---|---|
| collector host-exec ssh 逃逸到 mmv(100.86.118.99) 读凭据 | CI 内 ssh 不可达 → 采集腿 status=unknown/no_credential | mmv 凭据不进 CI；沿用刀1 采集腿失败即 stale 契约 | 上线后在 us-vps 真跑 scheduler job，`curl model-accounts` 核对真实 pct（collector owner，部署后首个 5min 周期）|
| 三家 provider usage API 真调（Anthropic/ChatGPT/Grok 真 key 真响应） | parser 单测用 fixture JSON/帧；collector 用注入探针 | 真 key 在 mmv，CI 无凭据 | 上线后首轮采集真响应核对 pct 合理（部署后，生产 env）|
| Notion「Agents&机器」库真实 PATCH 推送 5h%/7d%/更新时间 | 只验 OPS_DB_PROPS.graph schema + 补列幂等（纯函数） | Notion token 不进 local_api CI，真推会打生产库 | 随 notion-push-sync 下一周期真推，主理人 Notion 看板肉眼核对（部署后）|

（Grok 侧无 mock 顶替真实业务：过期语义 key_expired 在真 PG integration 段真验；不刷新铁律静态 grep + 注入 spy 零调用双验。）

---

## 禁 mock 边清单（规则 v9.12 — 本单涉 DB 写路径 + 跨模块数据传递）

- **collector ↔ ops_model_accounts 表（写路径）**: 本单新增账号快照落表。冻结测试 `[integration]` 段**真跑 `runModelAccountsCollector(真 pool, {fetchUsage, refreshToken spy})`** 写库后用 `pool.query` 查行断言（8 个静态 account_id 落表 + 连跑两次每 id 行数恒为 1），只 mock 最外层 provider 探针（注入 `fetchUsage`/`grokProbe` 代 mmv 采集），**DB 边禁 mock**。（memPool 的 grok 铁律单测只承担「refresh 零调用」逻辑断言，**不**是写路径 oracle——R1-2a 澄清。）
- **buildModelAccountsPayload ↔ ops_model_accounts 表（读路径）**: 端点直读该表。`[integration]` 段真 PG seed 8 行后调 builder，禁 stub pool 顶替。
- **buildAgentsPayload.model_role ↔ ops_agents.meta（读/聚合）**: model_role 从 ops_agents 全表 meta 聚合。`[integration]` 段真 PG seed 分身行后调 builder 验计数，禁 stub。
- 允许 mock 的更外层无关依赖: 第三方 provider usage API、mmv ssh 逃逸、Notion API（均属真实世界外部边界，已入未覆盖清单）。

### collector 注入契约（写路径可测的接缝，generator 必须实现）

`runModelAccountsCollector(pool, opts)` — 遍历 `MODEL_ACCOUNTS`（8 个静态账号），对每个账号取 usage → 映射 status/pct → `INSERT ... ON CONFLICT (account_id) DO UPDATE`（INV-4 幂等，非 SELECT-then-INSERT）。`opts` 注入接缝（缺省走真实 host-exec/网络）：

- `fetchUsage(account) => Promise<rawUsage>`：通用 per-account usage 采集接缝；注入后**不做真实 mmv host-exec/网络**，直接用返回的 raw 走 provider parser。
- `grokProbe() => rawGrokUsage`（抛错模拟过期，`err.grpcStatus===7` → `key_expired`）：grok 专用接缝，优先于 `fetchUsage`。
- `refreshToken`：**collector 任何路径绝不调用**（INV-1）；测试注入 spy，调用计数必须恒为 0。
- `only`（可选）：限定采集子集（如 `'grok'`）。

注入 `fetchUsage`/`grokProbe` 后 collector 零真实网络/ssh → `[integration]` 写路径测试在 local_api（真 PG，无 mmv 凭据）完全可跑。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 新增 GET /agent-ops/model-accounts 返回 8 账号配额快照；agents 端点追加 model_role；新表 ops_model_accounts + 采集 job（沿用刀1 host-exec）；三家可单测 parser；Notion 加配额列。 |
| **NFR（做得多好）** | 非功能 | 采集 5min 自锁+超时（沿用刀1 scheduler）；单账号失败不阻塞整体 HTTP 200；last_error 截断 ≤500 字。 |
| **Invariant（永不违反）** | 不变量 | ①Grok refresh_token 任何路径绝不调用/刷新；②status 枚举单份；③失败账号必落 status+last_error；④幂等 upsert（ON CONFLICT）。 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表。 |
| **保质期（何时过期）** | 失效 | 配额快照每 5min 刷新，`last_checked_at` 透出新鲜度；Grok key 约月周期过期（人工 `grok login --device-auth` 续，非本 sprint）。 |
| **死亡告警（停了谁知道）** | 告警 | 采集腿失败写 ops_source_heartbeats（沿用刀1 per-source 心跳/stale），Dashboard/Notion 可见 stale。 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明表。 |
| **效果确认（已发≠已生效）** | 回执 | 端点返回 `status`+`last_checked_at`+`last_error` 即回执；采集写库后下次 curl 可见。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | 聊天记录 API 不稳 | 静默丢消息 |
| ⚠️ Grok 是否 key 过期（而非瞬时网络错） | A. grpc-status 7 PERMISSION_DENIED; B. HTTP 403; C. 超时 | A（grpc-status 7 判 key_expired；超时/连接错判 unknown） | PrepPRD 判定点拍板：过期是 PERMISSION_DENIED，与瞬时错区分——误判成 key_expired 会误导主理人以为要人工续 key，误判成 unknown 会漏掉真过期 | 面客/派单误判账号可用性 |
| 账号凭据缺失 vs 采集失败 | A. auth.json/.credentials.json 不存在→no_credential; B. 存在但探针失败→unknown | A+B 分流 | PrepPRD 边界：Codex auth.json 损坏/缺失 = no_credential | 混淆「没配」与「配了但挂了」，排障方向错 |
| provider usage pct 缺字段 | A. 缺→null; B. 缺→0 | A（null） | 沿用刀1「宁 stale 不假数据」；0 会被误读为「配额充足」 | 满载账号被当空闲派活 |

> ⚠️ 行属「升拍板点」级别，但 PrepPRD 判定点表已由主理人拍板（见 PRD「判定点」段），无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 单账号 token 过期/超时/限流 | 该条 status=unknown+last_error，不抛，其余正常 | 是（ON CONFLICT account_id 幂等 upsert） | 下轮采集自动重试；端点仍 200 |
| Grok grpc-status 7 | 该条 status=key_expired，绝不刷新 refresh_token | 是 | 等人工 `grok login --device-auth` |
| Codex auth.json 缺失/损坏 | 该条 status=no_credential | 是 | 补凭据后下轮自动恢复 |
| ops_model_accounts 表不存在(42P01) | 端点 503 migration_pending（沿用刀1 handle 契约） | N/A | 跑 migration |
| mmv ssh 不可达 | 采集腿整体失败写 heartbeat，账号 status=unknown | 是 | per-source stale 告警 |

### 输入对抗面

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| N/A — 本端点纯只读投影，无对外暴露可写 agent 入口；采集数据来自自家凭据探针，非用户输入 | N/A | N/A | N/A |

---

## 已知约束

### 铁律 → INV 映射（Invariant 三源之一）
- INV-1 [不刷 refresh_token] → DoD B-03（key_expired + 静态 grep + 注入 spy 零调用）
- INV-2 [核对真实列名] → 新表列名由本 sprint migration 449 权威定义；ops_agents 列名依据 migration 433（meta JSONB）；generator 写测试/SQL 前须 `psql` 核对（本 proposer 环境 postgres=false，以 migration SSOT 为准，已记入 notes）
- INV-3 [枚举单份] → status 枚举 `MODEL_ACCOUNT_STATUS` 单份，DoD B-05 断言 collector 与 route 同源 import
- INV-4 [幂等 UPDATE] → 采集 upsert 用 `INSERT ... ON CONFLICT (account_id) DO UPDATE`（非 SELECT-then-INSERT）；DoD INV-4 条目跑冻结 `[integration]` 段真 collector：连跑两次 `runModelAccountsCollector(真 pool)`，psql `GROUP BY account_id HAVING count(*)>1` 恒空、总行数恒 8（R1-1 新增真 PG oracle）
- INV-5 [null 契约检查] → parser/host-exec 返回后判空；parser 缺字段返回 null（frozen 测试覆盖）
- INV-6 [字段长度校验] → last_error 写库前截断 ≤500（沿用刀1 heartbeat slice(0,500)）
- INV-7 [target_env 来源] → target_environment=local_api 从 PRD/tasks.payload 读（本合同已声明）；N/A 于运行时代码
- INV-8 [DB_NAME 同源] → E2E 写入侧/校验侧统一用 `$DB_URL`（同一变量），无双源

### 回归测试约束（Step 1.2）
- `packages/brain/src/routes/__tests__/agent-ops.test.js` → buildAgentsPayload/buildGraphPayload：per-source freshness、42P01→migration_pending、role 现算（本 sprint 追加 model_role 不得破坏这些）
- `packages/brain/src/__tests__/ops-collector-parsers.test.js` → parser 纯函数风格（describe/it/expect + 白名单禁凭据）：新 parser 跟进同风格
- `packages/brain/src/__tests__/ops-collector.test.js` → runOpsCollector 采集腿失败隔离、host-exec 逃逸、凭据白名单

### 累积 FR（[累积FR]，context-manifest 端点本 proposer 环境不可达，据 PRD 补录）
- 刀1 agent_ops_agents 只读投影（GET /agent-ops/{agents,calendar,graph} + ops-collector host-exec 采集 + notion-push-sync 两库）已上线 → 本 sprint 不得回退；agents 端点仅**追加** model_role，其余字段/契约不变。
- `context-manifest: unavailable`（本 proposer 环境无 Brain API 连接）

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## E2E 验收（final-e2e 跑 — target_environment = local_api）

> 与 harness Sprint Tests job 同环境（真 PG + Brain live :5221 + `$DB_URL`）。脚本预置 `e2e-` 前缀账号快照行（代表采集器输出——真实 mmv 采集不在 CI，见未覆盖清单），再 curl 端点验读路径 + 失败隔离 + key_expired，并静态断言 refresh_token 铁律。所有端点断言按 `e2e-` 前缀过滤（口径与 draft Step 1 / DoD B-01 一致，R1-2b）。
>
> **collector→表 写路径 + INV-4 幂等 upsert 的真 PG oracle（R1-1）** 由冻结测试 `[integration]` 段的 `runModelAccountsCollector(真 pool, {fetchUsage, refreshToken spy})` 落库后 `pool.query` 查行承担（8 个静态 account_id 落表 + 连跑两次每 account_id 行数恒为 1）。该段权威执行方是 **harness Sprint Tests job**（注入 `DB_NAME=cecelia_test` 全 migration → 测试内 `canDb=true` 真跑）。E2E 脚本 Step 7 再跑整份冻结测试文件：parser/枚举/铁律层任何环境都跑；`[integration]` 写路径段在 DB env（`DB_NAME`/`DATABASE_URL`/`DB`）就绪时真跑，未就绪则自跳过（不产生假绿——权威 oracle 在 Sprint Tests job）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:=postgresql://cecelia:cecelia@localhost:5432/cecelia}"
BASE_URL="${BASE_URL:-http://localhost:5221}"

# 0. 表存在（缺表=migration 未跑）
psql "$DB_URL" -tAc "SELECT to_regclass('public.ops_model_accounts') IS NOT NULL" | grep -qx t \
  || { echo "FAIL: ops_model_accounts 表不存在（migration 449 未跑）"; exit 1; }

# 1. 预置 8 行账号快照（6 ok + 1 unknown + 1 no_credential + 1 grok key_expired）：代表采集器输出
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
DELETE FROM ops_model_accounts WHERE account_id LIKE 'e2e-%';
INSERT INTO ops_model_accounts (account_id, provider, plan, five_hour_pct, seven_day_pct, reset_at, host_alias, forwardable, forward_targets, status, last_error, last_checked_at, updated_at)
VALUES
 ('e2e-claude1','claude','max',10,20,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-claude2','claude','max',15,25,NOW(),'mmv',FALSE,'[]','ok',NULL,NOW(),NOW()),
 ('e2e-codex1','codex','team',30,40,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex2','codex','team',35,45,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex3','codex','team',12,22,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','ok',NULL,NOW(),NOW()),
 ('e2e-codex4','codex','team',18,28,NOW(),'mmv',TRUE,'["xian-m4","xian-m1"]','unknown','token timeout',NOW(),NOW()),
 ('e2e-codex5','codex','team',NULL,NULL,NULL,'mmv',TRUE,'["xian-m4","xian-m1"]','no_credential','auth.json missing',NOW(),NOW()),
 ('e2e-grok','grok',NULL,NULL,NULL,NULL,'mmv',FALSE,'[]','key_expired','grpc-status 7 PERMISSION_DENIED',NOW(),NOW());
SQL

# 2. 端点返回本 e2e 前缀 8 条，11 字段齐全，HTTP 200
CODE=$(curl -s -o /tmp/ma.json -w "%{http_code}" "$BASE_URL/api/brain/agent-ops/model-accounts")
[ "$CODE" = "200" ] || { echo "FAIL: HTTP $CODE（单账号失败不该整体非 200）"; exit 1; }
jq -e '[.data.accounts[] | select(.account_id|startswith("e2e-"))] | length == 8' /tmp/ma.json
jq -e '[.data.accounts[] | select(.account_id|startswith("e2e-"))] | all(has("provider") and has("plan") and has("five_hour_pct") and has("seven_day_pct") and has("reset_at") and has("host_alias") and has("forwardable") and has("forward_targets") and has("status") and has("last_checked_at") and has("last_error"))' /tmp/ma.json

# 3. 失败隔离：unknown 带 last_error；no_credential 正确
jq -e '[.data.accounts[] | select(.account_id=="e2e-codex4")] | .[0].status=="unknown" and (.[0].last_error|type=="string")' /tmp/ma.json
jq -e '[.data.accounts[] | select(.account_id=="e2e-codex5")] | .[0].status=="no_credential"' /tmp/ma.json

# 4. Grok key 过期语义 + refresh_token 铁律（非注释行零命中）
jq -e '[.data.accounts[] | select(.account_id=="e2e-grok")] | .[0].status=="key_expired"' /tmp/ma.json
HITS=$(grep -nE 'refresh_token' packages/brain/src/ops-model-accounts-collector.js 2>/dev/null | grep -vE '^[0-9]+:[[:space:]]*(//|\*|#)' || true)
[ -z "$HITS" ] || { echo "FAIL: collector 非注释行出现 refresh_token: $HITS"; exit 1; }

# 5. forwardable/forward_targets 静态：codex 可转发 / grok 锁本机
jq -e '[.data.accounts[] | select(.account_id=="e2e-codex1")] | .[0].forwardable==true and (.[0].forward_targets|index("xian-m4"))' /tmp/ma.json
jq -e '[.data.accounts[] | select(.account_id=="e2e-grok")] | .[0].forwardable==false and (.[0].forward_targets|length==0)' /tmp/ma.json

# 6. agents 端点每条含 model_role 三字段
curl -sf "$BASE_URL/api/brain/agent-ops/agents" \
  | jq -e '.data.agents | all(has("model_role") and (.model_role|has("model_id") and has("primary_count") and has("fallback_count")))'

# 7. 冻结合同测试（真 PG 覆盖 collector→表→端点 + parser + model_role 聚合）
npx vitest run sprints/09190907-model-account-quota-projection/tests/model-accounts.test.ts --reporter=verbose

# 8. 清理
psql "$DB_URL" -c "DELETE FROM ops_model_accounts WHERE account_id LIKE 'e2e-%'" >/dev/null

echo "✅ Golden Path 验证通过（model-accounts 8 条 + 失败隔离 + key_expired 铁律 + model_role）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `GET /api/brain/agent-ops/model-accounts?provider=<非法值>` / 表内 status 写入非枚举值时端点是否泄露脏值
- 重复提交: 连续两轮采集（同 account_id）是否产生重复行（幂等 upsert 验证）
- 中途中断: 采集写到一半 ssh 断开 → 该腿 heartbeat 是否正确标失败、已写账号不被回滚成脏态
- 边界值: five_hour_pct 缺字段 → null（非 0）；last_error 超 500 字是否截断；forward_targets 空数组序列化
- 铁律面: 全仓（非仅新文件）grep `refresh_token` 是否被新代码在别处间接触发 Grok 刷新
发现分级: P0/P1（误刷 Grok token / 满载账号标空闲 / 面客配额错）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（parser + 状态映射 + refresh 铁律 + collector→表写路径 + 幂等 upsert + 端点读 + model_role） | `sprints/09190907-model-account-quota-projection/tests/model-accounts.test.ts` | 四态齐全、account_id 各唯一、同一 schema、classifyGrokUsageError 返回 key_expired、refreshToken 探针零调用、8 静态 account_id 落表、unknown 带 last_error、model_role | 模块 `ops-model-accounts-collector.js` 不存在 → 整个 suite 加载失败（Failed to load url ...ops-model-accounts-collector.js）→ 0 通过 |
