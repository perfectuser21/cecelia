# Sprint PRD — 代理经济学仪表盘：cost_usd 断链修复 + 每PR成本报表 + Langfuse凭据接通

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 可观测性与成本感知（agent_ops 领域）
- **okr_initiative_id**：5ab1cf47-4d56-4602-86a9-eb7b899c44b0
- **本次推进预期**：让每一次 relay session 的真实 token/cost 数据落库，并提供按 PR 汇总的成本报表端点

## 背景

07-16 实测：`initiative_run_events.cost_usd` 列存在（migration 293 加列），但近 3 天 249 行全 NULL——成本记账管道断链。根因分析：

1. **写入点缺失**：`writeInitiativeRunEvent`（INSERT 路径）从不写 `cost_usd`；`updateInitiativeRunEvent`（UPDATE 路径）虽接受 `costUsd` 参数，但**调用方从未传入非 NULL 值**。relay 容器完成后的 `POST /api/brain/harness/callback/cecelia-relay-*` 仅 ack 200，不携带 usage 数据，也未触发 `updateInitiativeRunEvent`。
2. **`/api/brain/langfuse/recent` 返回 `credentials_missing`**：`~/.credentials/langfuse.env` 在当前容器环境未 mount 或凭据未录入 1Password CS。
3. **无成本报表端点**：Brain API 无 `GET /api/brain/economics/prs`，无法回答"每个合并 PR 花了多少钱/几轮重试"。

## Golden Path（核心场景）

**GP1 — relay 回调带 usage 落库**：
relay 容器跑完 → `POST /api/brain/harness/callback/cecelia-relay-*` 携带 `usage={input_tokens, output_tokens, cost_usd}` → Brain 解析并调用 `updateInitiativeRunEvent({costUsd, tokensIn, tokensOut})` → `initiative_run_events` 行的 `cost_usd / tokens_in / tokens_out` 非 NULL。

**GP2 — 每 PR 成本报表**：
调用 `GET /api/brain/economics/prs?days=7` → 返回按 task 聚合的 JSON 数组，每项含 `task_id, pr_url, total_cost_usd, attempt_count, refire_count, duration_ms, events_count`，末尾有全量 `summary`（total_cost, avg_cost_per_pr, total_attempts）。

**GP3 — Langfuse 凭据修复**：
从 1Password CS 取 Langfuse 凭据 → 落 `~/.credentials/langfuse.env`（chmod 600）→ Brain env 同步 → `GET /api/brain/langfuse/recent` 返回 `success: true`，数据非空数组。

## 边界情况

- relay 回调 body 不含 `usage` 字段 → 原有 200 ack 行为不变，`cost_usd / tokens_in / tokens_out` 保持 NULL，不阻断回调链
- relay 回调含 `usage` 但字段值为 0 或负数 → 写 0 或 NULL（禁止写负数，禁估算）
- `GET /api/brain/economics/prs` 查无记录 → 返回空数组 + summary 均为 0
- 1Password CS 中无 Langfuse 凭据条目 → 在 PR description 中注明缺哪个条目（`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY`/`LANGFUSE_BASE_URL`），禁止造假凭据；`/api/brain/langfuse/recent` 保持 `credentials_missing` 降级
- `initiative_run_events` 表无 `tokens_in`/`tokens_out` 列 → migration 先加列，之后再写

## 范围限定

**在范围内**：
- `packages/brain/src/routes/harness-callback.js`：relay 回调路径解析 `usage` 字段，调用 `updateInitiativeRunEvent` 写 `cost_usd / tokens_in / tokens_out`
- `packages/brain/src/events/initiativeRunEvents.js`：`updateInitiativeRunEvent` 扩参数支持 `tokensIn / tokensOut`
- `packages/brain/migrations/351_initiative_run_events_tokens.sql`（视 DB 现状决定，若列已存在则 migration 幂等 IF NOT EXISTS）：加 `tokens_in BIGINT / tokens_out BIGINT` 列
- `packages/brain/src/routes/economics.js`（新文件）：`GET /api/brain/economics/prs?days=N` 端点，JOIN `initiative_run_events` + `initiative_runs` + `tasks`，按 task 聚合
- `packages/brain/src/server.js`：注册 economics 路由（`/api/brain/economics`）
- Langfuse 凭据修复：`op item get` 从 1Password CS 取凭据 → 落 `~/.credentials/langfuse.env`（双写）→ Brain 进程 reload

