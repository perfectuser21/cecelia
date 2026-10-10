---
task_id: bd2b1556-8a14-4042-88dc-e7972ba52075
step: spec_review
upstream: ["02-spec.md#S-1", "02-spec.md#S-2"]
---
# 规格评审（第 1 轮）

## 评分
意图对齐: 8
可验证: 8
场景覆盖: 7
回归风险: 6
可执行: 7

### R-1
针对: S-1, I-3
严重度: 重要
场景: 有人在线上用 psql 给 `decisions_category_chk` 加了一个新取值（例如 `retro`），这和规格「现状」里说的线上 13→26 值漂移是同一种做法。之后 coding-workflow 或决策登记台 POST `category:"retro"`，Brain 返回 400「category 非法」，`allowed_categories` 里也没有 `retro`，要等 Brain 重启才恢复。改动前，数据库接受这个值，接口返回 201。
依据: S-1 第 1 点写的是「成功结果缓存在模块变量里，进程内只查一次」，第 2 点规定缓存数组里没有该值就直接 400，不再去问数据库。规格「现状」第 3 条和 `packages/brain/scripts/smoke/notion-inlet-ingest-smoke.sh:26` 都说明，线上约束确实被迁移之外的手段改宽过。所以缓存过期是真会走到的路径，结果是把数据库认可的合法值挡掉（I-3 的「合法 category 写入返回 201」不成立）。
说明: 缓存数组里没有该值时，不要直接 400，先绕过缓存重新读一次约束定义并刷新缓存，仍然没有才返回 400。非法请求本来就少，多一次查询代价可以忽略。另一种做法是给缓存加短 TTL。单测补一条：先缓存旧列表，mock 约束改成含新值后，POST 新值应发出 INSERT 并返回 201。

### R-2
针对: S-1, I-1
严重度: 重要
场景: 开发方照 S-1「验证」写单测。第 1 个用例已经把 `['decision','general','judgment']` 缓存进模块变量。到第 4 个用例「约束查询抛错 + INSERT 抛 23514」时，路由根本不会再查约束，直接用缓存在 INSERT 前返回 400。用例照样是绿的，但 catch 里的 23514 兜底一行都没执行。兜底就算写错（比如仍返回 500 或透出 err.message），CI 也发现不了。
依据: S-1 第 1 点规定缓存是模块级、进程内只查一次，而 vitest 在同一个测试文件里共享模块实例。规格没要求导出缓存重置函数，也没要求 `vi.resetModules()` 后重新 import。第 4 个用例也没指定 category 用什么值，只要是缓存里没有的值，就会被预检拦下。
说明: 规格要明确测试怎么隔离缓存：导出仅供测试用的重置函数（如 `_resetAllowedCategoriesCache()`）在 `beforeEach` 调用，或者每个用例 `vi.resetModules()` 后重新 import。兜底用例的 category 要选一个能通过预检的值，比如约束查询抛错（返回 null，放行）时传 `workflow_bogus`。再断言 INSERT 确实被调用、并且是因为 23514 才返回 400。这样才能证明 I-1「任何情况下都不透出 SQL 原文」的兜底路径真的有效。
