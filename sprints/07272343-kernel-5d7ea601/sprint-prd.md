# Sprint PRD — Preview current-SHA 门禁恢复

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

本次恢复针对 2026-07-27 连续多轮 Preview CI 失败后的正式修订。目标必须围绕 thin_prd 原文“把 Preview workflow→preview route→DB/GitHub/decision log 变成 server-owned current-SHA 门禁，并保持 Draft/三权威/后合并链。”展开，修复对象限定为真实 `.github/workflows/preview-deploy.yml` 触发真实 `POST /api/brain/preview/start` 与 `GET /api/brain/preview/status/:pr` 链路，不接受 callback、helper、source inspection、假 runner、假 recorder 或生产库回退。

最近同 Journey 的失败原因持续集中在假 Red、假 Oracle、错误接缝、PG 防护缺失与 formal reviewer 修订未落地；本 sprint 只收敛这些真实链路门禁，确保旧 receipt 全部失效并绑定当前 `origin/main` 的最新 SHA 语义。

## Golden Path（核心场景）

用户/系统从 [GitHub Preview workflow job 触发] → 经过 [真实 preview route 以 server-owned current SHA、隔离 PG、真实 GitHub PR 事实写入 decision log 并回读状态] → 到达 [Preview 仍保持 Draft，只有完整三权威与最终审批链成立后才允许后续合并链继续]

具体：
1. Preview workflow 在受控 runner 中启动，按真实 GitHub Actions 语义向 `/api/brain/preview/start` 发送请求，逐项携带并校验 `Authorization`、`Content-Type`、`pr_number`、`branch_name` 与全部 authority 标识。
2. Preview route 仅在 `TEST_DATABASE_URL` 明确、已连接白名单隔离库、且 GitHub PR #4372 / 当前 head / workflow run / task / run / current SHA 一致时写入 server-owned ground truth，并把 Preview、staging、promotion、final report、evaluator PASS、judge PASS、human approval 记录分层保存。
3. 调用 `/api/brain/preview/status/:pr` 时，响应逐项返回合同要求的成功键与状态键；遇到 stale head、wrong repo、wrong PR、wrong workflow run、wrong run task、缺上下文、Preview 必需失败、local required context failure、missing context mapping、external infrastructure failure 时，分别返回各自稳定 reason，且不出现被禁止字段。

## 边界情况

- `TEST_DATABASE_URL` 缺失、指向 `cecelia`/默认库/本地回环/Unix socket/歧义地址时，必须在任何 import、启动、子进程、写入前直接拒绝。
- GitHub 当前 head 一旦变化，之前全部授权、收据、审批链与 positive 结果立即失效，不得复用旧 SHA 结论。
- Red 只能在依赖、子 server/runner、隔离 PG、GitHub 只读预检都通过后执行，且失败原因只能是缺失的业务断言，不能是 timeout、死锁、connection refused、curl 28、bad substitution、vitest/config/import、placeholder expect.fail 或其他基础设施故障。
- merge/deploy/human approval 真实 POST 永远禁止；仅允许负向 spy=0/0 与单条完整授权链 merge/deploy spy=1/1 后立即停止。

## 范围限定

**在范围内**：真实 Preview workflow 与 preview route 的 current-SHA 门禁；隔离 PG 与 GitHub 只读事实校验；decision log 精确身份写入；B1-B5 链路的真实验收锚点；每个稳定 reason 的一条独立可执行测试和一条独立 counterfactual；Draft/三权威/后合并链保持不变；清理与回滚。
**不在范围内**：新增审批产品流程；真实 merge、真实 deploy、真实 human approval 提交；替换为 callback/helper/source grep 路径；修改无合同授权的共享 CI 基础设施；扩展到 Preview 之外的其它 workflow。

## 假设

