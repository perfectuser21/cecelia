# Red 证据 — r81 结构化上报保真透传

冻结测试: `sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js`
命令: npx vitest run <frozen test> --reporter=basic

```
     → expected 'undefined' to be 'function' // Object.is equality
     → expected 'failed' to be 'completed' // Object.is equality
     → expected 'failed' to be 'blocked' // Object.is equality
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 7 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点① kernel-attempt-handler close-result 保真透传 > 导出纯函数 resolveProviderCloseResult（可离线重放的被改边）
AssertionError: expected 'undefined' to be 'function' // Object.is equality
- Expected
+ Received
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点① kernel-attempt-handler close-result 保真透传 > 非零退出 + 结构化 success result → 透传 completed，非 provider_exit（r77/r76）
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点① kernel-attempt-handler close-result 保真透传 > 非零退出 + 结构化 BLOCKED + CONTRACT_* → 保真透传 error.code（r69）
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点① kernel-attempt-handler close-result 保真透传 > 负向：无 result.json（真崩溃）→ provider_exit_${code} 语义不变
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点① kernel-attempt-handler close-result 保真透传 > 负向：exit 0 + 非法 result.json → provider_result_invalid 语义不变
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点② entrypoint normalize_provider_failure 保真透传 > 埋没点② 非零退出 + 结构化 success result → 透传 completed，不覆盖 provider_exit（r77/r76）
AssertionError: expected 'failed' to be 'completed' // Object.is equality
- Expected
+ Received
 FAIL  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js > r81 埋没点② entrypoint normalize_provider_failure 保真透传 > 埋没点② 非零退出 + 结构化 BLOCKED + CONTRACT_* → 保真透传 error.code（r69）
AssertionError: expected 'failed' to be 'blocked' // Object.is equality
- Expected
+ Received
 Test Files  1 failed (1)
      Tests  7 failed | 2 passed (9)
```

结论: RED 7 failed | 2 passed（2 通过为既有正确的负向 provider_exit_3/provider_result_invalid 分支），符合合同预期 RED 7/9。
