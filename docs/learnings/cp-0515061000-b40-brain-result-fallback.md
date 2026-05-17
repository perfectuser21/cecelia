# Learning: B40 evaluateContractNode .brain-result.json Fallback

**Branch**: cp-b40-evaluate-brain-result-fallback  
**Date**: 2026-05-15

---

### 根本原因

`evaluateContractNode` 只读 `.cecelia/verdict.json`（Protocol v2），但 `harness-evaluator` skill 写的是 `.brain-result.json`。文件协议不匹配导致 `readVerdictFile` 返回 null，Protocol v1 stdout fallback 在中间步骤输出中抓到 FAIL 关键词，误判整体 verdict 为 FAIL，触发 `routeAfterEvaluate → fix_dispatch` 无限循环，PR 永远无法 merge。

### 时序链

```
harness-evaluator → 写 .brain-result.json (verdict=PASS)
evaluateContractNode → readVerdictFile(.cecelia/verdict.json) → null
                    → extractField(stdout) → 匹配到中间步骤 FAIL 输出
                    → evaluate_verdict = FAIL → fix_dispatch → loop
```

### 修复策略

在 `readVerdictFile` 返回 null 之后、Protocol v1 stdout fallback 之前，插入 **Protocol v2.5** fallback：

```
v2:   .cecelia/verdict.json  [不变，优先]
v2.5: .brain-result.json     [NEW — catch missing_result_file → 继续 v1]
v1:   stdout extractField    [最后兜底]
```

`readBrainResult` 是 throw-on-missing 而非 return-null，必须 try-catch 包裹。

### 下次预防

- [ ] 新增 harness-shared.js 时区分"返回 null"和"抛异常"两种契约，在函数名或 JSDoc 注明
- [ ] harness-evaluator skill 若改写文件路径，必须同时修改 `evaluateContractNode` 读取路径
- [ ] 无限 fix loop 排查时，第一步检查文件协议：evaluator 写哪里，graph 读哪里

### 关联

- PR: #2969（playground /echo schema 同步修复，此次 loop 暴露）
- 设计 spec: `docs/superpowers/specs/2026-05-15-b40-evaluatecontractnode-brain-result-fallback-design.md`
