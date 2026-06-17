# Learning: cp-06101131 修 schema 版本双门禁死锁（issue 14d66027）

## 背景
加 Brain migration 时 `EXPECTED_SCHEMA_VERSION` 被两个门禁互相矛盾地要求，导致死锁。Phase 1/2a 都被它绕一大圈。

## 根本原因
`EXPECTED_SCHEMA_VERSION`（selfcheck.js）注释写明是 **"Minimum acceptable migration version (DB must be >= this)"**——即**地板**。但两个门禁对它的要求打架：
1. **`scripts/facts-check.mjs:390`** 用 `selfcheckVersion === highestMigration` 要求**严格相等**（本地 pre-push hook 跑它，不等就 block push）。
2. **CI brain-unit** 有两处硬断言 `expect(EXPECTED_SCHEMA_VERSION).toBe('293')`（selfcheck.test.js + learnings-vectorize.test.js）。

→ 加 migration 后：bump 版本号 → CI 挂（测试要 293）；不 bump → 本地 facts-check 拦。**怎么都过不去。** main 自身长期 293 vs 297/298 不一致，靠"另一个 quickcheck 在跑跳过预检"的竞态侥幸 push。
另外 hook 用 `git rev-parse --show-toplevel` 读**主仓库**而非当前 worktree，worktree 里改对了也被主仓库旧值拦。

## 修法
把 `facts-check.mjs` 的 `===` 改为**地板语义 `Number(selfcheck) <= Number(highest)`**：地板不超过现有最高 migration 即合法，不要求相等。
- 本地 hook 不再要求 bump → 保持 293、加 migration 不拦 ✅
- CI 测试照旧绿（293==293）✅
- 顺带让"读主仓库还是 worktree"不再要紧（293 ≤ 任何号都成立）✅
- 两个测试加注释，标注 293 是地板、加 migration 不要 bump，防复发。

## 下次预防
- [ ] 加 migration **不要** bump `EXPECTED_SCHEMA_VERSION`（它是地板，保持 293）。
- [ ] 本地 push 被 facts-check selfcheck_version_sync 拦时，确认已是本修复后的 `<=` 逻辑；若仍报错说明主仓库 checkout 在旧分支（hook 不认 worktree 的残留问题）。
- [ ] worktree 跑测试前软链根 + packages/brain 两处 node_modules。
- [ ] grep 失败测试用 `×`(U+00D7) 而非 `✗`——vitest CI 输出用前者，用错会漏看失败。

## 关联
- Issue: 14d66027（schema 版本双门禁打架 + hook 不认 worktree）
- 承接 Phase 1 cp-06100848 / Phase 2a cp-06101029 的同源教训（终于根治）
