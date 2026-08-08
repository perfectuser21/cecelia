# Sprint PRD — playground GET /kernel-e 返回 ok-e（kernel 终验 E）

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环，当前 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（五修后环境稳定态，claude 全链含 merge 无人工干预终验通过即证明 harness 内核收官）

## 背景

本 sprint 是 kernel 五修（PR 投影器分支死结 + 账号解析 + claude 凭据 loader + CI 观测按可合并性裁决 + BEHIND 走版本无关 gh api）之后的**环境稳定态终验 E**。目的不是造功能，而是用一个最小可观测端点（playground `GET /kernel-e`）驱动 claude 全链（planner → proposer → generator → evaluator → merge）在**零人工干预**下跑通并自动收官，证明修后 harness 内核稳定。

## Golden Path（核心场景）

系统从 [playground 服务启动] → 经过 [claude 全链自动实现 `GET /kernel-e`] → 到达 [端点返回 ok-e、PR 自动 merge、终验绿]

具体：
1. [触发条件] playground 服务在 `PLAYGROUND_PORT`（默认 3000）监听
2. [系统处理] 客户端对 playground 发起 `GET /kernel-e`（无 query 参数）
3. [可观测结果] 返回 HTTP 200，响应体含标记 `ok-e`（沿用 playground JSON 约定，`{"result":"ok-e"}`）

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- `GET /kernel-e` 为无参 marker 端点，携带任意多余 query 参数时仍应稳定返回 200 + `ok-e`（不做严格参数校验，区别于 /increment 类算术端点）
- 服务未启动时 curl 连接失败 → 属环境问题，非端点缺陷

## 范围限定

**在范围内**：
- 在 `playground/server.js` 新增 `GET /kernel-e`，返回 200 + 含 `ok-e` 的 JSON
- claude 全链（planner→proposer→generator→evaluator→merge）在零人工干预下自动跑通并 merge

**不在范围内**：
- 不改动任何现有端点（/ping /sum /multiply /divide /power /modulo /subtract /increment /decrement /factorial /abs /echo /sign）
- 不做参数校验/错误码设计（marker 端点，非算术端点）
- 不改 Brain / dashboard / engine 代码

## 假设

- [ASSUMPTION: 返回体沿用 playground 现有 JSON 约定，marker 值字面为 `ok-e`，形如 `{"result":"ok-e"}`；最终字段名由 proposer 依 api_registry 锁定]
- [ASSUMPTION: 端点无需鉴权、无需 query 参数]

## 预期受影响文件

- `playground/server.js`: 新增 `app.get('/kernel-e', ...)` 路由，返回 200 + `ok-e`
- `playground/tests/`: 新增 `GET /kernel-e` 的行为回归测试（沿用 vitest + supertest 约定）

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step 源 []、feature 源不适用 ability_id=none），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定；marker 端点应即时同步返回）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: playground 端点自身返回即为可观测信号；全链失败必须落 Brain harness run 记录

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step 源 []、journey_feature 源不适用（gp_anchor=none(infra)，ability_id 缺失）、area 源 79 条 -->
- [验证命令实跑] 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1（来源: area）
- [证据分流] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 优先走 evaluator 补证轮而非改代码（来源: area）
- [台账不入库] controller 台账 `.harness/progress.md` 必须保持在 git 追踪之外（来源: area）
- （另有 76 条 area 级 `[capture-triage] learning:` 型 harness 过程学习略——均为链路自愈/证据窗口/毕业步等过程铁律，与本 playground marker 端点无功能耦合，evaluator 侧仍按 area 全量生效）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

<!-- journey e6f803f2 下 ability 均为 planned 状态（无 done/working），过滤后为空 -->

## E2E 验收

> Planner 初稿留占位；最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=playground 填入。

```bash
# 占位：proposer 将填入真实 playground 脚本（node playground/server.js + curl localhost:3000/kernel-e）
# 期望验收点（自然语言）：
#   1. 启动 playground（PLAYGROUND_PORT=<port> node playground/server.js）
#   2. curl localhost:<port>/kernel-e 返回 HTTP 200
#   3. 响应体含标记 ok-e（jq 断言 .result == "ok-e"）
#   4. claude 全链无人工干预跑通并自动 merge PR，Brain harness run 记录为终验绿
```

## journey_type: autonomous
## journey_type_reason: 涉及 playground/ 后端端点，无 dashboard/agent 协议/engine 路径命中，落 autonomous 默认
## target_environment: playground
## target_environment_reason: thin_prd 含 "playground" 且 payload 显式 target_environment=playground，本地 node playground/server.js 起服务在 localhost:3000 自测端点
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定，gp_anchor=none(infra)）
