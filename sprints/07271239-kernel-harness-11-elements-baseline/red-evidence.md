Red 证据（vitest）：

- 合同测试套件已启动并失败。
- `kernel-harness-f1-baseline.test.ts` 无法加载尚不存在的
  `packages/brain/src/lib/kernel-harness-f1-baseline.js`。
- Vitest JSON：failed test suites=1，passed tests=0，total tests=0。
- 失败属于合同 Test Contract 明示允许的“migration/module 未实现，测试收集失败”红态。
