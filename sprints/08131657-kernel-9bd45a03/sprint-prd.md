# Sprint PRD — 真身 Session Controller：每条 kernel run 一个常驻监护进程

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（harness run 从"记账户籍"升级为"活体监护"，消除 merge 后人肉收尾）

## 背景

PR #4860 只交付了 Controller 户籍制度：`controller_session_id`+lease 记账、无主判定、orphan-guard 收尸。但 Controller 本人不存在——`controllerSessionId` 是 `randomUUID()` 记账（`harness-skill-relay.js:241`），无真实进程；lease 无人续租；Kernel fatal 只能等扫尸不能救活；merge 后收尾靠人肉（run 8783807c 实证）。本 sprint 让每条 kernel run 有一个常驻 Controller 进程：第一个启动、最后一个退出，只监护不执行。

## Golden Path（核心场景）

系统从 [createKernelRun 点火] → 经过 [Controller 认领→拉起 Kernel→续租→监护→人审守护] → 到达 [PR merged + task result 回写后 Controller 退出]

具体：
1. **入口**：`_spawnKernelRuntime` 被调用 → 先 spawn 一个本机 detach 常驻 Controller 进程（守护进程即可，非 LLM session），Controller 取得 ownership（把 `controller_session_id` 写成自身真实身份，而非随机 UUID），ownership 落库后才拉起 Kernel。
2. **续租**：Controller 周期心跳续租 lease（可观测到至少两个续租周期）；Controller 存活则 lease 永不过期，orphan-guard 不介入（降级为后备，行为保持不动）。
3. **监护循环**：Controller 盯 Kernel 进程存活 + run phase + PR/CI 状态。Kernel fatal 时按 `failure_class` 决策——可恢复类（进程崩溃/瞬时基础设施）重启 Kernel resume；不可恢复类（`assembly_fault`/合同失效）执行结构化终止并回传，run 不进入无主态。
4. **人审守护**：run 进入 `human_review` 等待期间，Controller 冻结该 PR 分支的 push（拒止/回滚，防 head 漂移饿死人审，run 8783807c 死因）；人审裁决后解冻。
5. **出口**：Controller 守到 PR merged + report 完成 → 回写 task result（`pr_url`/`merged`/终局摘要）→ 才退出。失败终局也必须结构化回传，禁无声消失。
6. **越权红线**：Controller 不亲自执行任何阶段工作（planner/proposer/generator/evaluator/judge 仍由 Kernel 派发），不绕 Gate、不改 Kernel 状态机权威。

<!-- Response Schema 由 Proposer 在 Step 1.1 读 api_registry 后推导，Planner 不负责定义技术规范。 -->

## 边界情况

- **Controller 先死**：lease 自然过期 → orphan-guard 兜底接管收尸（现有回归不回退）。
- **Kernel 反复崩溃**：可恢复类 resume 需有次数上限，超限转不可恢复类结构化终止（对齐 `orphan_requeue_count` 烧到 3 终态语义）。
- **ownership 竞争**：`controller_session_id` 必须在 createKernelRun 同一创建事务内 fail-closed 落库，避免两个 Controller 抢同一 run。
- **人审期间 CI 触发/外部 push**：冻结窗口内任何向 PR 分支的 push 都被拒止/回滚，裁决前 head 不得漂移。
- **merge 后进程孤儿**：回写未完成前 Controller 不得退出；回写失败必须结构化上报而非静默退出。

## 范围限定

**在范围内**：Controller 真身常驻进程（spawn/detach/ownership/lease 续租）、监护循环（存活+phase+PR/CI+failure_class 决策）、human_review push 冻结/解冻、终局 task result 回写与退出、failing test 永久进 CI。

**不在范围内**：Kernel 状态机本身改造、各阶段（planner/proposer/…）执行逻辑、orphan-guard 收割判据的重写（保持现有机制不动，仅降级为后备）、绕过任何 Gate。

## 假设

- [ASSUMPTION: Controller 为本机 detach 守护进程，与 Kernel 同机；跨机监护不在本 sprint。]
- [ASSUMPTION: lease 续租周期沿用现有 heartbeat 配置值（PrepPRD 未显式指定新值）；验收观测"两个续租周期"以现有周期为准。]
- [ASSUMPTION: 可恢复/不可恢复 failure_class 分类沿用现有 `failure_reason`/`assembly_fault` 语义，不新增分类枚举。]

## 预期受影响文件

- `packages/brain/src/harness-skill-relay.js`：`_spawnKernelRuntime`（先 spawn Controller）/`createKernelRun`（ownership 事务落库真实身份）改造。
- `packages/brain/src/lib/kernel-liveness.js`：Controller 监护循环复用/扩展存活与 heartbeat 评估。
- `packages/brain/src/lib/harness-run-guard.js`：orphan-guard 清场判据保持同源，仅确认降级为后备不回退。
- `packages/brain/src/lib/kernel-controller.js`（新增）：常驻 Controller 进程本体（认领→续租→监护→人审冻结→终局回写→退出）。
- `packages/brain/src/__tests__/integration/kernel-controller-lifecycle.pg.integration.test.js` / `kernel-controller-ownership.pg.integration.test.js`：failing test 扩展，永久进 CI，禁 mock 被改的边。

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空数组），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD/decisions 未指定 Controller 监护轮询间隔与续租周期具体值，沿用现有 heartbeat 配置）
- 频控: 待定（PrepPRD 未指定 Kernel resume 重启节流）
- 版本要求: 无
- 可观测: 失败终局必须结构化回传并写 Brain task result，禁无声消失（来源: 本 sprint 交付范围 4，硬约束）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(无 ability_id) + area 三源合并去重 -->
- [已有PR验时钟] 保留 validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时才建立一次共享 validation clock，缺失或不一致一律拒绝（来源: area）
- [证据窗口辨析] judge FAIL 先区分「证据压缩窗口截断（evidence_insufficient）」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证据而非判失败（来源: area）
- [只监护不执行] Controller 不亲自执行任何阶段工作，不绕 Gate、不改 Kernel 状态机权威（来源: 本 sprint 交付范围 5，硬约束）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述。最终可执行 E2E 脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + psql + ps/kill 观测进程）
# 期望验收点（自然语言）：
# 1. createKernelRun 后存在活 Controller 进程；DB 内 controller_session_id 指向它；观测两个续租周期 lease 被推进。
# 2. kill -9 Kernel 进程 → Controller 检测到 → 按可恢复类 resume 或不可恢复类结构化终止；run 不进入无主态。
# 3. kill -9 Controller → lease 过期 → orphan-guard 兜底接管收尸（现有回归不回退）。
# 4. run 进入 human_review 后向 PR 分支 push → 被 Controller 拒止/回滚；裁决后 push 恢复。
# 5. PR merge 后 Controller 完成回写才退出；task.result 含 pr_url + merged。
```

## journey_type: autonomous
## journey_type_reason: 改动集中在 packages/brain/ 的 harness 运行时编排（进程 spawn/lease/监护），无 UI、无远端 agent 协议、非 engine，属纯后端自治流程。
## target_environment: local_api
## target_environment_reason: 验收为 Brain 内部进程生命周期 + DB lease 状态，靠本地 evaluator 用 curl localhost:5221 + psql + 进程观测执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
