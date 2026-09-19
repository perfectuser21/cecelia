# Sprint PRD — 模型账号配额+机器可达性投影（工厂·F5 指挥舱 刀2）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固（系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：+1~2%（F5 指挥舱运行舱补齐模型账号配额可观测维度）

## 背景

刀1（PR#5161）已上线 `agent_ops_agents` 只读投影（ops_agents/ops_schedule_entries/ops_source_heartbeats 三表 + ops-collector.js + GET /api/brain/agent-ops/{agents,calendar,graph} + notion-push-sync 两库）。本刀在其上追加**账号维度**：一条 API 看到 8 个模型账号（Claude Code account1/2、Codex team1-5、Grok）的实时配额快照、凭据所在机器、能否借道转发；agents 端点追加 model_role。**本次只做可观测数据，不做自动派单/选模型决策。**

## Golden Path（核心场景）

主理人（或 Commander 脚本）从 [调运行舱 API] → 经过 [collector 采集账号配额] → 到达 [看到 8 账号配额快照 + agents model_role + Notion 配额列]

具体：
1. 主理人调 `GET /api/brain/agent-ops/model-accounts` → 返回 8 条模型账号配额快照，每条含 provider/plan/five_hour_pct/seven_day_pct/reset_at/host_alias/forwardable/forward_targets/status/last_checked_at/last_error → 据此判断账号还能不能扛活
2. 系统侧：新 collector（沿用刀1 ops-collector.js 的 scheduler job 框架，5min 自锁+超时）通过 host-exec ssh 逃逸到 mmv(100.86.118.99) 读凭据，三家 provider-specific parser（Anthropic JSON / ChatGPT wham JSON / Grok gRPC-web 二进制帧）映射到同一 schema，写入账号级配额快照表
3. 主理人调 `GET /api/brain/agent-ops/agents`（刀1 端点）→ 每条追加 model_role：原始 model id（如 openai/gpt-5.6-terra）+ 该 model 被几个分身设为 primary/fallback 的真实计数（不造分层标签）
4. Notion「Agents&机器」库对应行出现 5h%/7d%/更新时间列，随现有 notion-push-sync 推送

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 单账号 token 过期/超时/限流 → 该条 status="unknown" + last_error，其余 7 条正常，HTTP 200 不整体报错
- Grok key 过期（grpc-status 7 PERMISSION_DENIED，约月周期）→ status="key_expired"；代码任何路径绝不调用/刷新 refresh_token（脚本刷新=整条链被撤销，只能人工 grok login --device-auth）
- Codex 5 账号 auth.json 损坏/缺失 → 该条 status="no_credential"
- forwardable/forward_targets 为静态配置，不做实时网络探测

## 范围限定

**在范围内**：model-accounts 只读端点 + 账号级配额快照表 + 三家可单测 parser + agents 端点追加 model_role + Notion「Agents&机器」库加配额列
**不在范围内**：自动选模型/派单决策；人为能力分层标签；给 Claude/Grok 搭跨机转发；Grok 分级型号探测；Codex 5 账号真实套餐核实

## 假设

- [ASSUMPTION: 新表命名 ops_model_accounts（PrepPRD 允许"或同类"），沿用刀1 collector 表结构约定]
- [ASSUMPTION: forwardable 静态配置当前值 = Codex 可经 opc-remote-worker 车道2 转发到 xian-m4/xian-m1；Claude Code/Grok 锁本机]
- [ASSUMPTION: 8 账号凭据路径固定在 mmv：~/.claude-account{1,2}/.credentials.json、~/.codex-team{1..5}/auth.json、~/.grok/auth.json]
- [ASSUMPTION: Unified Map 未配置（task.payload.map_repo 缺失），scope 锚定仅依据 PrepPRD，environment 由后端路径推断]

## 预期受影响文件

