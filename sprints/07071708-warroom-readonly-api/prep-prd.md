# 小改动 PrepPRD：Brain API 补 warroom 数据层 2 个只读端点

## 改什么
1. `GET /api/brain/handoffs?limit=20&journey_id=` — 新路由文件 packages/brain/src/routes/handoffs.js：
   从 tasks 表 `result ? 'handoff'` 捞交接单摘要（task_id/title/verdict/journey_id/created_at/next_steps/artifacts.pr_urls），
   按 handoff.created_at 倒序，可选 journey_id 过滤（匹配 handoff->>'journey_id' 或 payload->>'journey_id'），limit 上限 100。
2. `GET /api/brain/sentinel/health` — 新路由文件 packages/brain/src/routes/sentinel.js：
   查 working_memory 全部 `scheduler_job_last_run:*` 键 + `scheduler_jobs_expected`，
   输出 `{jobs:[{name, ok, age_seconds, at}], expected, healthy}`；
   healthy = 键数 >= expected 且每个 job 的 age_seconds <= 阈值（30min，与死人开关 STALE_MINUTES 同量级）且 ok=true。
3. decisions/recent 端点：**跳过**（交接单允许）——server.js 的 `GET /api/brain/decisions` 已支持 made_by/limit 过滤，item2 前端直接用。

## 为什么改
relay-baton4 item1：warroom 前端动态化（item2）的数据层前置。数据都在库里，只缺读口。

## 关联上下文
- Journey：Cecelia Harness Pipeline（bb8cc561）
- 上游：docs/handoffs/202607070903-relay-baton4.md
- 数据源代码：packages/brain/src/handoff.js（saveHandoff 写 tasks.result.handoff）、packages/brain/src/scheduler-jobs.js（哨兵键）

## 影响范围
纯新增只读路由（挂进 src/routes.js 的 brainRoutes），不改任何写路径。brain minor bump 1.238.6 → 1.239.0。

## 验收标准
- [ ] 两个端点各有 vitest 单测（mock pool，先红后绿）
- [ ] handoffs：倒序/journey_id 过滤/limit 上限/空库返回 [] 均有断言
- [ ] sentinel/health：全绿、缺 job（数量<expected）、过期 job（age 超阈值）、job ok=false 四种局面断言 healthy 真值
- [ ] DevGate 过（facts-check + check-version-sync + node --check server.js）
- [ ] CI 全绿
