=== frozen sprint test (RED expected) ===
[33mThe CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.[39m

 RUN  v1.6.1 /workspace

 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js  (6 tests | 6 failed) 7ms
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 导出纯函数 resolveProviderTerminalResult（回执归因 SSOT，可被 close-handler 与守卫共用）
     → expected 'undefined' to be 'function' // Object.is equality
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 保真透传不被包装成 provider_exit：复刻 r69/r77 结构化 BLOCKED + CONTRACT_* 遇 provider 非零退出
     → kernelAttemptHandler.resolveProviderTerminalResult is not a function
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > success 结果 JSON（completed）遇非零退出同样保真，不被误判为失败
     → kernelAttemptHandler.resolveProviderTerminalResult is not a function
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 负向不回退：无合法结构化产出（文件缺失）+ 非零退出 → 仍 provider_exit（语义不变）
     → kernelAttemptHandler.resolveProviderTerminalResult is not a function
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 负向不回退：结构化产出损坏（schema 不合法）+ 非零退出 → 落负向路径，不冒充 CONTRACT 故障
     → kernelAttemptHandler.resolveProviderTerminalResult is not a function
   ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边② failed_targets 采集排除 CONTRACT_* 家族（真 attempt-store SQL） > failed_targets 采集排除 CONTRACT_* 家族：listFailedExecutionTargets 发往 Postgres 的 SQL 显式排除 CONTRACT 错误码，合同故障 target 不被拉黑
     → expected false to be true // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 导出纯函数 resolveProviderTerminalResult（回执归因 SSOT，可被 close-handler 与守卫共用）
AssertionError: expected 'undefined' to be 'function' // Object.is equality

- Expected
+ Received

- function
+ undefined

 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:83:71
     81| describe('r82 边① 回执保真透传（kernel-attempt-handler resolveProvider…
     82|   it('导出纯函数 resolveProviderTerminalResult（回执归因 SSOT，可被 cl…
     83|     expect(typeof kernelAttemptHandler.resolveProviderTerminalResult).…
       |                                                                       ^
     84|   });
     85| 

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 保真透传不被包装成 provider_exit：复刻 r69/r77 结构化 BLOCKED + CONTRACT_* 遇 provider 非零退出
TypeError: kernelAttemptHandler.resolveProviderTerminalResult is not a function
 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:88:41
     86|   it('保真透传不被包装成 provider_exit：复刻 r69/r77 结构化 BLOCKED + …
     87|     const resultPath = writeResultFile(structuredBlockedContractFault(…
     88|     const result = kernelAttemptHandler.resolveProviderTerminalResult({
       |                                         ^
     89|       code: 1,
     90|       resultPath,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > success 结果 JSON（completed）遇非零退出同样保真，不被误判为失败
TypeError: kernelAttemptHandler.resolveProviderTerminalResult is not a function
 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:101:41
     99|   it('success 结果 JSON（completed）遇非零退出同样保真，不被误判为失败…
    100|     const resultPath = writeResultFile(structuredCompleted());
    101|     const result = kernelAttemptHandler.resolveProviderTerminalResult({
       |                                         ^
    102|       code: 1,
    103|       resultPath,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 负向不回退：无合法结构化产出（文件缺失）+ 非零退出 → 仍 provider_exit（语义不变）
TypeError: kernelAttemptHandler.resolveProviderTerminalResult is not a function
 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:110:41
    108| 
    109|   it('负向不回退：无合法结构化产出（文件缺失）+ 非零退出 → 仍 provider…
    110|     const result = kernelAttemptHandler.resolveProviderTerminalResult({
       |                                         ^
    111|       code: 137,
    112|       resultPath: path.join(os.tmpdir(), 'r82-does-not-exist', '.brain…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边① 回执保真透传（kernel-attempt-handler resolveProviderTerminalResult） > 负向不回退：结构化产出损坏（schema 不合法）+ 非零退出 → 落负向路径，不冒充 CONTRACT 故障
TypeError: kernelAttemptHandler.resolveProviderTerminalResult is not a function
 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:121:41
    119|   it('负向不回退：结构化产出损坏（schema 不合法）+ 非零退出 → 落负向路…
    120|     const resultPath = writeResultFile('{ not valid json');
    121|     const result = kernelAttemptHandler.resolveProviderTerminalResult({
       |                                         ^
    122|       code: 1,
    123|       resultPath,

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js > r82 边② failed_targets 采集排除 CONTRACT_* 家族（真 attempt-store SQL） > failed_targets 采集排除 CONTRACT_* 家族：listFailedExecutionTargets 发往 Postgres 的 SQL 显式排除 CONTRACT 错误码，合同故障 target 不被拉黑
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ sprints/08291520-kernel-r82-provider-exit-fidelity/tests/r82-provider-exit-fidelity.test.js:140:36
    138|     const excludesContractFamily = /error_code[\s\S]*not\s+like\s+'con…
    139|       || (/contract_self_contradiction/i.test(flat) && /not\s+in/i.tes…