- [ASSUMPTION: GitHub PR #4372 在本 sprint 执行期间可被只读查询，且 preview route 继续以 `/api/brain/preview/start` 与 `/api/brain/preview/status/:pr` 作为对外合同入口。]
- [ASSUMPTION: reviewer 要求的 `review_required=true`、PR 保持 Draft、停在用户批准前不真实合并，属于本 sprint 不可放松的既有业务约束。]

## 预期受影响文件

- `.github/workflows/preview-deploy.yml`: 真实 workflow job 必须继续走实际 preview 启动与状态回读链路。
- `packages/brain/src/routes/preview.js`: 真实 preview route 必须承载 current-SHA、authority、隔离 PG、decision log 与稳定 reason 合同。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [真环境验证] 依赖真实调用方/真实环境的接缝断言必须在真目标上验证过才算 done（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户；跨租户数据绝不混读/混写（来源: area）
- [审批禁直合] generator 不得自行 merge PR，merge 权归 controller，当前 sprint 也不得真实 merge/deploy（来源: area）
- [SHA 对账] PR 若在 evaluator/judge 前后发生 head 变化，必须以当前 PR head SHA 对账并使旧 verdict 失效（来源: area）
- [真实退出码] 合同批准前必须记录真实 exit code，并确认目标解释器/runner 确实启动（来源: area）
- [多轮真扫] 不能只靠“重置状态=冷启动”测试；必须至少覆盖一条真实多轮扫描、状态不重置的集成路径（来源: area）
- [共享 CI 禁区] 未经合同显式授权不得顺手修改共享 workflow/allowlist 等跨 sprint 基础设施（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## NFR 约束

- 超时/延迟: Red/Green 与状态轮询必须建立在已成功启动的真实 server、真实 runner、真实 GitHub 只读预检之上；不得以 timeout、curl 28、死锁等基础设施失败充当业务结果
- 频控: 每个稳定 reason 仅允许一条独立可执行测试和一条独立 mutation/counterfactual，禁止 regex/OR/表格合并断言
- 版本要求: 必须绑定 `origin/main` 在 2026-07-27 的 `d37a5e57827900be2651fe39655690238513128f` 或更新 SHA；新 head 出现即使既有 receipt/authorization 全部失效
- 可观测: 必须逐项保留精确 HTTP status/body、请求头与返回键值、decision log 身份、Red 命令、counterfactual 命令、restoration 命令、Green 命令、finally 清理记录
- 安全/隔离: 任一 B1-B5 前都必须要求 `TEST_DATABASE_URL` 且连接到非生产、非默认、非回环、非歧义地址的隔离 PG；禁止生产库 fallback

## E2E 验收

> Planner 初稿此区块先锚定端到端结果；可执行脚本由 proposer 按 `local_api` 模板补全。

```bash
# 占位：proposer 将填入真实 local_api 脚本
# 期望验收点（自然语言）：
# 1. 在受控 runner 中运行真实 .github/workflows/preview-deploy.yml，对真实 mounted preview route 发起 start/status 请求。
# 2. B1 证明 workflow→actual route→isolated PG→read-only GitHub PR #4372/current head 成立，且请求头/字段/成功键/禁止字段逐项机械校验。
# 3. B2 证明 route→same isolated PG→server-owned ground truth→orchestrator_decision_log 的 identity/repository/workflow/task/run/current SHA 全部精确一致。
# 4. B3 证明 generator fix 后重跑同一真实 workflow/route，旧 SHA 授权失效，新 current SHA 才能通过。
# 5. B4 证明命名 legacy adapter 入口仍经真实链路可复现实测原始 pass/fail，并保持隔离 PG。
# 6. B5 证明 staging E2E、production promotion、final report、evaluator PASS、judge PASS、human approval 各有独立真实存储记录，且都锚定同一当前 final SHA 与 GitHub Draft/head。
# 7. 负向 spy 调用保持 0/0；单条完整授权链 merge/deploy spy 恰为 1/1，随后立即停止，不做真实 merge/deploy/human approval POST。
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 `.github/workflows/preview-deploy.yml` 与 `packages/brain/src/routes/preview.js` 的后端调度/API 门禁，不涉及 dashboard、远端 agent 协议或 engine hooks。
## target_environment: local_api
## target_environment_reason: 该 sprint 核心是真实 Brain preview route、隔离 PostgreSQL、受控 child server/runner 与本地 API 验证链，按 Cecelia 规则应在 localhost Brain + 隔离 PG 环境执行。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