**不在范围内**：
- harness-controller skill 侧改动（usage 从 relay 容器 entrypoint 透传出去，属于另一 task）
- 前端 Dashboard UI 变动
- Langfuse SDK 集成（本次只修凭据，不新增 LangGraph→Langfuse 的 tracing 上报）
- 其余表（`task_run_metrics`/`initiative_runs`）的 cost 字段（已有独立写入路径，不改）

## 假设

- [ASSUMPTION: relay 容器 entrypoint (`cecelia-run.sh`) 在完成后的 callback 请求体里**已携带或可透传** `claude -p` 的 `usage` 输出（`input_tokens`/`output_tokens`/`total_cost_usd`）；若 entrypoint 实际不透传 usage，则 cost_usd 依然 NULL，但 failing test 将明确定位断链位置]
- [ASSUMPTION: `initiative_run_events` 表当前不含 `tokens_in`/`tokens_out` 列（migration 293 只加了 `cost_usd`/`ts_end`/`model`）]
- [ASSUMPTION: Brain 运行时有权访问 `~/.credentials/langfuse.env`（docker volume mount）]
- [ASSUMPTION: 1Password CS vault 中若存在 Langfuse 凭据，其 item 名称为 `langfuse` 或类似明确标识]

## 测试计划（先写 failing test，后修代码）

### 必须先写的 Failing Tests

#### [T1] relay 回调 usage 落库（核心 failing test）

**文件**：`packages/brain/src/__tests__/economics-relay-usage.test.js`

**场景**：mock `POST /harness/callback/cecelia-relay-abcd1234-test`，body 包含：
```json
{
  "result": "done",
  "exit_code": 0,
  "usage": {
    "input_tokens": 5000,
    "output_tokens": 2000,
    "total_cost_usd": 0.035
  }
}
```

**断言（修复前 FAIL，修复后 PASS）**：
- HTTP 响应 200，`relayAck: true`
- `initiative_run_events` 表对应行（通过 `initiative_id` 反查）的 `cost_usd` = `0.035`（NOT NULL）
- `tokens_in` = `5000`，`tokens_out` = `2000`（NOT NULL）

**铁律**：不 mock `updateInitiativeRunEvent`，必须真实走 DB 落库断言；不允许仅断言函数被调用。

#### [T2] 报表端点对 fixture 数据聚合正确

**文件**：`packages/brain/src/__tests__/economics-prs.test.js`

**场景**：预置 DB fixture（3 个 task，各有若干 `initiative_run_events` 行，含已知 `cost_usd`/attempt/时间戳），调用 `GET /api/brain/economics/prs?days=30`。

**断言**：
- 响应含 `prs` 数组，每项有 `task_id, total_cost_usd, attempt_count, events_count, duration_ms`
- `summary.total_cost_usd` = 各 task cost 之和（精度 ±0.0001）
- `summary.total_attempts` = 所有 attempt 总和
- 超过 `days` 天的 event 不出现在结果中

### 现有测试不得回退

- `packages/brain/src/events/__tests__/initiativeRunEvents.test.js`：全通
- `packages/brain/src/routes/__tests__/relay-smoke.contract.test.js`：全通
- `packages/brain/src/__tests__/harness-skill-relay.test.js`：全通

## 预期受影响文件

- `packages/brain/migrations/351_initiative_run_events_tokens.sql`（新增）
- `packages/brain/src/events/initiativeRunEvents.js`：`updateInitiativeRunEvent` 加 `tokensIn`/`tokensOut` 参数
- `packages/brain/src/routes/harness-callback.js`：relay 回调路径解析 `usage`，调用 `updateInitiativeRunEvent`
- `packages/brain/src/routes/economics.js`（新增）
- `packages/brain/src/server.js`：注册 economics 路由
- `packages/brain/src/__tests__/economics-relay-usage.test.js`（新增）
- `packages/brain/src/__tests__/economics-prs.test.js`（新增）

