## Brain {VERSION} — coding harness runner 接 evaluator 门：CI 绿后真人 QA，PASS 才合并，FAIL 修复环

- 决策 02d8e749：CI 绿不再直接合并。runner 开 PR 后只 ready（CODING_WF_QA_GATE=0 恢复旧行为）；每轮顺序：对账 → CI 红自动修 → **QA 门** → 认领新任务。
- QA 门（runner/lib/qa-gate.mjs）：自己开的 cw PR 必需检查全绿、未通过 QA、当前 head 没验过 → 查 PR 预览环境（不存在则带 DEPLOY_TOKEN 请求启动；容量拒绝超 CODING_WF_QA_PREVIEW_ESCALATE_MS 默认 60 分钟升级）→ 检出 PR 版本跑 evaluate 活动 → 05 报告提交推送进 PR。
- PASS：gh pr merge --auto --squash；合并后停掉该 PR 预览环境释放容量。FAIL：开发按 QA 报告 TDD 修复（prompts/qa-fix.md，不许碰 sprints/ 与 agent 配置、不许放宽断言），程序核对后推送 → CI → 再验，不设轮数上限。
- 升级给 coding commander（`[coding-qa][P1]`，Brain result.escalations）：失败数连续 3 轮不降（qa_stalled）、评估会话连续 3 次出错或致命错误（qa_evaluator_broken）、预览环境长期起不来（qa_preview_unavailable）、PR 找不到 sprint（qa_sprint_missing）。状态 <logDir>/qa-<pr>.json，Brain result.qa 摘要。
- runner.sh 运行时从 ~/.credentials/cecelia-deploy-token.env 读 DEPLOY_TOKEN（不进代码与 plist）。抽出 runner/lib/pr-branch.mjs（检出 PR 分支、读 sprint、核对修复提交、推送）与 listOwnPrs/requiredState，CI 修复与 QA 门共用。
