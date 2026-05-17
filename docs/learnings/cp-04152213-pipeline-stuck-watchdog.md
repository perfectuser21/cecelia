# Learning: Pipeline-Level Stuck Watchdog

## 问题现象

sprint_dir=harness-v5-e2e-test2（planner task `d8acf398`）连续运行 3 天仍未产出 harness_report：
Evaluator→Fix 循环 47 轮，每轮都"没跑通但也没彻底死掉"。Brain 持续派发 harness_fix / harness_evaluate，
账号 token 被烧掉，slot 被占用，却没有任何模块检测到"pipeline 整体卡死"。

## 根本原因

现有 `pipeline-patrol.js` 的监督粒度是**单个 stage** —— 读 `.dev-mode.*` 文件，看某个 step 是否
停留超时。它管不到 pipeline 整体：每一轮 Evaluator→Fix 都会切换一次 stage / 生成新的 dev-mode 文件，
patrol 看到的永远是"新鲜的 stage"，于是判断为"活跃"。但从业务视角，pipeline 已经 3 天没产出任何
有用进展。缺的是**一个 sprint_dir 级别的"整体进度"监督**。

## 修复

- 新增 `packages/brain/src/pipeline-watchdog.js` 的 `checkStuckPipelines(pool, opts?)`：
  - 按 `sprint_dir` 聚合 harness_* 任务，查 `MAX(updated_at)`
  - 阈值 6h（可配），超过且还有 open 任务、无 completed harness_report → 判定 stuck
  - 批量 UPDATE open 任务为 `canceled` + `error_message='pipeline_stuck'`
  - INSERT `cecelia_events(event_type='pipeline_stuck')` 留痕
- `tick.js` 每 30 分钟调一次，MINIMAL_MODE 下跳过，失败不影响主 tick
- 7 个单元测试覆盖 stuck 命中 / 未过期 / 已完成 / 无 open / 阈值配置 / planner fallback / 任务类型过滤

## 下次预防

- [ ] **监督分层要明确**：stage 级（patrol）+ pipeline 级（watchdog）+ system 级（zombie-sweep）三层互补，新增循环类逻辑时先想清楚"整体如何退出"
- [ ] **任何重试循环都要有"整体预算"**：不是只看单轮成功/失败，而是累积时间/累积 token。Harness GAN 对抗轮数可以无限，但挂钟时间必须有上限
- [ ] **用 sprint_dir 聚合而非 planner_task_id**：tasks 表没有 `planner_task_id` 列，该字段存在 payload 里。DB 查询聚合必须用真实存在的列（`sprint_dir`），planner_task_id 只做展示/告警
- [ ] **恢复路径要提前想好**：stuck 判定基于 `MAX(updated_at) < NOW() - 6h`，意味着手动 PATCH 任一任务即可自动解除 — 不需要额外"解除 stuck" API，避免状态表膨胀
