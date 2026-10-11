## Brain {VERSION} — 派发只认路由表：无执行者建单即拒 + 工厂/编码独立 task_type + 清卡死单（派发总闸 F）

- 新 `lib/dispatch-route.js`：按 executor 分支顺序判每个类型的真实路由与执行者有无；注册表 surface 与真实路由对齐（talk/research/data 等 → `codex-bridge`，REVIEW 族 → `codex-review`，dev/trigger_backup/content_publish 等无头无执行者 → `none`），守卫测试钉死
- `createRoutedTask` 建单闸：queued + 无执行者（退役 Claude 桥接 / 退役 harness / workflow_run 镜像）建单即拒 `no_executor_for_task_type`（POST /tasks 422），不再进队后 tick 反复 claim→退役通道→回 queued 静默卡死；headed_manual 与非 queued 不拦
- 新 task_type `skill_factory_run`（技能工厂执行单/核验单，原借 research+factory_dispatch）、`coding_workflow`（编码 workflow，原借 data+coding_workflow+headed_manual），迁移 550 进 tasks_task_type_check；tick 按类型排除；旧借壳形状建单自动归一；factory-dispatcher / coding-workflow-runner 兼容新旧形状
- exploratory（画布线停车）/ platform_scraper（内部采集器自领）改 tick_dispatchable=false
- 迁移 550 在途借壳单迁新类型（插接班路由收据）；迁移 551 清理卡死单（a55c7664 cancelled / 02383d3f failed），逐条写 task_events
