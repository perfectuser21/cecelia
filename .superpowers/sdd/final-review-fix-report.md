# 终审修复报告 — 协议卫生包（cp-07092001-protocol-hygiene-pack）

## Important 1：executor.js dedupe key 泄漏（server_overloaded 分支）

**问题**：DB 级 `claimDedupeKey('spawn', ...)` 在 DEDUP CHECK 之后、RESOURCE CHECK 之前被 claim。
`checkServerResources()` 判定过载时直接 `return`，未 release，导致该 task_id 的 spawn dedupe key
被占用 120s TTL，期间即使资源恢复也无法重新 spawn 同一 task。

**修法**：把整个 claim 块（含 `dedupeMod` 动态 import 与 `spawnClaim` 赋值）从 RESOURCE CHECK
之前挪到之后、`checkpointId` 赋值之前（docker/bridge spawn 分支之前）。挪动后语义变为：
内存 DEDUP CHECK → RESOURCE CHECK → DB claim → spawn。`server_overloaded` 分支现在完全走在
claim 之前，不可能再泄漏 key。`spawnClaim`/`releaseDedupeKey`/`spawned` 三个变量声明位置
（try 外）与 outer catch / bridge_error 分支的 release 逻辑未动。

文件：`packages/brain/src/executor.js`（约 L3405-3433）

## Important 2：dispatcher.js 把 spawn_deduplicated 误计入 cecelia-run 熔断

**问题**：`!execResult.success` 分支里，`recordFailure('cecelia-run')` 对所有非 configError
的失败原因都会调用，包括良性的 `spawn_deduplicated`（DB 级去重命中，属正常防重入，非执行故障）。
抖动期正常去重会被计入熔断计数，可能误停派全系统。

**修法**：仿照现有 `configError` 的写法，给 `execResult.reason === 'spawn_deduplicated'` 加同等
carve-out：任务照常回退 queued（不变），但跳过 `recordFailure('cecelia-run')`。

文件：`packages/brain/src/dispatcher.js`（约 L673-682）

## 测试更新：executor-spawn-dedupe.test.js

- 新增断言：claim 出现在 `=== RESOURCE CHECK ===` 之后、`HARNESS_DOCKER_ENABLED`（docker/bridge
  spawn 分支起点）之前。
- 新增断言：`server_overloaded` 的 return 出现在 claim 之前（indexOf 顺序断言），验证资源过载
  路径不可能泄漏 dedupe key。
- 新增 `describe('dispatcher spawn_deduplicated carve-out（结构断言）')`：验证 dispatcher.js 中
  `spawn_deduplicated` 分支出现在 `configError` 判断之后、`recordFailure('cecelia-run')` 调用之前
  （即被排除在熔断计数之外）。

文件：`packages/brain/src/__tests__/executor-spawn-dedupe.test.js`

## Minor 3：actions.js createTask JSDoc 补全

补充 `@param {string} [params.dedupe_key]` 和 `@param {number} [params.dedupe_ttl_sec]`，说明
dedupe_key 是 DB 级幂等键（≤255 字符，超长调用方自行 hash，超长会抛错），dedupe_ttl_sec 默认
3600 秒。

文件：`packages/brain/src/actions.js`（约 L92-93 后）

## Minor 4：account-usage.js 注释措辞修正

原注释"去重完全交给 raise() 的 debounce（n:2 连续确认 + 2h 冷却），每个检查周期都调用"表述不够
准确。改为说明：`proactiveTokenCheck` 每个 dispatch tick 都会执行到这里；`n:2` 表示连续 2 个 tick
都确认过期才真正响铃，响铃后进入 2h 冷却，真正防止重复告警的是这个 2h 冷却而非 n:2 本身。

文件：`packages/brain/src/account-usage.js`（约 L316）

## 插曲：worktree 被外部进程清空需重建

修复过程中，`/Users/administrator/worktrees/cecelia/session-1ff8b3c4` 整个工作目录被外部进程
清空（`git worktree list` 显示该 worktree 已从注册表移除，与 memory 记录的"worktree 收割器"
已知基础设施问题一致）。已用 `git worktree add` 在原路径重新检出 `cp-07092001-protocol-hygiene-pack`
分支，重建 `.dev-mode.<branch>` 门禁文件，软链根 `node_modules` 到主仓（未在 worktree 内跑
`npm install`，避免穿透软链污染主仓 node_modules），并重新应用全部四处代码修复 + 测试更新。
最终验证结果如下。

## 自测结果

```
npx vitest run src/__tests__/executor-spawn-dedupe.test.js --pool=forks
→ 7 passed (7)

bash scripts/setup-test-db.sh  → cecelia_test 准备就绪（无新迁移需应用）
NODE_ENV=test DB_NAME=cecelia_test npx vitest run src/__tests__/actions-dedupe-key.test.js --pool=forks
→ 3 passed (3)

npx vitest run src/__tests__/account-usage-proactive.test.js --pool=forks
→ 8 passed (8)

NODE_ENV=test DB_NAME=cecelia_test npx vitest run <11 个 dispatcher*.test.js 文件> --pool=forks
→ 11 files passed, 36 tests passed

node --check src/executor.js && node --check src/dispatcher.js && node --check src/actions.js
→ SYNTAX OK
```

无失败用例。
