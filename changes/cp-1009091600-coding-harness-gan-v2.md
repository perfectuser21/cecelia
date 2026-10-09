## Brain {VERSION} — coding harness 合同对抗 v2：QA 立场、带场景的问题、代码判分、不限轮数按走势收敛

- 决策 02d8e749 / 696c9f96：恢复已拍板的 GAN 设计——不设轮数上限，靠走势收敛（原 spec_review 写死最多 2 轮，违反 harness-gan-design）。
- spec_review 改为 QA 立场：只准提四类问题（做了也达不到 / 漏了真实路径 / 偷换需求 / 弄坏现有功能），每个问题带 针对、严重度（阻断/重要/建议）、场景、依据；阻断/重要缺场景或依据判评审不合格；措辞格式类不算问题。
- 每轮 5 维评分（意图对齐/可验证/场景覆盖/回归风险/可执行，0–10），程序判通过：5 维都 ≥7 且没有仍开着的阻断/重要问题（lib/gan.mjs decide），不信 AI 自报结论。
- 开发方逐条采纳/驳回（02-response-rN.md），QA 下一轮对上轮仍开着的问题逐条 关闭/坚持；坚持的仍算开着。
- 收敛：lib/gan.mjs detectTrend 移植 harness-gan.graph.js detectConvergenceTrend（最近 3 轮震荡/走低；规格连续变长且总分没涨算发散），发散/震荡 → 强制通过（gan.verdict=FORCED）+ `[coding-gan][P1]` + outputs.escalations 升级给 coding commander。
- 只有真坏掉才中止：评审连续 3 次格式不合格（review_invalid）、累计花费超 CODING_WF_GAN_BUDGET_USD（默认 $20，gan_budget_exceeded）、claude 失败、越界写、01 被改。spec_review 时间预算 1800s → 21600s。
- 每轮留 02-review-rN.md / 02-response-rN.md，最终一轮另存 02-review.md；PR 正文「合同对抗」小节写轮数、结论与走势、最终评分、末轮问题严重度，强制通过醒目标出仍开着的问题；report 把 gan 摘要与 escalations 回写 Brain result.coding_workflow。
