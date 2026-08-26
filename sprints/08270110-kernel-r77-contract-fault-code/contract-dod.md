---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: generator 合同故障码保真透传，根除 provider_exit 语义埋没 [r77]

**范围**: 仅改 `packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`——抽出纯函数 `resolveProviderCloseResult({resultPath,attemptId,exitCode})` 并导出，`child.once('close')` 分支改调它：非零退出下若 resultPath 存在合法结构化 result 且 `error.code` 匹配 `^CONTRACT_[A-Z0-9_]+$` 则保真透传，否则回落 `provider_exit_${code}`；`exit 0` 与外层 `provider_result_invalid` 语义不变。不改 `derive.js`、不改 `execution-contract.js`（保真透传后既有 kernel 路径已正确，真 import 断言确认）、不动 provider 真崩溃黑名单语义。冻结测试落 `sprints/<sprint_dir>/tests/` 与 `tests/gp/f1/`（真 import 被改文件，禁 mock 被改的边）。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] runner 抽出并导出纯函数 `resolveProviderCloseResult` 且 close 分支改调它
  Test: node -e "const m=require('/workspace/packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs');if(typeof m.resolveProviderCloseResult!=='function')process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 冻结合同测试文件存在且真 import 被改文件（非 mock）
  Test: node -e "const c=require('fs').readFileSync('/workspace/sprints/08270110-kernel-r77-contract-fault-code/tests/contract-fault-code-passthrough.test.ts','utf8');if(!c.includes('kernel-attempt-handler.cjs')||!c.includes('resolveProviderCloseResult')||/vi\.mock/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] 永久回归测试文件存在（tests/gp/f1，CI 常驻）
  Test: node -e "const c=require('fs').readFileSync('/workspace/tests/gp/f1/step3-contract-fault-code-passthrough.test.js','utf8');if(!c.includes('resolveProviderCloseResult'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 冻结 + 永久回归全链测试真跑，实际 collected 用例数达标（防 vitest 范围外绿态假过）INV-1[vitest范围外绿态]
  动作: 从仓库根跑 `npx vitest run` 两个测试文件，JSON reporter 输出计数，node 断言真实收集用例数
  预期观察: numTotalTests ≥ 12（两文件各 ≥6）、numFailedTests = 0、全部 passed；非「No test files found」假绿
  等待预算: 0s
  留证: /tmp/r77-dod.json（vitest JSON 报告）+ node 断言 stdout
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}" && npx vitest run sprints/08270110-kernel-r77-contract-fault-code/tests/contract-fault-code-passthrough.test.ts tests/gp/f1/step3-contract-fault-code-passthrough.test.js --reporter=json --outputFile=/tmp/r77-dod.json && node -e "const r=require(\"/tmp/r77-dod.json\");if((r.numTotalTests||0)<12||(r.numFailedTests||0)>0){console.error(\"FAIL total=\"+r.numTotalTests+\" failed=\"+r.numFailedTests);process.exit(1)}console.log(\"OK total=\"+r.numTotalTests)"'
  期望: OK total=<≥12>

- [ ] [BEHAVIOR] [L2] B-02: 保真透传——非零退出下结构化 CONTRACT_* 合同故障码不降级为 provider_exit
  动作: 真 import runner 纯函数，写结构化 blocked+CONTRACT_SELF_CONTRADICTION result 到真临时文件，以 exitCode=1 调用
  预期观察: 返回结果 error.code 仍为 CONTRACT_SELF_CONTRADICTION、status 仍为 blocked（未被 provider_exit_1 覆盖）
  等待预算: 0s
  留证: node 断言 stdout（OK / FAIL+实际返回）
  Test: manual:bash -c 'node -e "const f=require(\"/workspace/packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs\").resolveProviderCloseResult;const fs=require(\"fs\"),os=require(\"os\"),p=require(\"path\");const A=\"00000000-0000-4000-8000-000000000abc\";const q=p.join(fs.mkdtempSync(p.join(os.tmpdir(),\"h\")),\"r.json\");fs.writeFileSync(q,JSON.stringify({contract_version:\"1.0\",attempt_id:A,status:\"blocked\",summary:\"s\",artifacts:[],checks:[],decision:null,error:{code:\"CONTRACT_SELF_CONTRADICTION\",message:\"m\"},provider_metadata:{provider:\"codex\"}}));const r=f({resultPath:q,attemptId:A,exitCode:1});if(r.error.code!==\"CONTRACT_SELF_CONTRADICTION\"||r.status!==\"blocked\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-03: 负向 真崩溃——无结构化 result 仍 provider_exit / failed，语义不变
  动作: 真 import runner 纯函数，resultPath 指向不存在文件，以 exitCode=42 调用
  预期观察: 返回 status=failed、error.code=provider_exit_42（黑名单/infrastructure 原语义不变）
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node -e "const f=require(\"/workspace/packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs\").resolveProviderCloseResult;const os=require(\"os\"),p=require(\"path\");const A=\"00000000-0000-4000-8000-000000000abc\";const r=f({resultPath:p.join(os.tmpdir(),\"r77-missing\",\"none.json\"),attemptId:A,exitCode:42});if(r.status!==\"failed\"||r.error.code!==\"provider_exit_42\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-04: 边界 非 CONTRACT_ 结构化 code——semantic_refusal 在非零退出下回落 provider_exit（只凭结构化 code，不误保真）
  动作: 真 import runner 纯函数，写结构化 blocked 但 error.code=semantic_refusal，以 exitCode=1 调用
  预期观察: 返回 error.code=provider_exit_1（非 CONTRACT_* 结构化 code 不保真为合同故障，走原有语义）
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node -e "const f=require(\"/workspace/packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs\").resolveProviderCloseResult;const fs=require(\"fs\"),os=require(\"os\"),p=require(\"path\");const A=\"00000000-0000-4000-8000-000000000abc\";const q=p.join(fs.mkdtempSync(p.join(os.tmpdir(),\"h\")),\"r.json\");fs.writeFileSync(q,JSON.stringify({contract_version:\"1.0\",attempt_id:A,status:\"blocked\",summary:\"s\",artifacts:[],checks:[],decision:null,error:{code:\"semantic_refusal\",message:\"m\"},provider_metadata:{provider:\"codex\"}}));const r=f({resultPath:q,attemptId:A,exitCode:1});if(r.error.code!==\"provider_exit_1\"){console.error(\"FAIL\",JSON.stringify(r));process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] [L2] B-05: 纯函数可重放——同输入两次结果 deep-equal 且 CONTRACT_* 保真
  动作: 真 import runner 纯函数，同一 CONTRACT_TEST_UNSATISFIABLE 结构化输入 + exitCode=1 连调两次
  预期观察: 两次返回 JSON deep-equal（无隐藏时钟/随机），且 error.code=CONTRACT_TEST_UNSATISFIABLE
  等待预算: 0s
  留证: node 断言 stdout
  Test: manual:bash -c 'node -e "const f=require(\"/workspace/packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs\").resolveProviderCloseResult;const fs=require(\"fs\"),os=require(\"os\"),p=require(\"path\");const A=\"00000000-0000-4000-8000-000000000abc\";const q=p.join(fs.mkdtempSync(p.join(os.tmpdir(),\"h\")),\"r.json\");fs.writeFileSync(q,JSON.stringify({contract_version:\"1.0\",attempt_id:A,status:\"blocked\",summary:\"s\",artifacts:[],checks:[],decision:null,error:{code:\"CONTRACT_TEST_UNSATISFIABLE\",message:\"m\"},provider_metadata:{provider:\"codex\"}}));const a=f({resultPath:q,attemptId:A,exitCode:1});const b=f({resultPath:q,attemptId:A,exitCode:1});if(JSON.stringify(a)!==JSON.stringify(b)||a.error.code!==\"CONTRACT_TEST_UNSATISFIABLE\"){console.error(\"FAIL\",JSON.stringify(a),JSON.stringify(b));process.exit(1)}console.log(\"OK\")"'
  期望: OK

## Invariant 覆盖（铁律映射）

- INV-1 [vitest范围外绿态] → 由 B-01 覆盖（JSON reporter 断言真实 collected 用例数 ≥12，禁止只看 exit 0）。
- INV-2 [Red精确add] → N/A（提交纪律，非运行时断言）：Red commit 只 `git add sprints/08270110-kernel-r77-contract-fault-code/tests/*.test.ts tests/gp/f1/step3-contract-fault-code-passthrough.test.js` 精确路径，禁 `git add .` / `git add .harness`。
- INV-3 [source-inspection]/[禁 mock 被改的边] → 由 ARTIFACT②（无 `vi.mock`）+ B-02~B-05（真 import runner 纯函数、真 fs 临时文件）覆盖。
- 其余系统铁律（单 slot / 真环境 done / 多租户 / 禁写死环境值 / 凭据安全）→ N/A：纯函数分类逻辑，无并发/租户/凭据/环境假设值。
