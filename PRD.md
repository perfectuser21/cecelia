# PRD — P1 修复：Contract Gate FAIL 路由缺陷（合同产物命中走 generator fix loop 空转）

## 背景

PR #3348 在 `evaluateContractNode` spawn LLM evaluator 之前接了确定性 Contract Gate（`packages/brain/src/lib/contract-gate.js`），扫合同产物（contract-dod.md / contract-draft.md）里的弱断言/作弊/缺工具红线，命中即 `evaluate_verdict='FAIL'`，不浪费 evaluator 容器。

但 FAIL 路由有缺陷：`routeAfterEvaluate` 对所有 FAIL 一律走通用 fix loop（spawn generator 修）。当 gate 命中的是**合同文件本身**（如 contract-dod.md 的 `Test: test -f out.mp4` 这种 file-existence-only 弱断言）时——**CONTRACT IS LAW，generator 无权改合同/DoD** → generator 修不掉合同缺陷 → evaluate 重跑同一行再次命中 → 无限 fix loop 空转烧轮次。生产实证 run ea622a94 r0/r1/r2 三连命中同一行。

合同质量缺陷的责任方是 GAN 的 proposer（有权改合同），不是 generator。

## 范围

- **修缺陷**：`evaluateContractNode` 的 Contract Gate 命中合同产物文件时 fail-fast：标记 `failure_class='contract_invalid'`，`routeAfterEvaluate` 路由直接终止 initiative（END），不进 generator fix loop；`evaluate_error` 带结构化命中清单（含 ruleId + 行号），供重发时 proposer 参考。命中含实现侧文件时维持现有 fix loop 行为。
- **治本**：GAN 收敛（`reviewer` 判 APPROVED）之后、退出 GAN 之前，对合同产物跑同一 gate 库（#3348 共享实现，import 复用，禁复制）；命中确定性红线 → 不退出 GAN，verdict 改 REVISION，把命中清单作为 feedback 拼进下一轮 proposer 输入（走现有 REVISION 回环），proposer 修合同。这样弱合同根本到不了 generator。
- 新增 failing test 两个场景（合同级命中→END 不 spawn generator；GAN 收敛命中→路由回 proposer 且 feedback 含清单）。

不含：改 gate 规则表本身、改 GAN 轮数策略（无上限是刻意设计）、UI。

## 成功标准

- Contract Gate 命中合同产物（contractFile=contract-dod.md/contract-draft.md/sprint-contract.md）→ `evaluateContractNode` 返回 `failure_class='contract_invalid'`，不 spawn evaluator，`routeAfterEvaluate` 路由到 END（终止 initiative），不进 generator fix loop。
- Contract Gate 命中含实现侧文件 → 维持现有 fix loop 行为（generator 可修）。
- GAN `reviewer` 判 APPROVED 但合同命中确定性红线（作弊/弱断言/缺工具/域规则）→ verdict 改 REVISION，feedback 含结构化命中清单（含 ruleId），打回 proposer，不退出 GAN。
- GAN `reviewer` 判 APPROVED 且合同干净 → 维持 APPROVED，GAN 正常退出。
- `structural/no-assertion` 元规则不参与 GAN 收敛拦截（合同断言可能在外部 tests/ 文件，避免格式误报；由 evaluator 阶段读 contract-dod.md 兜底）。
- `packages/brain/src/workflows/` 全部 vitest 通过。
