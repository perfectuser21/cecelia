# 设计：staging_e2e 派生端点（刀4 重构阶段 1/3）

> 用户决策 76ab76ea：relay 模式恢复 staging→production 放行层。Brain task 495e8a31。
> 三阶段：①本 PR=Brain 加端点 ②zenithjoy-skills controller 接线 ③删死图。

## 问题
staging_e2e 任务的唯一派生源是 mergePrNode._spawnStagingE2eTask（harness-task.graph.js），
属于 LangGraph 图。skill-relay 迁移后 controller 自己 merge、图不跑 → 06-27 至 07-07 共 31 run
零 staging_e2e 产生，staging→production 放行层悬空 10 天。删图前必须先把派生迁到图外。

## 方案
新增 POST /api/brain/harness/staging-e2e（packages/brain/src/routes/harness.js，/judge 端点后）。
封装原 _spawnStagingE2eTask 的建任务逻辑，供 controller merge 成功后调用。

### 契约
- body: pr_url(必填) + pr_branch? / sub_task_id? / initiative_id? / journey_id? / base_repo? / project_id?
- 缺 pr_url → 400 {error}
- 幂等：已存在同 pr_url 的 staging_e2e 任务 → HTTP 200 {created:false, reason:already_exists}
- 新建成功 → HTTP 200 {created:true}
- payload 结构与原 _spawnStagingE2eTask 逐字一致，title [Staging E2E] <pr_branch 或 pr_url>，
  description 注明 auto-spawned by controller relay（区别原 mergePrNode 文案）
- best-effort：DB 异常 → 500 但端点内 try/catch 不抛未捕获

### 幂等 SQL（复刻原逻辑）
INSERT INTO tasks (title,description,task_type,status,priority,payload)
SELECT $1,$2,'staging_e2e','queued','P2',$3::jsonb
WHERE NOT EXISTS (SELECT 1 FROM tasks WHERE task_type='staging_e2e' AND payload->>'pr_url'=$4)
用 rowCount 判 created（1=新建，0=幂等跳过）。

## 不做（后续阶段）
- controller skill 接线（阶段 2，zenithjoy-skills PR）
- 删 mergePrNode/_spawnStagingE2eTask/两个图文件（阶段 3，端点验证复活后）
- 本 PR 阶段 mergePrNode 死派生原样保留（反正不 fire），零行为冲突

## 测试策略（unit + smoke）
- routes 单测（mock pool）：建成功 created:true / 幂等 created:false / 缺 pr_url 400 / DB 异常 500 不崩
- smoke：staging-e2e-endpoint-smoke.sh（真端点 400/幂等）+ 登记 smoke-allowlist.txt
