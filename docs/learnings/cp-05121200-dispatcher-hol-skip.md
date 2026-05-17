# Learning: dispatcher HOL blocking fix — 队首派不出 skip 找下一个

**Branch**: cp-05121200-dispatcher-hol-skip
**Date**: 2026-05-12

## 根本原因

dispatcher.js 在步骤 3d 检测到 codex pool 满时直接 `return { reason: 'codex_pool_full' }`，
导致整个 dispatch_loop 退出。队首一个 codex 任务（xian 离线）就能永远封锁后面所有 claude 类任务。
这是经典 Head-of-Line (HOL) blocking 问题：单 pass + 无 skip 机制。

## 下次预防

- [ ] 任何"某类任务不可派就 return"的逻辑，必须先问：队后面还有其他类型任务可以跑吗？
- [ ] dispatcher 的 pre-flight 跳过循环已有先例（`preFlightFailedIds`），HOL skip 应套用同款模式
- [ ] P0 任务永远不绕过（高优先信号不可忽略），P1/P2 可在资源不可用时让路
- [ ] skip cap（MAX_SKIP_HEAD_FOR_BLOCKED=10）防止无限循环，超出返回明确错误码
- [ ] HOL skip 不消耗 pre-flight 尝试次数（`attempt--`），两类 skip 逻辑独立计数

## 变更摘要

- `dispatcher.js`：将 3b'(retire)/3c(initiative lock)/3c'(claim)/3d(codex pool) 移入循环体，
  与 pre-flight 循环合并为统一候选选择 + 验证 loop
- 新增 `holSkipIds` + `MAX_SKIP_HEAD_FOR_BLOCKED=10`
- 非 P0 codex task 被 pool 堵塞时：释放 claim → push holSkipIds → `attempt--; continue`
- P0 codex task 被堵：释放 claim → 立即 return `codex_pool_full`（不绕过）
- `packages/brain/src/__tests__/dispatcher-hol.test.js`：3 个验收用例（C1/C2/C3）
