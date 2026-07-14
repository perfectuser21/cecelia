# Contract DoD：dispatcher 坏任务自动隔离

**Sprint ID**: 07141332-dispatch-fail-autoblock
**Task ID**: 7c5d6df8-791c-4190-8db8-1274cef9071c
**日期**: 2026-07-14

---

## DoD 核验表

| # | DoD 条件 | 验证方式 | 对应 [BEHAVIOR] |
|---|---------|---------|----------------|
| 1 | failing test 先 commit，修复后全绿 | `vitest run` dispatch-fail-autoblock.test.js | ALL |
| 2 | `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD` env 生效 | GP-4 单测（BEHAVIOR-4） | [BEHAVIOR-4] |
| 3 | 计数持久化（重启不丢）：写入 `tasks.metadata.dispatch_fail_consecutive` | GP-1 断言 metadata（BEHAVIOR-1） | [BEHAVIOR-1] |
| 4 | 既有 dispatcher 测试全过（无 regression） | dispatch-executor-fail / dispatch-dedup / dispatch-events 全绿 | — |
| 5 | CI 全绿（brain-ci.yml） | GitHub Actions PASS | — |
| 6 | configError 不触发计数/autoblock | GP-5 单测（BEHAVIOR-5） | [BEHAVIOR-5] |
| 7 | spawn_deduplicated 不触发计数/autoblock | BEHAVIOR-6 单测 | [BEHAVIOR-6] |
| 8 | autoblock 后下一 tick 跳过该任务（候选池排除） | GP-2 单测（BEHAVIOR-2） | [BEHAVIOR-2] |
| 9 | raise('P2', ...) 仅调用 1 次 | GP-1 断言 mock 调用次数 | [BEHAVIOR-1] |
| 10 | 成功派发后计数归零；再失败不从旧值累积 | GP-3 单测（BEHAVIOR-3） | [BEHAVIOR-3] |

---

## 阶段门

### Phase 1（failing test commit）
- [ ] `packages/brain/src/__tests__/dispatch-fail-autoblock.test.js` 骨架已 commit
- [ ] 运行 `npx vitest run dispatch-fail-autoblock.test.js` 输出 **FAIL**（failing test 先行）
- [ ] commit message 含 `[failing-test]` 标记

### Phase 2（实现 commit）
- [ ] `packages/brain/src/dispatcher.js` 修改完成
- [ ] 运行 `npx vitest run dispatch-fail-autoblock.test.js` 输出 **PASS**
- [ ] 运行既有 dispatcher 测试全部 PASS
- [ ] `DISPATCH_FAIL_AUTOBLOCK_THRESHOLD` 常量已 export（供测试覆盖）

### Phase 3（CI 验证）
- [ ] PR 推送，brain-ci.yml 全绿
- [ ] `gh run view` 确认所有 jobs PASS
- [ ] PR 描述含 task_id 和 autoblock 触发路径说明

---

## 排除范围

以下不在本 Sprint 验收范围内：
- `circuit-breaker.js` 改动
- `dispatch-helpers.js` 改动（候选过滤已原生排除 blocked）
- `task-updater.js` 改动（复用 `blockTask()` 接口）
- `pre-flight-check.js` 三振逻辑（独立，不合并）
- 真实飞书推送（单测 mock alerting 模块即可）

---

## 不变量速查

```
IN-1: configError=true → 不写 dispatch_fail_consecutive，不 autoblock
IN-2: spawn_deduplicated → 不写 dispatch_fail_consecutive，不 autoblock
IN-3: autoblock → blockTask(id, { reason: 'dispatch_fail_autoblock', detail: {...} })
IN-4: success=true → dispatch_fail_consecutive 归零（仅 > 0 时写 DB）
IN-5: DISPATCH_FAIL_AUTOBLOCK_THRESHOLD NaN / < 1 → 回退 3
IN-6: blocked 任务不入候选（selectNextDispatchableTask 已过滤）
IN-7: raise('P2', 'dispatch_fail_autoblock', ...) 每次 autoblock 恰好 1 次
```
