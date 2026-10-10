## Brain {VERSION} — coding harness：重试带上次的问题，原地打转要求换思路

- 决策 a1fdbc51 审计 P2 #33（旧 harness「BLOCKED 必须改变某样东西，绝不无变化重试」）：
  - spec：上次写出的 02 没通过校验，重跑时 prompt 的 `PREV_ERRORS` 列出这些校验问题；
  - spec_review：每次评审、改写都带当前 02 的程序校验问题 `SPEC_ERRORS`；评审格式被打回时，重评带 `PREV_REVIEW_ERRORS`；
  - QA 门：评估报告不合格时记下原因（`last_eval_error`），下一次 evaluate 带上 `prev_errors`，评估成功后清掉。canary 2（#6160）第 1 轮就是 T-5 的命令在执行记录里查不到。
- 审计 P2 #27（旧 reviewer「Pivot vs Refine」）：总分连续两轮不涨时 `STUCK=是`。评审必须写 `## 换思路`，没写按格式不合格打回；改写方必须在回应开头表态采纳或不采纳。结局仍由走势（发散/震荡）判定。
