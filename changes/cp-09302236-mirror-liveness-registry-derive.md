## Brain {VERSION} — 外部 run 镜像类型改从注册表派生（修 #5729 触发的 task-type-registry 守卫红）

- `lib/external-mirror-liveness.js`：`EXTERNAL_RUN_MIRROR_*_TASK_TYPES` 从 TASK_TYPE_REGISTRY 派生（workflow+external+watchdog=none → workflow_run；surface=device → device_job），判龄 SQL IN 列表由派生集合拼出，不再手抄类型名（铁律 76cb816c）；单测钉合集恰为两者，注册表漂移即红
- `task-type-registry.guard.test.js` 豁免清单 executor.js `_TASK_ROUTES` 行号 2330→2339（#5729 在其上方加了 import 与账本声明）
- 补 #5729 的 handoff 镜像 `docs/handoffs/202609302240-0004aceb.md`
