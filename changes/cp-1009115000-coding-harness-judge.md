## Brain {VERSION} — coding harness 独立裁判：真人 QA PASS 后不同模型复核，PASS 才合并

- 决策 02d8e749 ②d：QA 门里真人 QA PASS 后、开自动合并前，加独立裁判（lib/judge.mjs + runner/lib/judge-gate.mjs）。裁判用不同于开发/QA 的模型（默认与 Brain 现役裁判一致 gpt-5.6-sol，CODING_WF_JUDGE_MODEL/TOAPIS_JUDGE_MODEL 可改；ToAPIs 凭据运行时从 ~/.credentials/toapis.env 读），复核「需求 01 + 合同 02 + QA 报告 05 + PR 代码改动（不含 sprints/）」，逐条判 I-n 是否真被满足，裁决写 `06-judge-r<round>.md` 随 QA 报告提交进 PR。
- 程序裁决（不信模型自报）：每条 I-n 都满足且没有阻断/重要问题才 PASS；判某条不满足必须给出对应的阻断/重要问题。问题三类：product → 开发按裁决 TDD 修复（qa-fix 环）；qa_gap → 下一轮 QA 带着裁决补验（evaluate 新增 judge_feedback 输入）；contract_gap → 升级 coding commander（judge_contract_gap）。
- 裁判不可用/输出不合格：QA 报告照常提交（"独立裁判待定"），下轮只重跑裁判、不重跑 QA；连续 3 次升级 qa_judge_unavailable。裁判 FAIL 计入不收敛判定（qa_stalled）。CODING_WF_JUDGE=0 关闭裁判（QA PASS 直接合并）。
- 裁判提示词只追究用户真实受影响的问题，不抠字面（真模型三情形实测：如实通过→PASS、QA 漏验→qa_insufficient、QA 看错→product_failure）。
