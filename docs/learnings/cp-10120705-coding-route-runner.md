## 编码单改投 coding_workflow runner（2026-10-12）

### 根本原因

- A1 只关了无头 kernel 派发（drain 标 failed=retired_harness_kernel），但三个建单方仍把编码单写成 harness_initiative：work-router `selectPipeline` 对所有 coding_mutation 一律给 harness_initiative，relay-baton 编码子单按 `dev` 建单再被路由成 harness_initiative，GP 签字实现单直接请求 harness_initiative。结果是无头编码单建出来就被 drain，事实上无人执行。
- 有头 /dev 与 Codex 会话也走同一条路由记账：近 14 天约 100 单 harness_initiative 没带 headed_manual，靠建单后 0.2 秒内 PATCH in_progress 记账（executor_kind=headed-session）。所以「有头」不能只认 headed_manual，非 queued|blocked 入账与 executor_kind=headed-session 也要算有头账本行。
- runner 只认 cecelia（开工时 plan.mjs 写死 Set，#6347 改成 repos.json），Brain 要判断「这张无头单 runner 接不接」只能读同一份清单（runner/lib/repos.mjs 的 resolveRepo + enabledRepos）；本 PR 开工时先自建了零依赖 repos.mjs，rebase 撞上 #6347 后改用其读表函数，避免两份；Brain 镜像按白名单 COPY，`src` 引用 `scripts/` 下文件必须同步加 COPY 和构建期导入守卫，否则上产即启动崩溃。

### 下次预防

- [ ] 改任务路由形态前先查 work_routing_receipts 的幂等比较（pipeline/canonical/orchestrator 全比），老来源重放会撞 work_route_idempotency_conflict，要给旧形态留兼容。
- [ ] 改 canonical_task_type 要查 421 投影触发器（task_type/repo/impact_contract_required 必须与收据一致）和按 task_type 写死的 SQL（GP 换版取消、重试幂等），类型清单走 registry 标签派生，别在 SQL 里手抄（task-type-registry 守卫会拦）。
- [ ] kernel 内部续跑（planner recovery）不是「编码单」：它要绑 kernel run 收据，改投 runner 会让 kernel 绑定直接 not eligible；这类单用显式 kernel_continuation 标记留在 kernel 形态，随删 kernel 代码一并移除。
- [ ] Brain 集成测试本地跑用 `DB_NAME=cecelia_scratch DB_HOST=/tmp DB_USER=administrator DATABASE_URL=postgresql://administrator@localhost:5432/cecelia_scratch`；先在 origin/main 基线跑同一组拿基线失败数，再比对本分支新增失败。
