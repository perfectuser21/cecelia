contract_branch: cp-07231921-harness-propose-r1-137fea96
sprint_dir: sprints/07240614-relay-137fea96

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: postdeploy-verifier smoke 任务清理机制真正生效

**范围**: `packages/brain/src/routes/task-tasks.js` 新增 `DELETE /:id`（软删除，复用 `TERMINAL_STATUSES` 保护）；`packages/brain/src/postdeploy-verifier.js` 的 `fetchPendingBatch` 排除 `title LIKE 'smoke:%'` 前缀任务
**大小**: S

> 说明：本文件为 `sprints/07240614-relay-137fea96/contract-dod.md`（GAN 已批准的合同 DoD）
> 在 CI `dod-behavior-dynamic`（`.github/workflows/ci.yml`，只识别单行 `Test: manual:bash -c '...'`，
> 不解析 fenced ` ```bash ` 多行代码块）可执行环境下的等价改写：assertion 逻辑与合同 contract-dod.md
> 逐条一致，只是把每条 [BEHAVIOR] 的多行脚本体搬进 `sprints/07240614-relay-137fea96/manual/*.sh`
> 独立文件，Test 行改成单行 `manual:bash -c 'bash <script>'` 调用同一份脚本（历史先例：PR #4225
> `sprints/07231146-relay-1b1f1ffa` 的 DoD.md 即用此 `manual:bash -c '...'` 单行约定）。

## ARTIFACT 条目

- [x] [ARTIFACT] `task-tasks.js` 新增 DELETE 路由，复用既有 `TERMINAL_STATUSES` 常量（不新建第二套终态定义）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-tasks.js','utf8'); if(!/router\.delete\(['\"]\/:id['\"]/.test(c)) process.exit(1); if(!/TERMINAL_STATUSES/.test(c)) process.exit(1);"

- [x] [ARTIFACT] `postdeploy-verifier.js` 的 `fetchPendingBatch` SQL 含 `smoke:` 前缀排除条件
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/postdeploy-verifier.js','utf8'); const m=c.match(/async function fetchPendingBatch[\s\S]*?\n}/); if(!m || !/NOT LIKE\s+'smoke:%'/.test(m[0])) process.exit(1);"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，target_environment=local_api，真实 Brain + 真实 Postgres）

- [x] [BEHAVIOR] 存在的非终态任务发起 DELETE → HTTP 200，响应体 status=cancelled，且 DB 行 status 真实变为 cancelled（不信任响应体自证，双重校验）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b1-delete-ok.sh'
  期望: OK（且各处断言均未提前以非零 exit 中断）

- [x] [BEHAVIOR] 不存在的任务 id 发起 DELETE → HTTP 404，响应体含 error 字段 (string) 且 id 字段回显请求的任务 id，不产生任何 DB 变更
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b2-delete-404.sh'
  期望: OK

- [x] [BEHAVIOR] 已 completed 的任务发起 DELETE → HTTP 409，响应体含 error/details（均为 string），DB 行 status 保持 completed（未被误改，防误删历史记录）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b3-delete-completed-409.sh'
  期望: OK

- [x] [BEHAVIOR] 已 cancelled 的任务再次发起 DELETE → HTTP 409，响应体含 error/details（均为 string）（幂等边界，TERMINAL_STATUSES 同时覆盖 completed 与 cancelled）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b4-delete-cancelled-409.sh'
  期望: OK

- [x] [BEHAVIOR] title 以 "smoke:" 开头的 pending_postdeploy 任务 → 真实调用 runPostdeployVerifier() 扫描后，status 仍为 pending_postdeploy（未被消费/未标 completed/failed，payload 无 postdeploy_retry_count 写入）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b5-smoke-filter-excluded.sh'
  期望: OK

- [x] [BEHAVIOR] 对照：不带 smoke: 前缀的同批次任务 → 正常被 runPostdeployVerifier() 消费，status 变为 completed（证明过滤是选择性排除，未打坏整个批次消费机制）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b6-smoke-filter-control.sh'
  期望: OK

- [x] [BEHAVIOR] postdeploy-verifier-smoke.sh 全脚本回归 — Step 3 清理命中新 DELETE 路由（200），脚本创建的任务最终 DB status='cancelled'（PRD 背景段描述的根因链路已断开）
  Test: manual:bash -c 'bash sprints/07240614-relay-137fea96/manual/b7-smoke-script-regression.sh'
  期望: OK
