## Brain {VERSION} — 棒3a-2：business-probe-judge 无 anchor 时按 run_id 解析 workflow 兜底判定（任务 1be07583）

- 09-27 06:00 获客链生产首跑：zenithjoy device_job 镜像建的 Brain 任务 `payload.anchor` 为空，判定器只按 journey_id 查 step_probes → run.finished 到了也 `skipped no_anchor`，格子永不翻色
- `lib/business-probe-judge.js`：无锚时取 `result.workflow`，否则从 run_id `<workflow>-crontab-<TAG>__aN.<stage>` 解析 workflow，改查 `step_probes.workflow + stage`（保留 active 过滤与 journey_step_links JOIN）；两者皆无 → `skipped: no_anchor_no_workflow`；有锚仍走原路径
- 判定成功且探针指向唯一 journey → 一次性回填 `tasks.payload.anchor.journey_id`（仅为空时写），便于地图/晨报按锚聚合；跨多 journey 不回填
- 单测 6 条 + pg 集成 2 条（无锚镜像任务全链翻色/回填、无 workflow 不写回执）
