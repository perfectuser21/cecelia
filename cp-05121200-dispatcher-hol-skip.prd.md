# PRD: dispatcher HOL blocking fix

**Branch**: cp-05121200-dispatcher-hol-skip
**Task**: Walking Skeleton P1 B5

## 背景

Brain dispatcher 存在 Head-of-Line (HOL) blocking：当队首 codex 类任务（codex_dev/codex_qa/codex_test_gen）
因 xian 离线或 codex pool 满而无法派发时，dispatcher 直接返回 `codex_pool_full`，
整个 dispatch_loop 退出。队尾的 claude 类任务（harness_initiative 等）永远无法被调度。

## 需求

队首任务派不出（codex pool 满）时，对非 P0 任务：跳过它，找下一个可派发的任务。

## 成功标准

- 队首 codex task (P1/P2) + codex pool 满 → 跳过队首，派后面的 dev/harness 任务
- P0 codex task + codex pool 满 → 全停，不绕过 P0（高优先级信号不可忽略）
- HOL skip 次数超过 MAX_SKIP_HEAD_FOR_BLOCKED(10) → 返回 `hol_skip_cap_exceeded`，不无限循环
- 已有的 dispatcher 测试（initiative-lock / quota-cooling / pre-flight-skip）全部继续通过
