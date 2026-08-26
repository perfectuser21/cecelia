contract_branch: cp-harness-propose-r1-019c16d1-r75125f2b-a34
sprint_dir: sprints/08270250-kernel-r78-provider-exit-fidelity

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 结构化上报保真透传，根除 provider_exit 语义埋没 [r78]

**范围**: runner 回执归一化结构化终态识别 + 保真透传（禁降级 provider_exit）；kernel derive 对 CONTRACT_* 家族路由合同故障重开 GAN（绕开 failed_targets 黑名单 + infrastructure 重试）；负向真崩溃语义不变。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] runner 结构化终态识别纯函数 SSOT 存在并导出 classifyProviderTerminal
  Test: node -e "const m=require('./docker/cecelia-runner/structured-terminal-classifier.cjs'); if(typeof m.classifyProviderTerminal!=='function')process.exit(1)"

- [ ] [ARTIFACT] RED 步骤断言文件存在且真 import 被改模块（derive.js + classifier），不 vi.mock 被改边
  Test: node -e "const c=require('fs').readFileSync('tests/gp/f1/step3-provider-exit-structured-fidelity.test.js','utf8'); if(!c.includes('orchestrator/derive.js')||!c.includes('structured-terminal-classifier')||/vi\.mock/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 版本四处同步 bump（DevGate check-version-sync）
  Test: bash scripts/check-version-sync.sh

## BEHAVIOR 条目（五行剧本，纯函数重放；postgres=false 用 node/vitest，禁 psql/curl）

- [ ] [BEHAVIOR] [L2] B-01: kernel 对 CONTRACT_* 家族错误码路由合同故障重开 GAN，不进 infra 重试
  动作: 以「结构化 BLOCKED + error_code=CONTRACT_TEST_UNSATISFIABLE，残留 failure_class=infrastructure_blocked」callback 调 derive
  预期观察: derive 返回 action=arbitrate:contract_fault、reason=contract_fault_appeal、phase=gan（非 spawn:generator-fix/infra 重试）
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "路由到合同故障重开" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-02: 真崩溃 provider_exit（非 CONTRACT_*）仍按 infrastructure 有界重派（负向铁律）
  动作: 以「status=failed, error_code=provider_exit, failure_class=infrastructure_blocked」callback 调 derive
  预期观察: derive 返回 phase=generate、action=spawn:generator-fix、reason=callback_infrastructure_blocked，且 action≠arbitrate:contract_fault
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "仍按 infrastructure 有界重派" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-03: runner 识别结构化成功终态（exit≠0）保真透传为成功，不降级 provider_exit
  动作: 以「providerExit=1, structuredResult={status:completed_with_concerns}」调 classifyProviderTerminal
  预期观察: 返回 passthrough=true、status=completed_with_concerns、errorCode=null
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "结构化成功终态" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-04: r77 复刻——commander 成功指令（exit≠0）保真透传，不降级 provider_exit
  动作: 以「providerExit=1, structuredResult={schema:commander-directive/v1}, commanderContract=true」调 classifyProviderTerminal
  预期观察: 返回 passthrough=true、status=completed、errorCode=null
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "commander 成功指令" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-05: r69 复刻——结构化 BLOCKED + CONTRACT_* 保真透传，error.code 病族不丢
  动作: 以「providerExit=1, structuredResult={status:blocked, error:{code:CONTRACT_TEST_UNSATISFIABLE}}」调 classifyProviderTerminal
  预期观察: 返回 passthrough=true、status=blocked、errorCode=CONTRACT_TEST_UNSATISFIABLE（原样保留）
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "错误码保真透传，error.code 病族不丢" --reporter=dot'

