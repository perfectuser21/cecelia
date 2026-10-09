## Brain {VERSION} — coding harness evaluator 真人 QA：在 PR 预览环境黑盒验收

- 决策 02d8e749：evaluator 是 CI 绿后、合并前的门，像真人 QA 一样在真实环境里验。新增 evaluate 活动（本 PR 只做活动本身，接入 runner 在下一步）。
- 环境：lib/preview.mjs 查 PR 预览环境（MMV :5241 /api/brain/preview/status/<pr>，PR 版本 Brain + 打包 Dashboard + 克隆库，隔离运行时），等到 active；不可用 → retryable preview_unavailable。
- 黑盒：全新 Opus 会话只拿 01 需求与 02 的 QA 场景 Q-n，运行期间 03/04（开发自述与自测）藏起；按 Q-n 逐条测（### T-n）+ 探索式测试（### X-n，FAIL 必须带严重度与场景），写 05-qa-report-r<round>.md。
- 程序判（lib/qa-report.mjs）：格式与 Q-n 覆盖（qa_report_invalid / qa_incomplete）→ 碰生产 Brain（5221 / us-vps）fatal evaluate_touched_production → 单元测试当证据 qa_unit_test_evidence → 证据须在执行记录里 qa_evidence_unverified → T-n 全 PASS 且无 FAIL 的阻断/重要发现才 PASS；产品 FAIL 是正常结果（completed + outputs.qa.verdict=FAIL，交修复环）。
- lib/evidence.mjs parseEvidence 支持条目前缀与对应 ID 规则参数；证据输出摘录允许用 `...`/`…` 省略长行中间，但每段须按序出自真实结果（verify 同样受益）。
- 真实 Opus 试跑（PR #6117 预览环境）：两条计划场景 PASS；探索式测试发现非法任务 id 时 GET /api/brain/tasks/:id 返回 500 并泄露数据库报错（重要）→ 判 FAIL，花费 $0.47。
