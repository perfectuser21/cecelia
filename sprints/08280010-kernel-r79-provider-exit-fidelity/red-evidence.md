# Red 证据 — r79 provider_exit 保真透传

冻结合同测试 baseline（实现前，预期 RED）：
```
   ❯ sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js > r79 [BEHAVIOR] runner 回执保真透传（真 bash + 真 jq） > normalize_provider_failure 保真透传结构化 BLOCKED 的 CONTRACT_* 错误码，不埋没为 provider_exit
   ❯ sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js > r79 [BEHAVIOR] runner 回执保真透传（真 bash + 真 jq） > validate_claude_terminal_receipt 认可 commander-directive/v1 成功信封（success 保真透传前置）
     → ground-truth.js 必须导出 GENERATOR_RUNTIME_ERROR_CODES: expected undefined to be an instance of Set
 FAIL  sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js > r79 [BEHAVIOR] runner 回执保真透传（真 bash + 真 jq） > normalize_provider_failure 保真透传结构化 BLOCKED 的 CONTRACT_* 错误码，不埋没为 provider_exit
 FAIL  sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js > r79 [BEHAVIOR] runner 回执保真透传（真 bash + 真 jq） > validate_claude_terminal_receipt 认可 commander-directive/v1 成功信封（success 保真透传前置）
 FAIL  sprints/08280010-kernel-r79-provider-exit-fidelity/tests/provider-exit-fidelity.test.js > r79 [BEHAVIOR] kernel 失败归因分流（真 import derive / ground-truth） > 归因口径：GENERATOR_RUNTIME_ERROR_CODES 含 provider_*、排除 CONTRACT_* 家族
AssertionError: ground-truth.js 必须导出 GENERATOR_RUNTIME_ERROR_CODES: expected undefined to be an instance of Set
      Tests  3 failed | 4 passed (7)
```

结论：3 failed | 4 passed，与合同 Test Contract 预期红证据一致：
- FAIL normalize_provider_failure 保真透传 CONTRACT_*（得 provider_exit）
- FAIL validate_claude_terminal_receipt 认可 commander-directive/v1（得 exit 1）
- FAIL ground-truth.js 未导出 GENERATOR_RUNTIME_ERROR_CODES
