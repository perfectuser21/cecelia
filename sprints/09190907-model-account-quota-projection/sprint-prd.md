# Sprint PRD — 模型账号配额+机器可达性投影（工厂·F5指挥舱 刀2）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1~2%（运行舱只读投影补齐"账号配额+机器可达性"维度）

## 背景

刀1 `agent_ops_agents` 只读投影已上线（PR#5161）：ops_agents/ops_schedule_entries/ops_source_heartbeats 三表 + ops-collector.js（host-exec ssh 逃逸到 mmv 采集）+ GET /api/brain/agent-ops/{agents,calendar,graph} + notion-push-sync「Agents&机器」「编排日历」两库。本次刀2 给这套投影加**模型账号维度**：一条 API 看到 8 个模型账号（Claude Code account1/2、Codex team1-5、Grok）的实时配额快照 + 凭据所在机器 + 能否借道转发；agents 端点每条追加 model_role。**只做可观测数据，不做自动派单决策。**

## Golden Path（核心场景）

主理人/Commander 从 [调运行舱 API] → 经过 [读账号配额 + agent model_role] → 到达 [据此人工判断账号还能不能扛活]

具体：

1. 主理人（或 Commander 脚本）调 **GET /api/brain/agent-ops/model-accounts** → 系统返回 **8 条**账号快照，每条含字段：`provider` / `plan` / `five_hour_pct` / `seven_day_pct` / `reset_at` / `host_alias` / `forwardable` / `forward_targets` / `status` / `last_checked_at` / `last_error`。据此判断账号还能不能扛活。
2. 主理人调 **GET /api/brain/agent-ops/agents**（刀1 端点）→ 每条追加 `model_role`：原始 model id（如 `openai/gpt-5.6-terra`）+ 该 model 被几个分身设为 primary / fallback 的真实计数（`model_id` + `primary_count` + `fallback_count`，**不造分层标签**）。
3. `forwardable` / `forward_targets` 为**静态配置**（当前：Codex 可经 opc-remote-worker 车道2 转发到 xian-m4/xian-m1；Claude Code/Grok 锁本机），不做实时探测。
4. Notion「Agents&机器」库对应行追加 `5h%` / `7d%` / `更新时间` 三列，随现有 notion-push-sync 推送，与 API 值一致。

<!-- status 枚举：ok | unknown | key_expired | no_credential。字段名为下游 oracle 的 ground truth；Response Schema 细节由 Proposer 在 Step 1.1 读 api_registry 后定稿。 -->

## 边界情况

- **单账号失败**（token 过期/超时/限流）→ 该条 `status="unknown"` + `last_error`，其余 7 条正常，HTTP **200** 不整体报错。
- **Grok key 过期**（grpc-status 7 PERMISSION_DENIED，约月周期）→ `status="key_expired"`；代码任何路径**绝不调用/刷新 refresh_token**（脚本刷新=整条链被撤销，只能人工 `grok login --device-auth`）。
- **Codex 5 账号 auth.json 损坏/缺失** → 该条 `status="no_credential"`。
- **三家 usage 结构不同**（Anthropic JSON / ChatGPT wham JSON / Grok gRPC-web 二进制帧）→ collector 三套 provider-specific parser 映射到同一 schema，parser 可单测。

## 范围限定

**在范围内**：GET /api/brain/agent-ops/model-accounts 只读端点；账号级配额快照新表 + 采集 job（沿用刀1 ops-collector host-exec ssh 逃逸到 mmv 100.86.118.99）；三家可单测 parser；agents 端点追加 model_role；forwardable 静态配置；Notion「Agents&机器」加配额列。

**不在范围内**：自动选模型/派单决策；人为能力分层标签；给 Claude/Grok 搭跨机转发；Grok 分级型号探测；Codex 5 账号真实套餐核实。

## 假设

- [ASSUMPTION: 账号快照落新表（如 `ops_model_accounts`），沿用刀1 scheduler job 框架（5min 自锁+超时），不新起宿主 daemon。]
- [ASSUMPTION: 凭据路径固定在 mmv：`~/.claude-account{1,2}/.credentials.json`、`~/.codex-team{1..5}/auth.json`、`~/.grok/auth.json`。]
- [ASSUMPTION: forward 静态表当前值 = Codex→(xian-m4, xian-m1) via 车道2；Claude Code/Grok = 空（锁本机）。]

