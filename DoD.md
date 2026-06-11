# Contract DoD — P1 修复：Contract Gate FAIL 路由缺陷（合同产物命中不进 generator fix loop）

**范围**: `evaluateContractNode` 合同产物命中 fail-fast（failure_class=contract_invalid → routeAfterEvaluate END）+ GAN reviewer 收敛前置同一 gate 库（命中→REVISION 打回 proposer）+ 两场景 failing test。复用 #3348 gate 库（import，禁复制）。不含改 gate 规则表、改 GAN 轮数策略、UI。
**大小**: S

## ARTIFACT 条目

- [x] [ARTIFACT] `isContractArtifactFile` 导出 + `routeAfterEvaluate` 对 contract_invalid 返回 'end'
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!/export function isContractArtifactFile/.test(c)||!/failure_class === 'contract_invalid'/.test(c)||!/return 'end'/.test(c))process.exit(1)"

- [x] [ARTIFACT] evaluate_contract 条件边新增 end→END（终止 initiative 通道）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');const seg=(c.split(\"addConditionalEdges('evaluate_contract'\")[1]||'').slice(0,200);if(!/end:\s*END/.test(seg))process.exit(1)"

- [x] [ARTIFACT] GAN reviewer 复用 #3348 gate 库（import contract-gate.js，禁复制规则逻辑）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/import \{ evaluateContractText, formatGateReport \} from '..\/lib\/contract-gate.js'/.test(c))process.exit(1)"

## BEHAVIOR 条目（被测 = 真实 packages/brain graph 节点 + 路由函数；行为由 vitest 在 brain-ci.yml 执行）

- [x] [BEHAVIOR] Contract Gate 命中合同产物 → evaluateContractNode 标记 failure_class=contract_invalid 且不 spawn evaluator；routeAfterEvaluate 路由 END，不进 generator fix loop（vitest: __tests__/contract-gate-wiring.test.js，brain-ci.yml 执行）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/contract-gate-wiring.test.js','utf8');if(!/failure_class.*contract_invalid/.test(c)||!/routeAfterEvaluate.*contract_invalid.*end|end.*终止 initiative/.test(c)||!/not\.toHaveBeenCalled/.test(c))process.exit(1)"

- [x] [BEHAVIOR] GAN reviewer 判 APPROVED 但合同命中确定性红线 → verdict 改 REVISION 且 feedback 含 ruleId 命中清单（打回 proposer，不退出 GAN）；合同干净则维持 APPROVED（vitest: __tests__/harness-gan-contract-gate-converge.test.js，brain-ci.yml 执行）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/__tests__/harness-gan-contract-gate-converge.test.js','utf8');if(!/REVISION/.test(c)||!/cheat\/mock-env|weak-oracle/.test(c)||!/APPROVED/.test(c))process.exit(1)"

- [x] [BEHAVIOR] GAN 收敛 gate 排除 structural/no-assertion 元规则（合同断言可能在外部 tests/，避免格式误报；由 evaluator 阶段读 contract-dod.md 兜底）
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-gan.graph.js','utf8');if(!/ruleId !== 'structural\/no-assertion'/.test(c)||!/evaluateContractText/.test(c))process.exit(1)"
