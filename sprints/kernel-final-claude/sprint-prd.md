# Sprint PRD — playground GET /kernel-pong 返回 pong

## OKR 对齐

- **对应 KR**：KR「Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环」（progress 82%）
- **当前进度**：82%
- **本次推进预期**：+0%（infra 终验 sprint，验证 kernel 全链，不直接推进业务 KR 百分比）

## 背景

#4730 三修（投影器分支死结 + 账号展开 + claude 单链挂载）合入后，需要一条最小穿透
sprint 做 claude 执行体终验（终验 B）：**不带 executor_account**，验证 kernel 能否正确
展开账号（capability_snapshot → provider=claude/account1/us-mac-m4）并把执行体挂到单链上。
本 sprint 以 playground 新增一个 `GET /kernel-pong` 端点作为最小载体——端点本身极简，
真正被验证的是「thin_prd → planner → GAN → claude 执行体落地 → evaluator」这条 kernel 全链。

## Golden Path（核心场景）

系统从 [启动 playground] → 经过 [请求 /kernel-pong] → 到达 [返回 pong]

具体：
1. 启动 playground 服务：`node playground/server.js`（端口 `PLAYGROUND_PORT`，默认 3000）
2. 客户端发起 `GET /kernel-pong`（无 query 参数、无 body）
3. 服务返回 HTTP 200，响应体为 JSON `{ "pong": true }`（沿用 playground 既有 `/ping` 幂等约定）

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 带任意 query 参数（如 `?x=1`）：仍返回 200 + `{ "pong": true }`（端点无参数语义，忽略之）
- 非 GET 方法（POST/PUT 等）：走 express 默认 404/405，不在本 sprint 断言范围
- 端口被占用：由 `PLAYGROUND_PORT` 覆盖，e2e 脚本自行选空闲端口

## 范围限定

**在范围内**：
- playground/server.js 新增 `GET /kernel-pong` 路由，返回 `{ "pong": true }`
- 对应最小回归测试（playground/tests 下，vitest）

**不在范围内**：
- 不改动 Brain（packages/brain）、dashboard、engine 任何代码
- 不新增鉴权/参数校验/持久化
- 不修改既有 `/ping` 及其他 playground 端点
- kernel 账号展开/单链挂载逻辑本身（那是 #4730 已交付内容，本 sprint 只做穿透验证，不再改 kernel）

## 假设

- [ASSUMPTION: 「返回 pong」采用 playground 既有 `/ping` 的响应形态 `{ "pong": true }`，而非纯文本 "pong"，以保持端点风格一致并给出可机检 oracle]
- [ASSUMPTION: 端点无需鉴权，与 playground 其他训练端点一致]

## 预期受影响文件

- `playground/server.js`: 新增 `GET /kernel-pong` 路由
- `playground/tests/`: 新增 `/kernel-pong` 回归测试用例

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级本 line 无数据）；仅注入对本 playground infra sprint 可约束的条目 -->
- [playground-e2e-端口] playground 端点的 e2e 只测 `localhost:3000`/`$PLAYGROUND_PORT`，严禁用 `localhost:5221/api/brain/*` 冒充存活验证（来源: area，planner_drift 红线）
- [台账不入库] controller 台账 `.harness/progress.md` 必须保持在 git 追踪之外，不得随 sprint PR 带入 repo（来源: area）
- [local验证真相形态] 无 UI 的 local/playground smoke 任务须在合同预声明验证真相形态（curl+exit code），避免 judge 机械闸⑤死锁（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey e6f803f2 golden-paths 查询为空 -->
- （本 line 暂无历史）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step + feature 双源均为空）；PrepPRD 未显式指定 -->
- 超时/延迟: 待定（PrepPRD 未指定；playground 本地端点应 <100ms 响应）
- 频控: 无
- 版本要求: 无
- 可观测: 端点返回可由 curl + jq 直接断言，无需额外日志

## E2E 验收

> 最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=playground 填入。以下为占位 + 验收点。

```bash
# 占位：proposer 将填入真实 playground 脚本（启 server → curl /kernel-pong → jq 断言 → kill）
# 期望验收点（自然语言）：
#   启动 playground 后，GET localhost:$PORT/kernel-pong 返回 HTTP 200，
#   响应体 JSON 满足 .pong == true；进程可正常关闭。
# 位置词红线：只测 localhost:3000/$PLAYGROUND_PORT，禁止出现 localhost:5221/api/brain/*
```

## journey_type: autonomous
## journey_type_reason: 仅涉及 playground 后端端点（无 dashboard/agent 协议/engine），按 if-elif 链落默认 autonomous
## target_environment: playground
## target_environment_reason: payload 显式 target_environment=playground 且 thin_prd 含 "playground"，本地 node playground/server.js 执行
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定，gp_anchor=none(infra)）