## 预期受影响文件

- `packages/brain/src/ops-model-accounts-collector.js`（新增）：三家 usage 采集 + provider-specific parser（可单测函数，非整段照抄 bash），host-exec ssh 逃逸到 mmv。
- `packages/brain/src/routes/agent-ops.js`：新增 `router.get('/model-accounts', ...)`；`buildAgentsPayload` 追加 `model_role`。
- `packages/brain/migrations/*`（新增）：账号级配额快照表 `ops_model_accounts`。
- `packages/brain/src/ops-notion-schema.js` + `notion-push-sync.js`：「Agents&机器」库加 5h%/7d%/更新时间列并推送。
- `packages/brain/src/__tests__/ops-model-accounts-*.test.js`（新增）：parser 单测 + 端点/边界回归。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空），PrepPRD 显式值优先 -->
- 采集周期/自锁：沿用刀1 scheduler job，5min 自锁 + 超时（PrepPRD 显式）
- 失败隔离：单账号失败不阻塞整体，HTTP 200（PrepPRD 显式）
- 安全红线：Grok refresh_token 绝不被任何代码路径调用/刷新（PrepPRD 显式，见 Invariant）
- 可观测：账号失败必须落 `status` + `last_error`（PrepPRD 显式）
- 可测性：三家 usage parser 拆为可单测纯函数（PrepPRD 显式）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant；step/journey_feature 两源均空，以下取 area 级中与本 sprint（后端 API + 新表 + agents 字段 + collector + notion）相关者。area 层共 94 条，其余与本 sprint 无关（dashboard/android/relay 等），未逐条注入。 -->
- [不刷 refresh_token] Grok key 过期只标 key_expired，代码任何路径绝不调用/刷新 refresh_token（来源: PrepPRD 判定点，铁律）
- [核对真实列名] proposer 起草涉及 agents/新表字段的合同/测试前先 psql 核对真实列名，不凭经验假设（来源: area）
- [枚举单份] 枚举语义常量（如 status 集合）只允许一份，落在各消费方共同 import 的 service，禁手抄同值副本（来源: area）
- [幂等 UPDATE] "SELECT 判态再 UPDATE" 一律升级为 `UPDATE ... WHERE`，防并发（来源: area）
- [null 契约检查] 调用"失败返回 null/false"契约的函数后必须写 if 判空（如 host-exec/parser 返回）（来源: area）
- [字段长度校验] DB 表字段长度约束（varchar(N)）在写入前对无天然长度保证的来源数据做截断/校验（来源: area）
- [target_env 来源] target_environment 从 DB tasks.payload 读取，不从文件读（来源: area）
- [DB_NAME 同源] 冒烟/校验类脚本写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/:id/golden-paths 返回空（刀1 golden_path 未入该端点）；以下据 PrepPRD 已上线事实补录，本 sprint 不得回退 -->
- 刀1 agent_ops_agents 只读投影: GET /api/brain/agent-ops/{agents,calendar,graph} 返回运行单元/编排日历/合并视图 → ops-collector host-exec ssh 采集 → notion-push-sync 推「Agents&机器」「编排日历」两库

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + mock）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl + psql + mock 注入）
# 期望验收点（自然语言）：
# 1. curl localhost:5221/api/brain/agent-ops/model-accounts 返回 8 条，字段齐全（provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error）
# 2. mock 让 1 个账号查询失败（不动真实凭据）→ 该条 status="unknown"+last_error，其余 7 条正常，HTTP 200
# 3. mock Grok key 过期 → 该条 status="key_expired"；静态断言代码全仓无任何 refresh_token 调用路径
# 4. GET /api/brain/agent-ops/agents 每条含 model_role，primary/fallback 计数真实
# 5. Notion「Agents&机器」出现 5h%/7d%/更新时间列且与 API 一致
# 6. 三家 parser 单测通过；CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端（新 API + 新表 + 采集 job），无 dashboard/engine/agent bridge，命中 brain→autonomous。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端 API，E2E 走本地 evaluator（curl localhost:5221 + psql + mock），非 UI/Windows/微信/生产部署。
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: none（PrepPRD GP-Anchor N/A，cecelia 仓无 product-map，未锚定）
