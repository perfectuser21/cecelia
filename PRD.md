# 重构 reflection.runReflection（圈复杂度 39 → 10）

## 背景

代码复杂度扫描发现 `packages/brain/src/desire/reflection.js` 中 `runReflection` 函数圈复杂度为 39，严重超过阈值 10。函数承担了静默期检查、accumulator 阈值校验、记忆去重、LLM 调用、熔断器逻辑、Jaccard 相似度去重、洞察写入等多项职责，需通过提取子函数的方式降低复杂度。

## 成功标准

1. [ARTIFACT] runReflection 函数内条件分支数量显著减少（if/else/catch/for/while 关键字 < 15 个）
2. [BEHAVIOR] 导出函数签名不变：`export async function runReflection(pool)` 保持不变
3. [PRESERVE] _loadBreakerState / _saveBreakerState / _resetBreakerStateForTest 导出不变
4. [GATE] Brain 单元测试全部通过
