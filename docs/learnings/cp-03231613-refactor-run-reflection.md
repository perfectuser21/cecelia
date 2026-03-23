# Learning: 重构 runReflection 圈复杂度 12 → 6

**Branch**: cp-03231613-964423f6-9ee8-486e-826e-ea54ba
**Date**: 2026-03-23

## 任务背景

`runReflection` 圈复杂度从 39 降至 12（PR #1432 已完成），本次进一步降至 6。

### 根本原因

函数内多处 `try/catch` 错误处理逻辑直接内联在主函数体，导致复杂度居高不下。
即使已将业务逻辑提取为子函数，error handling 本身仍是分支点。

### 解决方案

提取 "安全包装函数" 模式：将每个 `try/catch` 块封装为独立的 `_xxxSafe()` 函数，
主函数只保留业务判断（`if result === null` / `if !insight` 等 5 个 if）。

提取后结构：
```
_getAccumulatorSafe    → null on error
_fetchMemoriesSafe     → null on error
_buildReflectionPrompt → pure function
_callLLMSafe           → null on error
_checkInsightDedupSafe → null on error
_persistInsight        → fire & forget (both steps)
```

### 下次预防

- [ ] 设计新函数时，error handling 优先封装为 `_xxxSafe()` 独立函数
- [ ] 主业务函数只包含 if/else 业务逻辑，不直接写 try/catch
- [ ] 圈复杂度超 10 时，先检查是否有内联 try/catch 可提取
- [ ] 并行任务执行时检查 main 是否已有同功能 PR，避免重复工作