- [ ] [BEHAVIOR] [L2] B-06: 无结构化产出的真崩溃/超时/垃圾结构映射 provider_exit / provider_timeout（负向不透传）
  动作: 以 structuredResult=null(exit1/exit124) 及垃圾结构 {foo:1} 调 classifyProviderTerminal
  预期观察: null+exit1→passthrough=false,failureCode=provider_exit；exit124→provider_timeout；垃圾结构→passthrough=false,provider_exit
  等待预算: 0s
  留证: vitest 输出末 5 行（含该 it PASS）
  Test: manual:bash -c 'cd packages/brain && npx vitest run --no-cache ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js -t "无结构化产出的真实崩溃" --reporter=dot'

- [ ] [BEHAVIOR] [L2] INV-接线: entrypoint.sh 真调 classifier 且 bash 语法通过（铁律「接线用源码检视」，接缝）
  动作: grep entrypoint.sh 引用 structured-terminal-classifier，并 bash -n 校验语法
  预期观察: grep 命中且 bash -n 退出 0
  等待预算: 0s
  留证: grep 命中行 + bash -n 退出码
  Test: manual:bash -c 'grep -q "structured-terminal-classifier" docker/cecelia-runner/entrypoint.sh && bash -n docker/cecelia-runner/entrypoint.sh && echo OK'

## Invariant 覆盖（铁律逐条映射 — Step 1.3）

- INV[语义字段判成功] → 由 B-06 覆盖：classifier 对垃圾结构 {foo:1} 判 passthrough=false（成功判定看 .status/subtype/.schema 语义字段，非仅存在性/ok:true）。
- INV[失败契约显式 else] → 由 B-06 覆盖：classifier 无结构化终态时显式返回 passthrough=false + failureCode（不静默）。
- INV[重试身份] generator infrastructure 重试保持 identity 一致 → N/A：本单只改分类路由分支选择，不触碰 attempt identity/late-binding，负向重试路径（B-02）未变。
- INV[never_started 兜底] → N/A：不触碰 watchdog / never_started 分类。
- INV[状态枚举全审] → 由 B-03/B-04/B-05 覆盖：classifier 终态 status 枚举（completed/completed_with_concerns/needs_context/blocked）与 entrypoint.sh:2573 schema、GAN 新增值需全审——本单识别集合与既有 harness result schema 枚举对齐，不局部分叉。
- INV[Red 精确 add] → 由 task-plan/流程覆盖：Red commit 只 git add `tests/gp/f1/*.test.js` 精确路径，禁 `git add .`/`.harness`。
- INV[测试合同四列] → 本 DoD Test Contract 表固定 4 列，testFile 用 backtick 包裹，checker 从第 3 列解析。
- INV[接线用源码检视] → 由 INV-接线 BEHAVIOR 覆盖：entrypoint↔classifier 接线用 grep 源码检视验证。
- INV[真环境验收] → 接缝 entrypoint 真容器行为标 logic-done-pending（见 contract-draft 未覆盖真实链路清单）；纯函数逻辑真验收。
- INV[禁写死环境] → N/A/遵守：测试与 classifier 无端口/路径/账号硬编码；vitest 从 git 仓库根推导路径。
- INV[单 slot 串行] → N/A：本单不涉调度并发。

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 结构化保真透传 + CONTRACT_* 合同重开 + 负向不变（冻结） | `sprints/08270250-kernel-r78-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js` | 路由到合同故障重开 / 仍按 infrastructure 有界重派 / 结构化成功终态 / commander 成功指令 / 错误码保真透传，error.code 病族不丢 / 无结构化产出的真实崩溃 | → 5 failures（4 classifier 模块缺失 + 1 kernel 断言 spawn:generator-fix≠arbitrate:contract_fault），1 passed（负向 kernel 守卫） |
| 同上（GP 产物闸副本，brain-unit CI + lint-gp-anchor-artifact） | `tests/gp/f1/step3-provider-exit-structured-fidelity.test.js` | 路由到合同故障重开 / 仍按 infrastructure 有界重派 / 结构化成功终态 / commander 成功指令 / 错误码保真透传，error.code 病族不丢 / 无结构化产出的真实崩溃 | → 5 failures，1 passed（同冻结副本） |
