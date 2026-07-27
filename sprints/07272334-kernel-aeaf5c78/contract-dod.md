---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — P0 Kernel Feedback Lineage Recovery 4

**范围**：恰好 B1-B5；大小 L；全部条目未预勾。

## ARTIFACT 条目

- [ ] [ARTIFACT] HarnessResult 仍为 1.0，Brain DEFINITION 与 package 版本同值且语义包含 result sink/feedback lineage
  Test: node sprints/07272334-kernel-aeaf5c78/tests/assert-version.mjs

- [ ] [ARTIFACT] 契约测试驱动能加载并拒绝未声明 behavior
  Test: bash -n sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh && node --check sprints/07272334-kernel-aeaf5c78/tests/pg-preflight.mjs

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] [B1] real result sink
  动作: 真实 dispatcher 分别派发 local/fleet reviewer、canary，并执行 in-process judge；runner 消费 worker-local result file。
  预期观察: within 60s 只 external agent 获 BRAIN_RESULT_FILE，workspace 只读；安全反例全拒绝，success/failure/cancel 后文件清理且 attestation 绑定完整。
  Test: manual:bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B1 green

- [ ] [BEHAVIOR] [L2] [B2] exact HarnessResult bounds
  动作: 经真实 parser/callback 提交所有精确边界、+1、enum、重复 id、binding 与 digest tamper。
  预期观察: within 60s 合法边界通过；每个非法输入以具名 invalid_result/digest_conflict 拒绝，CANARY_OK 空 envelope 不回退。
  Test: manual:bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B2 green

- [ ] [BEHAVIOR] [L2] [B3] atomic callback
  动作: production stores 在隔离 PG 建行，子进程启动真实 callback socket，真实 HTTP 覆盖成功、严格错误、replay、并发与事务 fault。
  预期观察: within 60s 状态与 key/code 精确；成功两写一致，fault 后按 run+attempt 两写皆 0；响应/日志/DB 无敏感反射。
  Test: manual:bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B3 green

- [ ] [BEHAVIOR] [L2] [B4] exact Round2 lineage
  动作: 持久化 Round1 review，真实 ground truth 加载后由真实 dispatcher 派 fresh Round2 proposer/reviewer，并执行 legacy/Fleet/缺失/stale/concurrent/recovery 负例。
  预期观察: within 60s prior_review/resolutions 精确 1:1；负例在 launch 前阻断且无新 attempt。
  Test: manual:bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B4 green

- [ ] [BEHAVIOR] [L2] [B5] current-head approvals
  动作: 隔离 PG 建 evaluator/judge/human 行，真实 GitHub resolver GET 当前 head，并在 head 变化前后执行门禁。
  预期观察: within 60s stale/缺失路径 merge/deploy=0/0，唯一完整同 SHA fixture=1/1；实际流程停在人工批准前。
  Test: manual:bash sprints/07272334-kernel-aeaf5c78/tests/run-behavior.sh B5 green

## 铁律映射

- INV-1 watchdog 恢复：B4 recovery 只认真实 attempt/外部真相。
- INV-2 语义成功：B3 回读两表，不只看 ok。
- INV-3 依赖审计：N/A，不改依赖。
- INV-4 relay 心跳：N/A，无长 CI relay。
- INV-5 毕业门禁：实现 PR 先跑 lint-tdd-commit-order/check-test-coverage。
- INV-6 真退出码：run-behavior 捕获真实解释器/业务 exit。
- INV-7 真跑命令：manual 命令逐条执行，不以 bash -n 代替。
- INV-8 烟测一：N/A，不触及对应模块。
- INV-9 烟测二：N/A，不触及对应模块。
- INV-10 多轮扫描：B4 真实 Round1→Round2 不重置状态。
- INV-11 付费幂等：N/A，无付费调用。
- INV-12 时间关系：nonce expiry、attempt terminal、cleanup 顺序显式断言。
- INV-13 剧场匹配：local_api 对应真 HTTP/PG/GitHub GET。
- INV-14 环境来源：target_environment 取 task payload。
- INV-15 judge 格式：B5 用真实 judge row 与结构化 verdict。
- INV-16 字段长度：B2 在写库前覆盖全部长度上限。
- INV-17 复活溯源：旧 commit/attempt 仅 evidence，不继承 approval。
- INV-18 显式失败：所有 null/false/invalid 都 fail closed。
- INV-19 烟测三：N/A，不触及对应模块。
- INV-20 报告探针：N/A，不改 journey_features。
- INV-21 收账产物：B1 attestation、B3 DB、B5 gate 都回读。
- INV-22 headed 白名单：N/A，无 headed 接管。
- INV-23 点火可追踪：分支含 task short id，base_repo 已绑定。
- INV-24 数据判退役：N/A，不退役能力。
- INV-25 后台告警：persistence/cleanup 失败具名且非零。
- INV-26 表名认领：仅复用 harness_attempts/orchestrator_decision_log。
- INV-27 真实消费：N/A，不新增 job。
- INV-28 多端完整：B1 local-docker/fleet-worker 均验。
- INV-29 未知语义：错误 key/code 与 digest policy 两端同义。
- INV-30 引用校验：E2E 使用 `git rev-parse --verify "origin/main^{commit}"`。
- INV-31 烟测隔离：所有写仅 TEST_DATABASE_URL，merge/deploy 仅 spy。
- INV-32 部署失败：deploy 不得 warning 降级。
- INV-33 生产自报：B5 GitHub current-head，不用工作区 diff。
- INV-34 测试质量：真实异步边均 await。
- INV-35 合同表格：Test Contract 固定四列。
- INV-36 Red 精确提交：只暂存本 sprint tests。
- INV-37 调度回归：B1/B4 走真实 dispatcher，不以 source inspection 替代。
- INV-38 定时入口：N/A，无 cron。
- INV-39 禁止自并：generator/controller 在批准前不 merge。
- INV-40 显式环境：runner 显式传 BRAIN_RESULT_FILE，其余 authority 不传 agent。
- INV-41 历史核验：已核 current main d37a5e5 与旧 reviewer evidence。
- INV-42 共享禁区：不改共享 CI。
- INV-43 SHA 对账：B5 evaluator/judge/human/current-head 四方对账。
- INV-44 烟测四：N/A，不触及对应模块。
- INV-45 Brain 烟测：brain/src 改动进入既有 smoke/allowlist。
- INV-46 任务接线：N/A，不增 task_type。
- INV-47 服务双信号：B3 子进程同时验 socket 与 HTTP ready。
- INV-48 常驻域：N/A，不增 LaunchAgent/Daemon。
- INV-49 守护清单：N/A，不增常驻服务。
- INV-50 烟测五：N/A，不触及对应模块。
- INV-51 单槽串行：同 attempt result 单次消费，B4 fresh session。
- INV-52 环境推导：DB host/CIDR、uid、runtime root 从环境/owner 推导。
- INV-53 真验才完成：local/fleet/HTTP/PG/GitHub 接缝均真验。
- INV-54 多租户测试：B3/B4 至少两 run/task scope 且不串。
- INV-55 凭据安全：callback/GitHub secrets 不进 git/log/响应。
- INV-56 日志脱敏：message/stack/transcript/CoT 不写日志或 DB。
- INV-57 端点鉴权：B3 验 Authorization + lease owner。
- INV-58 租户隔离：run+attempt+task+contract SHA 全绑定。

## BEHAVIOR:E2E

模式 B 执行 contract-draft.md 的单一 bash 块；期望五个同名业务 PASS，停在人工批准前。