## E2E 验收

target_environment=local_api，验收由 evaluator 在本地 Brain API 上执行。

```bash
# 期望验收点（proposer 按 local_api 填入真实断言脚本）

# 1. relay 回调 usage 落库
curl -s -X POST localhost:5221/api/brain/harness/callback/cecelia-relay-test1234-smoke \
  -H "Content-Type: application/json" \
  -d '{"result":"done","exit_code":0,"usage":{"input_tokens":100,"output_tokens":50,"total_cost_usd":0.001}}' \
  | grep -q '"relayAck":true'
# 然后查 DB 确认 cost_usd NOT NULL:
psql cecelia -c "SELECT cost_usd, tokens_in, tokens_out FROM initiative_run_events ORDER BY id DESC LIMIT 1;" \
  | grep -v NULL

# 2. 报表端点
curl -s "localhost:5221/api/brain/economics/prs?days=7" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if 'prs' in d and 'summary' in d else 'FAIL')"

# 3. Langfuse 凭据（若 1Password CS 有凭据）
curl -s localhost:5221/api/brain/langfuse/recent \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('success') else f'SKIP: {d.get(\"error\")}')"
```

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant（ee2890bb-003c-4f02-96a4-e1c10532571a 及 area 级规则） -->
- [单slot串行] 一个 slot/会话内严格串行执行任务，不并发写同一工作区（来源: area）
- [禁写死环境假设] 端口/路径/主机名等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证才算done] 依赖真机/本地 Brain API/真实调用方的接缝断言必须在真目标上验证过才算 done（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志；Langfuse key 只存 ~/.credentials/ 和 1Password CS（来源: area + task PRD 明确）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个新增 API 端点必须有 auth 或与现有 Brain 鉴权模式对齐（来源: area）
- [禁估算造假] cost_usd 只能写可得的真实数值（relay usage 字段或 Langfuse）；无数据则写 NULL，不得用模型定价估算填充（来源: task PRD 明确约定）
- [migration 幂等] 每个 SQL migration 必须用 IF NOT EXISTS / DO NOTHING 保证幂等（来源: 项目惯例）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: agent_ops domain 历史 PRs，domain=agent_ops 无独立 journey FR 记录 -->
- relay 容器回调 `cecelia-relay-*` 路径返回 200 ack，不触发 LangGraph resume（harness-callback 现行行为）
- `PATCH /api/brain/orchestrator/relay-runs/:initiative_id` 支持 `cost` 字段写入 `initiative_runs.cost_usd`（initiatives 路由现行行为）
- `GET /api/brain/langfuse/recent` 在凭据缺失时返回 `{success:false, error:'credentials_missing'}`（langfuse 路由降级行为）

## NFR 约束

<!-- 来源: PrepPRD 显式约束 + 项目通用 NFR -->
- 超时/延迟：`GET /api/brain/economics/prs` 查询须 <2s（本地 PostgreSQL，join 3 表，days=30 范围）
- 频控：无（内部 API，非公开端点）
- 版本要求：Brain 版本 bump（需新增 migration）
- 可观测：新端点响应必须包含可供 grep 的结构化字段（`prs` 数组 + `summary` 对象）；回调写库失败需 `console.warn` 留日志（non-fatal，不阻断 200 ack）
- 幂等：relay 回调多次重试时，`updateInitiativeRunEvent` 仅更新已存在行（`WHERE id = $1`），不重复 INSERT

## journey_type: autonomous
## journey_type_reason: 纯 Brain 后端链路修复（DB写入+API端点），无用户可见 UI 交互；Langfuse 凭据修复属运维操作不涉及前端
## target_environment: local_api
## target_environment_reason: 验收信号来自本地 Brain API localhost:5221 与本地 PostgreSQL，无需浏览器或远端 runner（PrepPRD 已明确 target_environment=local_api）
## journey_id: none（agent_ops 领域无对应 journey，task 未绑定 journey_id）
## step_id: none（PrepPRD 未锚定）
