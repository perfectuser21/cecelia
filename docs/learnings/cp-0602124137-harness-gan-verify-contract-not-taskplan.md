# harness GAN verifyProposer 验错产物致 pipeline 永不收敛（2026-06-02）

## 背景

补跑 harness 验证 run（task 85fd1002）时，GAN 合同轮反复 `proposer_didnt_push` →
连续 2 轮 ABORT `proposer_repeatedly_didnt_push`，pipeline 永远进不了 generator。
proposer 容器 exit 0、真实产出了 contract-draft.md + 实现代码（r1 分支可见），并非 429 空转。

## 根本原因

GAN 合同轮 proposer 节点的 `verifyProposer` 默认接成 `verifyProposerOutput`
（`contract-verify.js`，校验 origin 分支上的 `sprintDir/task-plan.json`）。

但 GAN 每轮 proposer 的**真实交付物是合同**（`contract-draft.md` / reviewer APPROVED 后
rename 的 `sprint-contract.md`）—— reviewer 每轮审的、GAN 收敛的都是合同。
`task-plan.json` 是 GAN **收敛后**下游 `inferTaskPlanNode` 才读的产物：proposer SKILL 的
`git add` 对它用 `2>/dev/null` 容忍 LLM 偶发漏写，`inferTaskPlanNode` 还有 B32 兜底（代 push）。

用 `task-plan.json` 当"proposer 这轮到底有没有产出（vs 被 429 静默吞掉）"的信号 →
只要 proposer 产了有效合同但漏 `task-plan.json` 就误判 `proposer_didnt_push`。

该错配从 H15（#2867）就潜伏，但当时 `verifyProposer` 的错误被 `.catch` 吞掉、且所有
GAN 单测都 mock `verifyProposer` 成功，从没跑过真实 verify → 一直没暴露。
#3229（反 429 空转）去掉 `.catch`、改成连续未 push 累计即 ABORT，把这个潜伏 bug 变致命。

## 修复

`contract-verify.js` 新增 `verifyContractProposerOutput`：验 origin propose 分支真含
非空的 `contract-draft.md`（fallback `sprint-contract.md`），不验 `task-plan.json`。
`harness-gan.graph.js` 把 `verifyProposer` 默认值改接 `verifyContractProposerOutput`。
`task-plan.json` 的兜底维持原设计交给 `inferTaskPlanNode`。

回归测试：`contract-verify.test.js` 新增 7 例，含"只有 contract-draft.md、没 task-plan.json
→ 不 throw 且根本不查 task-plan.json"的关键断言。

## 下次预防

- [ ] 给 LLM-agent 节点写 verify 时，先问"这个节点这一步的真实交付物是什么"，verify 的产物
      必须等于该步交付物，不能借用下游产物。
- [ ] 新增"致命化"改动（去掉 `.catch`/把 warn 升 error/把软失败升 ABORT）时，必须先确认
      被致命化的 verify/判定本身是正确的——致命化会放大潜伏的错判。
- [ ] GAN 单测长期 mock `verifyProposer` 成功，导致真实 verify 零覆盖；关键 verify 函数必须
      有独立单测覆盖其真实判定逻辑（本 PR 已补 `verifyContractProposerOutput` 7 例）。
