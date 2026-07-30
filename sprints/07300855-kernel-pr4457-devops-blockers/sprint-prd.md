# Sprint PRD — Draft PR #4457 四个 DevOps blocker 等价修复

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：通过消除四个 DevOps blocker 提升累计 Kernel 分支的可验证性；不虚报百分比增量。

## 背景

现有 Draft PR #4457、分支 `cp-kernel-phase5b-a1-review-fixes`、基线 SHA `c0cd82fe298a8d1df812699507709d564a296f4e` 的首次完整 pre-push 暴露四个相互独立的 blocker。本 sprint 只修复 QuickCheck false-pass、原生 node:test 误收集、OKR integration 误连生产 Brain、migration 历史窗口吸入 382，并形成真实等价证明。

## Golden Path（核心场景）

维护者从现有 Draft PR #4457 的四个已确认 blocker 入口 → 按合同完成 Red/Green 与聚焦回归 → CI、evaluator 与 judge 给出锚定同一 PR head 的可信结果，PR 保持 Draft 等待主理人人工批准。

具体：
1. QuickCheck 面对大输出真实失败时返回非零；未知非零失败 fail-closed；只有明确 OOM/worker 签名、有 pass summary 且无 fail summary 时才保留降级。
2. `node:test` mutation seam 仅由原生 runner 执行，Vitest 不再收集；`test:node` 登记与自动 ratchet 同时覆盖该文件。
3. OKR integration 在测试进程内通过 Express/Supertest 调用真实 router，并与 fixture 共同绑定 `cecelia_test`；不得调用生产 Brain 或生产数据库 `cecelia`。
4. historical migration fixture 精确执行 369–381，382 不混入该随机 schema fixture；382 专属验证继续通过，生产 migration SQL 不变。
5. 四项各自留下先 RED 后 GREEN 的证据，统一验证全绿；atomic check 仍诚实报告 `schema_valid=true`、`proof_complete=false`、`atomic_cutover_ready=false`、live proof `0/99`，manual cutover gate 仍返回非零。
6. evaluator 真跑并由 judge PASS 后，只更新既有 Draft PR #4457；首次变更 merge 前停在主理人人工批准门，禁止创建重复 PR、Ready、merge 或 deploy。

## 边界情况

- QuickCheck 日志含 ANSI、超大输出、失败文件/失败测试摘要或未知 runner 非零退出时，不得因 SIGPIPE 或模糊文本分类而假绿。
- 只有 OOM/worker 正向信号、通过摘要、无任何失败摘要三项同时成立，才允许兼容性降级。
- 测试数据库 preflight 不是 `cecelia_test` 时立即失败，不允许回退到 `BRAIN_URL`。
- 新增 migration 382 及以后不得改变 historical 369–381 fixture 的应用集合。
- 任一验证不确定、runner 异常、PR head 不一致或人工门未批准时均保持 Draft 和 blocker。

## 范围限定

**在范围内**：四个 blocker 的回归合同、Red/Green 修复、聚焦及统一验证、既有 Draft PR #4457 状态更新。

**不在范围内**：Kernel cutover、receipt v2、controller 权威边界调整、synthetic/legacy receipt 计数、migration 381/382 生产 SQL 或 Brain schema version 修改、新 migration 383、创建新 PR、merge 与 deploy。

## 假设

- [ASSUMPTION: payload 中 `anchor.step_id` 是本 sprint 的 Golden Path 锚点；task 顶层 ability_id 为空不影响 step 锚定。]
- [ASSUMPTION: “CI 全绿”指既有 Draft PR #4457 在同一最终 head 上的必需检查，不以其他 SHA 或重复 PR 的结果替代。]

## 预期受影响文件

- `scripts/quickcheck.sh`: 修正 Vitest 退出分类与临时日志生命周期。
- `packages/engine/tests/scripts/quickcheck-vitest-exit-classification.test.ts`: 固化真实失败与 genuine OOM 分类。
- `packages/brain/src/__tests__/native-node-test-runner-registration.test.js`: 检查原生测试双登记完整性。
- `packages/brain/vitest.config.js`: 从 Vitest 排除 mutation seam。
- `packages/brain/package.json`: 将 mutation seam 登记到 `test:node`。
- `packages/brain/src/__tests__/okr-decomposition-flow.integration.test.js`: 改为绑定 `cecelia_test` 的进程内 Express/Supertest。
- `packages/brain/src/__tests__/kernel-release-runs.integration.test.js`: 冻结 historical 369–381 migration window 并断言 382 未偷跑。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先；两路 decisions 查询均为空。 -->
- 超时/延迟: 由 task payload 约束整轮最长 28800 秒；单项未另行指定。
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 基于 Draft PR #4457 的指定分支与 SHA；不得漂移到其他 PR/head。
- 可观测: 保留 runner 真实 exit code、失败响应 body、Red/Green、focused regression、CI、evaluator、judge 与人工门证据。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；step/feature 为空。以下列出与本 sprint 直接适用的 area 铁律；其余 active area 决策仍由下游通用门禁执行。 -->
- [真环境验证] 依赖真实调用方的接缝断言必须在真目标上验证；未真验不得标 done（来源: area）
- [禁止环境假设] 环境假设值不得写死，必须从环境推导或真实校准（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 与聊天内容不得明文进日志（来源: area）
- [租户隔离] 碰租户数据的查询或写入必须限定当前租户，禁止跨租户混读混写（来源: area）
- [测试多租户] 单元与 E2E 默认至少两个租户并断言互不串扰（来源: area）
- [失败闭合] 部署链任何失败路径必须显式失败并返回非零，不得 warning 降级（来源: area）
- [真实退出码] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器启动（来源: area）
- [同义一致] 同一语义在判变端与终验端必须采用相同策略，禁止跨脚本语义分叉形成假绿（来源: area）
- [PR头对账] evaluator/judge 结果必须以 PR head SHA 对账，禁止使用其他 SHA 的结论（来源: area）
- [控制器合并权] generator 只推送分支并报告 ready，不得自行 merge PR（来源: area）
- [单槽串行] 一个 slot 内任务严格串行；同一时刻只允许一个写代码的实现者（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## E2E 验收

```bash
# 占位：proposer 将按 local_api 填入真实脚本。
# 期望验收点：在指定 Draft PR #4457 最终 head 上真跑四项 focused regression、Engine/Brain/PR-tier CI、
# atomic 与 manual cutover gate；四项 blocker 均给出预期结果，0/99 与 gate 非零保持诚实，
# PR 仍为 Draft、auto-merge 为空，且未访问生产 Brain/cecelia、未修改生产 migration SQL。
```

## journey_type: autonomous
## journey_type_reason: 变更集中在 Cecelia Engine、Brain 后端测试与 CI 验证，无用户界面路径。
## target_environment: local_api
## target_environment_reason: payload 明确指定 local_api，后端测试与本地 PostgreSQL/runner 在 evaluator 本机执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: aad25bdb-bdd6-47f4-9a99-e1176e23ac8b
