# Learning: codex_test_gen 任务类型注册

## 概述

新增 `codex_test_gen` Codex 任务类型，让 Brain 可以自动派发测试生成任务到西安 Mac mini。

### 根本原因

Codex 只有 3 种任务类型（codex_qa/codex_dev/codex_playwright），大部分时间空闲。新增 codex_test_gen 直接推动免疫系统 KR。

### 下次预防

- [ ] 注册新 task_type 时同步更新 DEFINITION.md（facts-check 会拦截）
- [ ] 确保 executor.js skillMap 有对应条目（否则 fallback 到 /dev）
- [ ] 使用 /brain-register skill 确保多文件联动不漏改
