# Sprint PRD — derive 取证死循环双修（recollect 护栏 trigger_sha 落库 + 新 evaluate PASS 必须重派 judge）

## OKR 对齐

- **对应 KR**：KR-Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+1%（止住 P0 生产烧钱死循环）

## 背景

Brain issue dbea513f（P0）：derive 证据不足取证死循环，run 06e4566c 每 ~10min 空转一圈，持续烧钱。
实证（PR #4793，decision_log 可复查）：01:33 judge 判 FAIL(failure_class=evidence_insufficient) → derive 正确重派 evaluator；01:41 evaluator 带新证据返回 PASS → derive 本应派 judge 复核，实际再次 spawn:evaluator(recollect, hop 40)；01:54 又 spawn:evaluator(hop 44)。judge 自 01:33 后再未被派出，无限循环。根因两处：护栏字段没落库 + 陈旧 judge FAIL 遮蔽新 evaluate PASS。

## Golden Path（核心场景）

系统（derive 决策函数）从 [judge FAIL evidence_insufficient] → 经过 [recollect 补证 → evaluate PASS] → 到达 [派 judge 复核新证据（不再空转）]

具体：
1. [触发条件] decisionLog 序列：judge 判 FAIL(failure_class=evidence_insufficient) → spawn:evaluator(recollect) → evaluator 返回 evaluate PASS（该 PASS verdict 晚于最新 judge verdict，且锚定当前 head_sha）
2. [系统处理] derive 检测到存在"晚于最新 judge verdict 的 evaluate verdict"，走 evaluate_passed_awaiting_judge 分支，而非再次命中陈旧 judge 的 failure_class recollect 分支
3. [可观测结果] derive 返回的下一动作是 `spawn:judge`（复核新证据），死循环终止

第二条护栏：
1. [触发条件] spawn:evaluator 落库 observed 快照
2. [系统处理] 快照顶层写入 trigger_sha；且防死循环 guard 匹配时 trigger_sha 优先、缺失回退 observed.pr.head_sha 兜底
3. [可观测结果] recollect 后仍 FAIL 的序列，第二次判定落 `WAIT_HUMAN_REVIEW(evidence_insufficient_after_recollect)`，而不是第三次 recollect

## 边界情况

- recollect 后 evaluator 仍返回 FAIL（非 PASS）→ 不得无限 recollect，落 WAIT_HUMAN_REVIEW(evidence_insufficient_after_recollect)
- observed 快照顶层无 trigger_sha（历史落库格式）→ guard 回退 observed.pr.head_sha 匹配，不因字段缺失而永不触发
- evaluate PASS verdict 早于/等于最新 judge verdict（非 recollect 场景）→ 不误触发 awaiting_judge，保持既有分支排序

## 范围限定

**在范围内**：
- `packages/brain/src/orchestrator/derive.js`：护栏字段落库 + guard 兜底匹配；evaluate_passed_awaiting_judge 分支优先于陈旧 judge failure_class 分支
- `derive.test.js`：两条复现序列断言

**不在范围内**：
- 不动 gates / dispatcher / execution-contract
- 不动 decision_log append-only 触发器
- 不引入轮数上限常量（GAN 无上限是刻意设计），只修状态排序与护栏字段

## 假设

- [ASSUMPTION: guard 修法采纳"双做"——spawn 时把 trigger_sha 写进 observed，且 guard 兜底回退 observed.pr.head_sha 匹配（thin_prd 允许二选一或双做，双做最稳）]
- [ASSUMPTION: evaluate_passed_awaiting_judge 的判定口径 = 存在晚于最新 judge verdict 且锚定 currentHeadSha 的 evaluate PASS verdict]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`: 护栏字段落库 + guard 兜底 + evaluate_passed_awaiting_judge 分支排序（~906 guard 行、hasNewerEvaluatePassThanJudge / recollectSnapshotMatchesHead 附近）
- `packages/brain/src/orchestrator/__tests__/derive.test.js`: 新增两条复现 failing test，永久入 CI

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先。step/feature 两源均空数组，无显式 NFR。 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 待定（PrepPRD 未指定）
- 版本要求: 无
- 可观测: derive 分支决策依赖 decision_log（append-only），修复不得破坏其可复查性

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step/journey_feature 两源空；下列取 area 级中与本 sprint 直接相关者 -->
- [证据不足优先补证] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（来源: area）
- [existing-PR 验证时钟] validation_clock_required 默认 fail-closed；仅 gear=hotfix 且 payload pr_url/pr_head_sha 与 GitHub 实时观测完全一致时首个 Evaluator intent 可建共享 clock，后续 Judge 复用（来源: area）
- [judge 结果格式] Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]（每条含 exit_code + log_tail）（来源: area）
- [judge 证据窗口] judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据放前部（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path。/journeys/:id/golden-paths 返回空数组，无已沉淀累积 FR。 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（node vitest 单测，无需真机/浏览器）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 直接跑 derive 单测 + 全量回归）
# 期望验收点（自然语言）：
#   1. 喂 run 06e4566c 序列（judge FAIL evidence_insufficient → spawn:evaluator recollect → evaluate PASS），
#      断言 derive 下一动作 == spawn:judge（非再 spawn:evaluator）
#   2. 喂 "recollect 后仍 FAIL" 序列，断言第二次判定 == WAIT_HUMAN_REVIEW(evidence_insufficient_after_recollect)（非第三次 recollect）
#   3. derive 现有全量测试不回归（derive.test.js 全绿）
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain 后端决策函数 derive.js，无 UI / 无远端 agent 协议 / 无 engine hooks
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端逻辑，验证形态为本地 vitest 单测 + curl localhost:5221（本地 evaluator）
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
