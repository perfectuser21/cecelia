# Sprint PRD — derive 取证死循环双修（recollect 护栏 trigger_sha 落库 + 新 evaluate PASS 必须重派 judge）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 P0 生产烧钱死循环，kernel harness 派单闭环更可信）

## 背景

Brain issue dbea513f（P0）：derive 在「证据不足」失败类下陷入取证死循环，run 06e4566c 每 ~10min 空转一圈，持续烧算力。根因两条同源缺陷叠加，需同一 sprint 双修。关联 area invariant「judge FAIL evidence_insufficient 优先走 evaluator 补证轮」——补证机制本身正确，但缺护栏与状态排序，导致补证成功后无法收敛。

## Golden Path（核心场景）

系统从 [judge 判 evidence_insufficient] → 经过 [重派 evaluator 补证一次] → 到达 [补证成功则复核收敛 / 补证仍不足则落人审]，不再无限重派 evaluator。

具体（以 `packages/brain/src/orchestrator/derive.js` 的失败类路由为准）：
1. judge 判 FAIL(failure_class=evidence_insufficient) → derive 重派 evaluator（reason=judge_evidence_insufficient_recollect），且落库 observed 快照顶层含 `trigger_sha`（等于 currentHeadSha）。
2. evaluator 带新证据返回 evaluate PASS，且该 evaluate verdict 晚于最新 judge verdict → derive 走 `evaluate_passed_awaiting_judge` 派 judge 复核新证据（而非再进 evidence_insufficient 或其他 failure_class 分支）。
3. 若 recollect 后仍判 evidence_insufficient（同 SHA 已补证过一次）→ 防死循环 guard 命中，落 WAIT_HUMAN_REVIEW(reason=evidence_insufficient_after_recollect)，不再第三次重派 evaluator。

## 边界情况

- 补证成功但 evaluate verdict 早于/等于最新 judge verdict（无更新证据）→ 不误判为 awaiting_judge，仍按既有失败类路由。
- observed 快照缺顶层 trigger_sha（历史/旧调用路径）→ guard 兜底回退用 `observed.pr.head_sha` 匹配 currentHeadSha，仍能触发。
- 同一 SHA 多轮 judge/evaluate 交替 → 以 SHA + verdict 时序为准，避免陈旧 judge FAIL 遮蔽新 evaluate PASS。

## 范围限定

**在范围内**：仅 `packages/brain/src/orchestrator/derive.js` 的失败类路由/护栏字段/状态排序，及其 `__tests__` 单测。
**不在范围内**：gates / dispatcher / execution-contract；decision_log append-only 触发器；不引入任何轮数上限常量（GAN 无上限是刻意设计）。

## 假设

- [ASSUMPTION: evaluate/judge verdict 均可比较新旧（按 decision_log 落库时序或 verdict 时间戳），用于判定「晚于最新 judge」]
- [ASSUMPTION: spawn:evaluator 落库路径可在 observed 顶层写入 trigger_sha，不破坏既有 observed 结构消费方]

## 预期受影响文件

- `packages/brain/src/orchestrator/derive.js`：failure_class=evidence_insufficient 分支护栏字段（~906 行 trigger_sha 匹配）+ evaluate_passed_awaiting_judge 状态排序
- `packages/brain/src/orchestrator/__tests__/derive.test.js`：新增两条复现序列的 failing→green 回归断言

## NFR 约束

<!-- 来源: decisions category=nfr（step 空 / feature 空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不引入轮数上限常量（thin_prd 明确禁止）
- 版本要求: 无
- 可观测: 每次路由决策必须写 decision_log（append-only，收敛/落人审动作可复查）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/feature 源为空） -->
- [证据不足补证] judge FAIL evidence_insufficient 时优先走 evaluator 补证轮，而非改代码（来源: area）
- [验证时钟 fail-closed] Kernel 保留 validation_clock_required 默认 fail-closed，缺失或不一致一律拒绝（来源: area）
- [证据窗口] judge 证据消费窗口为前 8 条 × 600 字符，一手证据须排序进窗口前列（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本 journey 现有 ability 均为 planned 状态，无 done/working 历史 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿留占位；最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填入（node/vitest 单测）。

```bash
# 占位：proposer 将填入真实脚本（local_api → 直接跑 derive 单测）
# 期望验收点（自然语言）：
#  1) 喂 run 06e4566c 序列（judge FAIL evidence_insufficient → spawn:evaluator recollect → evaluate PASS）
#     给 derive，断言下一动作为 spawn:judge（evaluate_passed_awaiting_judge），而非再次 spawn:evaluator。
#  2) 造「recollect 后仍 FAIL」序列，断言第二次落 WAIT_HUMAN_REVIEW(reason=evidence_insufficient_after_recollect)，
#     而非第三次 recollect。
#  3) 现有 derive 全量单测不回归（绿态）。
```

## journey_type: autonomous
## journey_type_reason: 仅改 packages/brain 后端 orchestrator 决策逻辑，无 UI / 无远端 agent 协议。
## target_environment: local_api
## target_environment_reason: Brain 内部纯后端逻辑，E2E = 本地 node/vitest 跑 derive 单测（localhost:5221 无需真派单）。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 36121154-5e52-4b20-a2cd-2f415ee72fac