- `packages/brain/src/ops-model-accounts-collector.js`：新建，账号配额采集 + 三家 parser
- `packages/brain/src/`（agent-ops 路由层）：新增 GET /api/brain/agent-ops/model-accounts；agents 端点追加 model_role
- DB migration：新增账号级配额快照表 ops_model_accounts
- notion-push-sync（Agents&机器库）：追加 5h%/7d%/更新时间列
- 单测：三家 provider-specific parser 单测（Anthropic/ChatGPT/Grok）

## NFR 约束

<!-- 来源: decisions 表 category=nfr 双源均空；以下来自 PrepPRD 显式约束 -->
- 超时/调度: collector 沿用刀1 scheduler job 框架，5min 周期自锁 + 单账号查询超时保护（来源: PrepPRD）
- 可用性: 单账号失败不阻塞整体，端点始终 HTTP 200（来源: PrepPRD）
- 可测试: 三家 usage 解析拆成可单测纯函数 parser，不整段照抄 bash（来源: PrepPRD）
- 凭据安全: 采集沿用刀1 host-exec ssh 逃逸模式读 mmv 凭据，不新起 daemon、不落盘凭据（来源: PrepPRD）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 双源空；feature 铁律来自 PrepPRD 判定点(主理人已拍板)，area 取直接相关项 -->
- [不碰refresh_token] Grok key 过期只标 key_expired，代码任何路径绝不调用/刷新 refresh_token（来源: PrepPRD 判定点·主理人拍板）
- [不阻塞] 单账号失败只标 status(unknown/key_expired/no_credential)+last_error，其余账号正常，端点 HTTP 200（来源: PrepPRD）
- [不造标签] model_role 只出原始 model id + 真实 primary/fallback 用法统计，禁止造能力分层标签（来源: PrepPRD 判定点·主理人拍板）
- [只观测] 本 sprint 只产出可观测数据，禁止自动选模型/派单决策（来源: PrepPRD 判定点·主理人拍板）
- [凭据隔离] 多人协作禁止混用授权凭据，读账号资源须用其本人 token（来源: area）
<!-- 另有约 15 条 area 级 dashboard/android/kernel 域工程学习 invariant 与本 backend sprint 无直接约束关系，未逐条注入 -->

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journeys/:id/golden-paths API 返回空；以下取自 PrepPRD 记录的刀1 已上线行为(PR#5161) -->
- 刀1 agent_ops_agents 只读投影: Step1 ops-collector.js 采集三表 → Step2 GET /api/brain/agent-ops/{agents,calendar,graph} 只读投影 → Step3 notion-push-sync 推「Agents&机器」「编排日历」两库（本 sprint 追加维度时不得破坏现有 agents/calendar/graph 端点与两库同步）

## E2E 验收

> Planner 初稿此区块留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl+psql 命令。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql + parser 单测）
# 期望验收点（自然语言）：
# 1. curl localhost:5221/api/brain/agent-ops/model-accounts 返回 8 条，全字段齐全
# 2. mock 让 1 个账号查询失败（不动真实凭据）→ 该条 status="unknown"+last_error，其余 7 条正常，HTTP 200
# 3. GET /api/brain/agent-ops/agents 每条含 model_role，primary/fallback 计数真实（对齐分身配置）
# 4. Notion「Agents&机器」出现 5h%/7d%/更新时间列，值与 API 一致
# 5. proven-to-fire：mock Grok key 过期 → status="key_expired"，且静态断言 collector 代码无任何 refresh_token 调用路径
# 6. 三家 parser 单测全绿；CI 全绿
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain（新 collector + 新只读端点 + 新表 + Notion 推送），纯后端自治，无 UI/远端 agent 协议/engine 改动
## target_environment: local_api
## target_environment_reason: 验收为 curl localhost:5221/api/brain/agent-ops/model-accounts + psql 查快照表 + parser 单测，全在本地 evaluator 执行
## journey_id: 8bb8252f-29b4-4c34-acb9-1accda7ddfcf
## step_id: none（PrepPRD 未锚定 step，ability=01c792d9 为 thin feature）
