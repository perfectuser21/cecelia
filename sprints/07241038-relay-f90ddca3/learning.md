# Learning — headed relay 派发链路自测（claude-headed, task f90ddca3）

## 运行指标

- GAN 轮次：1（r1 即 APPROVED，rubric 7 维全≥8，judgments_written=4）
- Evaluator Fix 次数：0（evaluator 一次 PASS；judge 首轮 mechFail 打回 1 次，补字段后重判通过）
- 总成本：$0（未采集——relay-runs 两行 cost_usd 均为 0.00，controller 拿不到 subagent 真实成本，台账注明 cost=unsettled）
- PR：https://github.com/perfectuser21/cecelia/pull/4315（squash merge c408b208d，CI 全绿）
- Sprint Dir：sprints/07241038-relay-f90ddca3

## 发现的问题

### [PROMPT] Prompt 类问题

- 现象：task payload 无 prep_prd_body，planner 没有 PrepPRD 输入 → 根因：headed-smoke-test 属链路自测任务，派发时就没写 PrepPRD（已知情况非缺陷）→ 修法：planner 用 title + payload 三元组 + 先例（7630f4fb / #4109 / #3970）锚定需求，产出 sprint-prd 53 条 invariants，GAN r1 即通过，证明该 fallback 路径可用。

### [BUG] 代码缺陷

- 现象：judge 首轮打回 mechFail=missing_exit_code → 根因：evaluator 产出的 verdict JSON 顶层缺 exit_code / log_tail 字段，不满足 judge 机械校验的字段契约 → 修法：evaluator 补写顶层 exit_code/log_tail 后重判 PASS；根治应把这两个字段写进 evaluator verdict 输出模板的必填项。

### [INFRA] 基础设施问题

- 现象：前次 run 被 watchdog 标 failed（failure_reason=watchdog_overdue），无 PR 产出 → 根因：relay run 超 8h deadline，orchestrator 无心跳 → 修法：orphan requeue #1 后 controller 先做外部真相核查（确认无 open/merged PR、无 sprint 目录）再从 Step 1 从头开跑，本次实证该恢复路径安全可用。
- 现象：report 阶段调 POST /api/brain/harness/complete 被拒（accepted:false, reason=initiative_run_not_done: phase=evaluate）→ 根因：relay run 的 phase 在 merge/report 阶段未推进，仍停在 evaluate，complete 端点按 phase 闸门拒绝翻牌 → 修法：controller 或 Brain 应在 merge done 后推进 relay run phase（或 complete 端点放行 evaluate_verdict=PASS 且 judge_verdict=PASS 的 run）。
- 现象：飞书通知接口返回 {"ok":true,"sent":false}，通知未真实送达 → 根因：notify 端点 ok 只代表请求受理，sent 才代表投递；判定送达不能只 grep "ok":true → 修法：报告脚本改为核验 sent 字段，并排查 webhook 配置为何未投递。

### [DESIGN] 设计缺陷

- 现象：relay-runs 台账 cost_usd 全程 0.00 → 根因：controller 无法获取 subagent 真实 token 成本，无回传通道 → 修法：需要 subagent 成本回传机制（九要素 T7 phase-event 复活后追加 token 用量），当前一律注明 cost=unsettled，避免 0 被当成真实成本。

## 下次预防清单

- [ ] evaluator verdict 输出模板把顶层 exit_code / log_tail 列为必填，杜绝 judge mechFail=missing_exit_code 打回重判
- [ ] merge 完成后推进 relay run phase（或改 harness/complete 闸门逻辑），否则 report 阶段 Dashboard 翻牌必然被拒
- [ ] 通知/写库类接口的成功判定看语义字段（sent / accepted），不要只 grep "ok":true
- [ ] relay 成本记账为 0 时在 result 与台账显式标 cost=unsettled，直到 subagent 成本回传落地
