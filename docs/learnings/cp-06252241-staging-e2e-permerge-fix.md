# Learning — Slice1 修正：per-merge 触发 + pr_url 幂等（重复建造根因）

> 分支：cp-0625223242-staging-e2e-permerge-fix
> 日期：2026-06-25

## 背景

阶段2 Slice1（merge 后 staging 部署 + 自动 E2E）被**两条分支同时实现**：
- #3425（cp-0625134253）：Cecelia 自主 run（headless），先合入 main。挂在 initiative reportNode
  （per-initiative 粒度，取 first sub_task 的 pr_url），**无任何幂等去重**。
- #3426（我，cp-0625212445）：挂在 mergePrNode（per-merge，符合 spec §3 "sub_task 合并后"），
  带 pr_url UNIQUE + NOT EXISTS 双闸幂等。两边 add/add 冲突。

团队决策 C：不硬回退 #3425，在其基础上叠增量修正 PR 把 main 改到 spec 合规。

## 做了什么

- migration 305：在已合 304 表上 ALTER 加 `pr_url UNIQUE`（不重建 304，migration 只一份）。
- 删 reportNode 的 per-initiative 无去重 `INSERT INTO tasks 'staging_e2e'`，挪到 mergePrNode。
- mergePrNode 两条 merged 分支 best-effort 派生 staging_e2e（pr_url NOT EXISTS 去重，try/catch 永不 throw）。
- recordResult 落 verdict 加 `ON CONFLICT (pr_url) DO NOTHING`。
- 复用 #3425 的 runner 骨架（STAGING_PORT=5222 + :5221→:5222 重写，皇冠断言保留）。
- 把 #3425 的 reportNode spawn 测试改成回归守卫（断言不再派生）。

### 根本原因

**两个根因，都不是代码本身：**

1. **重复建造**：spec §3 写"sub_task 合并后"=per-merge，但 #3425 的自主 run 实现成了
   per-initiative reportNode + 取 first pr_url，偏离原义；且完全没幂等。根因是**同一任务被两条
   执行路径并行接走**——我注册了有头 Brain 任务在本机跑，同时 Cecelia 自主调度器把同一意图的
   任务 headless 跑了一份（#3425 commit 带 `Co-authored-by: Cecelia Bot` 是铁证）。两份互不知情，
   先合的占坑、后到的冲突。

2. **无幂等的派生**：reportNode/mergePrNode 这类 merge 后副作用节点天然会重入（graph resume /
   BEHIND 重试 / 已被外部合并分支），裸 `INSERT INTO tasks` 必然重复派任务。幂等不是可选项。

### 下次预防

- **动手前先查重**：实现任何"已在 spec/roadmap 里、可能被 Brain 自主调度接走"的任务前，先
  `git ls-remote --heads origin | grep <feature>` + 查 Brain 同意图任务 status，确认没有并行 run。
  发现已有 → 不重复造，改为增量修正或认领既有。
- **注册 Brain 任务即占坑**：有头模式注册任务后，应立刻把它标 in_progress/claimed，避免自主调度器
  另起一份。本次修正 PR **不再注册新 Brain 任务**（防第三次重复建造），并把原 #312fb32b 标 completed。
- **merge 后副作用一律幂等**：DB 级 UNIQUE + 建任务 NOT EXISTS 双闸，配 best-effort try/catch 永不 throw。
- **per-merge vs per-initiative 看 spec 原文**：spec 写"sub_task 合并后"就是 per-merge，别图省事挂 reportNode。

## checklist

- [x] migration 305 ALTER 加 pr_url UNIQUE（不重建已合 304）
- [x] reportNode 不再派生 staging_e2e（回归守卫测试）
- [x] mergePrNode 两条 merged 分支 per-merge 派生 + pr_url NOT EXISTS 幂等
- [x] recordResult ON CONFLICT(pr_url) DO NOTHING
- [x] 皇冠断言保留（STAGING_PORT=5222 + :5221→:5222）
- [x] 真 Postgres 验两层幂等（重复 pr_url INSERT 被挡，不覆盖 verdict）
- [x] 不注册新 Brain 任务（防第三次重复建造），原任务标 completed
- [x] DevGate 三件套全过
