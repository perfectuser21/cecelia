# Sprint PRD — Kernel 唯一 Merge Authority 收归

## OKR 对齐

- **对应 KR**：KR-基础稳固（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：将 Harness 合并授权从可变标题/分支名提升为 SHA 绑定的可信证据链，降低未授权合并风险

## 背景

当前 Harness merge authority 仍存在标题型 CI 旁路、可被 PR 修改脚本参与授权判断、人工批准未写入 human_review 决策、merge 未原子锁定 head SHA 等缺口。该任务要把 Kernel-owned PR 的授权证据统一收归到 repo + pr_number + run_id + head_sha，并让 evaluator、judge、human approval 与 merge 全部绑定 current SHA，避免普通 PR 被误分类，也避免批准后 head 漂移仍被合并。

## Golden Path（核心场景）

Kernel run 针对当前 sprint 生成一个 Kernel-owned PR，系统只接受与该 PR 当前 head SHA 绑定的 evaluator、judge、human_review 证据，并只允许 Kernel 路径在 head 未变化时完成 merge。

具体：
1. Kernel 为某个 `repo + pr_number + run_id + head_sha` 进入待审状态，`review_required=true` 时系统要求人工走 authenticated approve/reject。
2. 人工批准或拒绝请求到达后，系统原子校验 task、run、PR、current head SHA 与请求体一致；校验通过才写入带 `approved_by`、`pr_head_sha`、`source`、`timestamp` 的 `human_review` 决策，任一不匹配则拒绝且不写批准。
3. 进入 merge 时，系统只接受当前 PR head 与 evaluator/judge/human_review 已锚定 SHA 完全一致的 Kernel-owned PR，并以 compare-and-merge 或 `gh --match-head-commit` 原子锁定 merge head；一旦 head 改变，既有评审与批准全部失效，必须重新跑证据链。

## 边界情况

- 缺 token、缺 SHA、stale SHA、run/PR/task 不匹配时必须拒绝批准且不写 `human_review` 批准记录
- `review_required=false` 的普通修复流不能因为标题含 `feat(harness)` 或分支名前缀被误判为 Kernel-owned PR
- PR 标题大小写、空格、改名、body 改动、PR 内脚本篡改都不能改变 merge authority
- gate 通过后到 merge 前若 head 发生变化，merge 必须失败并要求重新 evaluator、judge、human approve
- draft 状态只能作为防御纵深，不能作为是否允许合并的唯一授权依据

## 范围限定

**在范围内**：Kernel-owned PR 的 ownership 判定、approved/rejected 路由鉴权与原子校验、`human_review` 决策落账、per-SHA Merge Gate、merge 时 head 锁定、legacy merge caller 与 CI 旁路 fail-closed、相关 TDD Red→Green
**不在范围内**：修改或复用 PR #4372、引入与本任务无关的新 merge 入口、在无必要时新增 schema migration、改变普通非 Kernel PR 的正常开发流程

## 假设

- [ASSUMPTION: 现有 decision log 或 run 字段足以承载 `approved_by`、`pr_head_sha`、`source`、`timestamp`，若不足再由 proposer 明确最小补充方案]
- [ASSUMPTION: 当前 Kernel merge 路径位于 Brain 后端与 Harness CI gate，不需要新增前端页面才能完成首次闭环]

## 预期受影响文件

- `packages/brain/src/routes/harness-kernel-approvals.js`: 承载 authenticated approve/reject 与 SHA 绑定校验
- `packages/brain/src/lib/harness-finalize.js`: 承载 merge 前 compare-and-merge 或 `--match-head-commit` 锁定
- `packages/brain/src/harness-ci-gate.js`: 移除标题/分支名型旁路并改为可信 ownership 证据
- `packages/brain/src/orchestrator/decision-log.js`: 写入 `human_review` 决策证据
- `packages/brain/src/routes/__tests__/harness-kernel-approvals.test.js`: 覆盖 stale SHA、缺 token、run/PR 不匹配等拒绝路径
- `packages/brain/src/lib/__tests__/harness-finalize.test.js`: 覆盖 head 漂移失效与原子 merge 锁定

## Invariant 约束（铁律，proposer/evaluator 不得违反）

- [SHA锚定] PR 被 `should-auto-merge.sh` 等 CI 侧兜底机制提前合并时，必须核对 evaluator/judge verdict 锚定的 head SHA 与实际合并 SHA 一致（来源: area）
- [任务锚定] headed relay 点火时必须把 `base_repo` 或 `pr_url` 写入 task payload，且分支名带 task short id，否则 finalize 与 watchdog 会失明（来源: area）
- [鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [成功判定] 通知/写库接口的成功判定必须看语义字段，不能只看通用 `ok:true`（来源: area）
- [环境路由] `target_environment` 以 DB `tasks.payload` 为准，不从本地文件读取（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

（本 line 暂无历史）

## NFR 约束

- 超时/延迟: 待定（PrepPRD 未指定明确秒数；approve/reject 与 merge 校验需在单次请求内完成原子判定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: 成功批准必须写入 `human_review` 决策并带 `approved_by`、`pr_head_sha`、`source`、`timestamp`；拒绝路径必须留下可追踪失败原因；merge 必须能追溯所用 head SHA

## E2E 验收

```bash
# 占位：proposer 将按 target_environment 填入真实脚本（local_api→curl+psql / mac_web→Playwright / windows_*→ps1）
# 期望验收点（自然语言）：
# 1. 标题大小写/空格/改名、branch 前缀或 PR 内脚本修改，都不能让普通 PR 获得 Harness merge authority。
# 2. review_required=true 且没有有效 human_review 批准时，所有 merge caller 都被拒绝。
# 3. 人工以 SHA=A 批准后，如果 PR head 推进到 SHA=B，则 evaluator、judge、human approval 全部失效，merge 被拒绝。
# 4. approve/reject 只有在 task、run、PR、current head 全匹配且鉴权通过时才落账；缺 token、缺 SHA、stale SHA、run/PR 不匹配全部拒绝且不写批准。
# 5. merge 必须以 compare-and-merge 或 --match-head-commit 原子锁定 head，阻断 gate/merge TOCTOU。
```

## journey_type: autonomous
## journey_type_reason: 任务聚焦 `packages/brain/` 的 Harness/Kernel 合并授权与后端决策链，属于纯后端自治流程
## target_environment: local_api
## target_environment_reason: payload 已显式给出 `local_api`，验收应在本地 Brain API 与测试环境完成
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: a6888ef3-2482-4655-8703-cf3b9f037cb9
