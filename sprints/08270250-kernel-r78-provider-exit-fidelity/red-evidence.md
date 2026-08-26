# RED evidence — r78 provider-exit structured fidelity

GP copy: tests/gp/f1/step3-provider-exit-structured-fidelity.test.js
Run from packages/brain: npx vitest run ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js

Total 6 / Passed 1 / Failed 5
- 4 classifier tests fail: docker/cecelia-runner/structured-terminal-classifier.cjs 缺失（模块未创建）
- 1 kernel B-01 fail: derive 对 CONTRACT_* 仍走 infra 短路，返回 spawn:generator-fix ≠ arbitrate:contract_fault
- 1 kernel B-02 pass: 负向 provider_exit 守卫已就位

```

 RUN  v1.6.1 /workspace/packages/brain

 ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js  (6 tests | 5 failed) 10ms
   ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — 结构化上报保真透传，根除 provider_exit 语义埋没（kernel 侧路由） > CONTRACT_ 家族故障码路由到合同故障重开 GAN，不按 infrastructure 重试
     → expected 'spawn:generator-fix' to be 'arbitrate:contract_fault' // Object.is equality
   ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 结构化成功终态（exit≠0）保真透传为成功，不降级 provider_exit
     → Failed to load url ../../../docker/cecelia-runner/structured-terminal-classifier.cjs (resolved id: ../../../docker/cecelia-runner/structured-terminal-classifier.cjs). Does the file exist?
   ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > commander 成功指令（exit≠0）保真透传，不降级 provider_exit
     → Failed to load url ../../../docker/cecelia-runner/structured-terminal-classifier.cjs (resolved id: ../../../docker/cecelia-runner/structured-terminal-classifier.cjs). Does the file exist?
   ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 结构化 BLOCKED + CONTRACT_ 错误码保真透传，error.code 病族不丢
     → Failed to load url ../../../docker/cecelia-runner/structured-terminal-classifier.cjs (resolved id: ../../../docker/cecelia-runner/structured-terminal-classifier.cjs). Does the file exist?
   ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 无结构化产出的真实崩溃/超时映射 provider_exit / provider_timeout（负向不透传）
     → Failed to load url ../../../docker/cecelia-runner/structured-terminal-classifier.cjs (resolved id: ../../../docker/cecelia-runner/structured-terminal-classifier.cjs). Does the file exist?

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — 结构化上报保真透传，根除 provider_exit 语义埋没（kernel 侧路由） > CONTRACT_ 家族故障码路由到合同故障重开 GAN，不按 infrastructure 重试
AssertionError: expected 'spawn:generator-fix' to be 'arbitrate:contract_fault' // Object.is equality

- Expected
+ Received

- arbitrate:contract_fault
+ spawn:generator-fix

 ❯ ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js:76:22
     74|       ],
     75|     }));
     76|     expect(r.action).toBe('arbitrate:contract_fault');
       |                      ^
     77|     expect(r).toMatchObject({ phase: 'gan', reason: 'contract_fault_ap…
     78|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 结构化成功终态（exit≠0）保真透传为成功，不降级 provider_exit
 FAIL  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > commander 成功指令（exit≠0）保真透传，不降级 provider_exit
 FAIL  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 结构化 BLOCKED + CONTRACT_ 错误码保真透传，error.code 病族不丢
 FAIL  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js > F1 step3 — runner 回执归一化保真透传（structured-terminal-classifier 纯函数） > 无结构化产出的真实崩溃/超时映射 provider_exit / provider_timeout（负向不透传）
```
