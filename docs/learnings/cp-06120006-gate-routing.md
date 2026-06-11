# Learning — Contract Gate FAIL 路由缺陷修复（cp-06120006-gate-routing）

## 背景

#3348 给 `evaluateContractNode` 接了 spawn 前确定性 Contract Gate，命中即 `evaluate_verdict='FAIL'`。但 FAIL 路由（`routeAfterEvaluate`）对所有 FAIL 一律走通用 generator fix loop。生产 run ea622a94 实证 r0/r1/r2 三连命中同一行弱断言空转。

### 根本原因

Contract Gate 扫的是**合同产物文件本身**（contract-dod.md / contract-draft.md），命中代表**合同质量缺陷**（弱断言/作弊/缺工具）。而 `routeAfterEvaluate` 把这类 FAIL 等同于实现缺陷，路由到 generator fix loop。但 **CONTRACT IS LAW：generator 无权改合同/DoD**——它只能改实现代码。于是 generator 修不掉合同缺陷 → evaluate 重跑 → 同一行再次命中 → 无限 fix loop 烧轮次。责任错配：合同质量缺陷的责任方是 GAN proposer（有权改合同），不是 generator。

更深一层：弱合同本不该流出 GAN。GAN reviewer 是 LLM，会主观 APPROVED 含确定性红线的合同，让缺陷一路漏到 evaluator 阶段才被确定性 gate 抓到——但那时已无修复通道（generator 改不了合同）。

### 修复

1. **evaluate 时段 fail-fast**（治标）：`evaluateContractNode` 的 Contract Gate 命中合同产物文件（`isContractArtifactFile(cg.contractFile)`）时，返回 `failure_class='contract_invalid'`；`routeAfterEvaluate` 据此路由到 END（终止 initiative），不进 fix loop。`evaluate_error` 带结构化命中清单（ruleId + 行号），供重发时 proposer 参考。命中含实现侧文件时维持现有 fix loop。
2. **GAN 收敛前置 gate**（治本）：`reviewer` 判 APPROVED 后、退出 GAN 前，对 `state.contractContent` 跑同一 gate 库（`evaluateContractText`，import 复用 #3348，禁复制）。命中确定性红线 → verdict 改 REVISION，命中清单拼进 feedback 走现有 REVISION 回环让 proposer 修。弱合同根本到不了 generator。
3. **排除 structural/no-assertion 元规则参与 GAN 拦截**：GAN 阶段合同的验收脚本可能在外部 tests/ 文件（contract-draft.md 不内联 bash），此时 no-assertion 是格式误报；"无可验收断言"由 evaluator 阶段读 contract-dod.md 兜底。

### 下次预防

- 任何"确定性 gate + LLM 修复 loop"组合，必须先问：**命中的责任方有没有修复权限**。责任方无权修复的命中绝不能进它的 fix loop，否则必然空转。
- gate 命中要带"责任路由"语义（contract_invalid → proposer / 实现缺陷 → generator），不能只有单一 FAIL 通道。
- LLM gate（reviewer）退出前应叠加确定性 gate 做硬兜底，别让确定性可判的缺陷漏到下游无修复通道处才暴露。
- gate 库要单一来源 import 复用，evaluator 阶段与 GAN 阶段共享同一规则，禁复制。

### checklist

- [x] evaluateContractNode 合同产物命中 → failure_class=contract_invalid，不 spawn evaluator
- [x] routeAfterEvaluate contract_invalid → END（不进 generator fix loop）
- [x] 命中含实现侧文件 → 维持现有 fix loop
- [x] GAN reviewer APPROVED 后前置 gate，命中 → REVISION + feedback 含命中清单
- [x] GAN 收敛 gate 排除 structural/no-assertion 元规则（避免格式误报）
- [x] gate 库 import 复用 #3348，未复制规则逻辑
- [x] 两场景 failing test 先红后绿，permanent 回归
- [x] packages/brain/src/workflows 全部 vitest 通过
