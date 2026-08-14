# Sprint PRD — 修复 Coding 合并身份闸与 AI 验收闭环（fail-closed merge authority）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（堵住"裁判说不放行、代码仍被 merge"的合并权威漏洞）

## 背景

法源 decision=e4e37f10-66ae-4862-a8d6-c5242ea17e05：Coding 合并唯一权威必须 fail-closed。
生产事故 PR #4870（title=fix(harness):，head=0a6ed21c，merged_at 2026-08-13T10:43:28Z）在
run a2e10f0f phase=generate、Generator attempt c3931f6b running、Evaluator/Judge=0 时被通用 CI
auto-merge 抢先合并；约 72 秒后 Kernel 取消 Generator 并把 run 记 done / task 记 completed（假成功）。
根因之一：`should-auto-merge.sh` 只识别精确 `feat(harness):` 标题，其余 cp-*（含 fix(harness):）落入通用 MERGE。
前置 GP 身份 bug 已由 PR #4873 修复（生产 Brain git_sha=813dc7037c）。本刀恢复合并唯一权威并修正提前合并终态与 Impact Contract 状态机。

## Golden Path（核心场景）

系统从 [PR 就绪] → 经过 [身份闸判定 + AI 验收闭环] → 到达 [仅受权威授权才 merge，否则 fail-closed]

1. **RED-A 通用 auto-merge 身份闸**（`should-auto-merge.sh`）：
   - Harness identity 缺失 / 写入延迟 / 陈旧 head_sha / Brain 不可达 四态 → 输出 `SKIP`（fail-closed）
   - 普通 /dev：仅受信通道签发且精确绑定 repo+PR+head_sha 的 entitlement → 输出 `MERGE`
   - 通用 cp-*（无 entitlement）默认 → `SKIP`；label / 标题不能单独授权 merge
2. **RED-B 提前合并终态**（Kernel，`orchestrator/loop.js`）：
   - Generator running 且无同 head_sha 的 Evaluator/Judge 时 PR 被外部 merged → Kernel fail-closed 记 `premature_merge`
   - run 不得 done、task 不得 completed，并写可追责事件
3. **RED-C 合并权威**（Harness merge handler）：
   - 仅同一 PR head_sha 的 AI Evaluator PASS/FIXED receipt + 独立 Judge PASS receipt → 授权 Harness merge
   - 缺角色 / 旧 SHA / 被拒 callback / Brain 查询错误 → 一律拒绝（fail-closed）
4. **RED-D 合同状态机**（`materializeApprovedContract`，`orchestrator/contract-store.js`）：
   - 仅 draft 可换版；approved 同证据幂等；approved 不同证据报错；superseded / 未知状态报错，不得重激活

## 边界情况

- Brain API 不可达 / 超时 → 一律判 SKIP / 拒绝，绝不 fail-open 放行 merge
- entitlement 绑定的 head_sha 与 PR 当前 head_sha 不一致（force-push 后陈旧）→ SKIP
- Evaluator PASS 但 Judge 缺失 / Judge PASS 但 Evaluator 缺失 → 拒绝合并
- 外部人类在验收前手动 merge → premature_merge，不得回填成功终态
- 不得向不受信 runner 下发通用 internal token

## 范围限定

**在范围内**：should-auto-merge 身份闸判据、Kernel premature_merge 终态、Harness merge 权威门、materializeApprovedContract 状态机；四段永久 RED 测试（严格 TDD 先落 RED 再改实现）。
**不在范围内**：GP 合同身份闸（PR #4873 已修）；Evaluator/Judge agent 内部提示词改写；CI workflow 编排结构重排。

## 假设

- [ASSUMPTION: entitlement 由已有受信 /dev 通道签发，本刀消费其 repo+PR+head_sha 绑定，不新建签发通道]
- [ASSUMPTION: Harness merge handler 消费 Brain 侧 Evaluator/Judge receipt（同 head_sha），复用现有 validation-identity-policy / validation-clock 机制]
- [ASSUMPTION: PR 标题在本刀落地前保持 `feat(harness):` 前缀，确保旧标题保护生效]

## 预期受影响文件

- `.github/workflows/scripts/should-auto-merge.sh`：从"仅识别 feat(harness): 标题"改为 entitlement + 身份闸 fail-closed
- `.github/workflows/scripts/__tests__/should-auto-merge.test.sh`：RED-A 永久回归（四态 SKIP + entitlement MERGE + cp-* 默认 SKIP）
- `packages/brain/src/orchestrator/loop.js`：Kernel 提前合并 fail-closed 为 premature_merge，禁止假记 done/completed（RED-B）
- `packages/brain/src/orchestrator/validation-identity-policy.js`：合并权威身份/entitlement 判定（RED-A/C）
- `packages/brain/src/orchestrator/contract-store.js`：materializeApprovedContract 状态机四态守卫（RED-D）
- 对应 `__tests__/` / `*.test.js`：RED-B/C/D 永久回归测试

## Response Schema

<!-- 由 Proposer 在 Step 1.1 读 api_registry 后推导 should-auto-merge 输出契约（MERGE / SKIP:<原因>）与 receipt/verdict 字段名。Planner 不定义技术规范。 -->

## NFR 约束

<!-- 来源: decisions category=nfr 为空；PrepPRD/thin_prd 显式约束优先 -->
- 超时/延迟: Brain 查询超时视为不可达 → fail-closed SKIP（不 fail-open）
- 安全: 不得向不受信 runner 下发通用 internal token
- 可观测: premature_merge 与每次拒绝必须写可追责事件到 Brain
- 版本要求: 无

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decision e4e37f10（法源）+ area 级 + thin_prd 铁律，合并去重 -->
- [合并权威] Coding/Harness PR 合并授权一律 fail-closed；身份缺失/延迟/陈旧/Brain 不可达均不得放行（来源: decision e4e37f10）
- [受信通道] 普通 /dev 仅受信通道签发且绑定 repo+PR+head_sha 的 entitlement 可合并；label 仅展示投影，不授权（来源: decision e4e37f10）
- [同 head 验收] Harness PR 必须同一 head_sha 上独立 AI Evaluator PASS/FIXED + 独立 Judge PASS，最终仅 Harness merge handler 合并（来源: decision e4e37f10）
- [真实验收] AI Evaluator 必须像人一样独立读 PRD/合同/diff、复现 #4870 竞态并打真实 API/DB/脚本验收，CI 绿仅是机械必要条件（来源: thin_prd）
- [不假成功] Generator 被取消 / 外部提前合并时，run 不得 done、task 不得 completed（来源: thin_prd + area: Kernel existing PR evaluator validation clock adoption）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（curl localhost:5221 + psql + 直接跑 should-auto-merge.sh / vitest orchestrator 测试）。

```bash
# 占位：proposer 将填入 local_api 真实脚本
# 期望验收点（自然语言）：
# 1. 严格 TDD 证据：先见四段永久 RED（should-auto-merge.test.sh + contract-store/loop 测试）转红，再改实现转绿
# 2. RED-A：直接跑 should-auto-merge.sh，构造 identity 缺失/延迟/陈旧 head/Brain 不可达四态 → 均输出 SKIP；
#    受信 entitlement（repo+PR+head_sha 精确）→ MERGE；普通 cp-* 无 entitlement → SKIP；仅 label/标题 → 不授权
# 3. RED-B：模拟 Generator running + 无同 head Evaluator/Judge + 外部 merged → Kernel 记 premature_merge，
#    psql 查 run 非 done、task 非 completed，且落可追责事件
# 4. RED-C：同 head_sha Evaluator PASS/FIXED + Judge PASS → 授权 merge；缺角色/旧 SHA/被拒/Brain 错误 → 拒绝
# 5. RED-D：materializeApprovedContract 仅 draft 换版；approved 同证据幂等、不同证据报错；superseded/未知报错
```

## journey_type: autonomous
## journey_type_reason: 核心改动落在 packages/brain/orchestrator（Kernel/合同状态机）+ CI 合并脚本，无 UI/远端 agent 协议，属后端自治闭环
## target_environment: local_api
## target_environment_reason: 验收在本地 evaluator 跑 curl localhost:5221 + psql 查 run/task 终态 + 直接执行 should-auto-merge.sh 与 orchestrator vitest
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: none（PrepPRD 未锚定）
