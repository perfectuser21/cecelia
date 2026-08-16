---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: 有头 /dev 收编：Work Router receipt 有头签发口

**范围**: Brain 新增 `POST /api/brain/work-routing/headed-attempts` 签发口（validate SQL 语义不动）+ 收尾 PATCH completed；Engine `worktree-manage.sh` 有 `--task-id` 时调签发口/改 cp-branch/写六字段 lock/导 env；Hook 补 worktree-manage.sh 精确路径 bootstrap 逃生口。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] Brain 签发口 handler 存在（work-routing.js 内新增 headed-attempts 路由）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/routes/work-routing.js','utf8');if(!c.includes('headed-attempts'))process.exit(1)"

- [ ] [ARTIFACT] Hook 补 worktree-manage.sh 精确路径 bootstrap 逃生口（无 lock 时放行该命令）
  Test: node -e "const c=require('fs').readFileSync('packages/engine/hooks/dev-mode-tool-guard.sh','utf8');if(!c.includes('worktree-manage.sh'))process.exit(1)"

- [ ] [ARTIFACT] worktree-manage.sh 支持 --task-id：调签发口 + 改 cp-branch + 写六字段 lock
  Test: node -e "const c=require('fs').readFileSync('packages/engine/skills/dev/scripts/worktree-manage.sh','utf8');if(!(c.includes('--task-id')&&c.includes('headed-attempts')))process.exit(1)"

- [ ] [ARTIFACT] E2E 种子脚本存在（真写已路由 task + receipt + active v2 run，禁伪造）
  Test: node -e "require('fs').accessSync('sprints/08160845-kernel-0ca4b234/e2e-seed-routed-task.mjs')"

- [ ] [ARTIFACT] Brain semver bump 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash scripts/check-version-sync.sh

- [ ] [ARTIFACT] Engine hook 改动三要素之 feature-registry changelog 更新
  Test: node -e "const c=require('fs').readFileSync('packages/engine/feature-registry.yml','utf8');if(!c.includes('headed'))process.exit(1)"

## BEHAVIOR 条目（五行剧本 — evaluator 照此真实执行）

- [ ] [BEHAVIOR] [L2] B-01: 无 lock 时 hook 仅放行 worktree-manage.sh 精确路径，其余 Bash 仍 block
  动作: 在无 .dev-lock/无 scoped env 的 worktree 里，(a) 用 tool_input.command=`bash <绝对路径>/worktree-manage.sh …` 调 Bash，(b) 用 `echo ok` 调 Bash
  预期观察: (a) hook exit 0（放行 bootstrap），(b) hook exit 2 且 reason 含 route_violation
  等待预算: 0s
  留证: dev-mode-tool-guard.test.sh 输出（含 bootstrap 放行 case + 非 worktree-manage block case 的 ✅ 行）
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-tool-guard.test.sh'

- [ ] [BEHAVIOR] [L2] B-02: 有 lock 但 validate 返回 run_attempt_inactive → hook block [接缝×2]
  动作: 构造六字段 lock，curl 替身返回 {"valid":false,"reason_code":"run_attempt_inactive"}，对 Bash `echo ok` 调 hook
  预期观察: hook exit 2，reason 含 route_violation（inactive attempt 不放行）
  等待预算: 0s
  留证: dev-mode-tool-guard.test.sh 中 run_attempt_inactive block case 的 ✅ 行
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-tool-guard.test.sh'

- [ ] [BEHAVIOR] [L2] B-03: 签发口对无 routing_receipt_id 的 task 400（不写库）；对已路由 task 返回 route_token 且 harness_attempts 新行 status=running/workspace_spec 正确
  动作: 真 Postgres 上分别 POST /headed-attempts（无 receipt task）与（已路由 task）
  预期观察: 无 receipt → HTTP 400 且无新 harness_attempts 行；已路由 → HTTP 201 返回 route_token(64hex)，harness_attempts 新行 status=running、workspace_spec.branch/base_sha 正确、role∈CHECK 枚举、attempt_kind∈CHECK 枚举、lease_owner LIKE 'headed:%'
  等待预算: 0s
  留证: vitest 集成测试输出（passed）+ 断言的 count/status 行
  Test: manual:bash -c 'cd packages/brain && DATABASE_URL="${DB_URL:?}" npx vitest run --config vitest.integration.config.js src/__tests__/integration/headed-attempts.pg.integration.test.js'

- [ ] [BEHAVIOR] [L2] B-04: validate 带签发口返回的 route_token+branch+base_sha 返回 valid:true；attempt completed 后 validate 返回 409 run_attempt_inactive
  动作: 真 Postgres 上 issue → POST /work-routing/validate（X-Harness-Route-Token=route_token）→ UPDATE attempt status=completed → 再 validate
  预期观察: 第一次 valid:true（HTTP 200）；completed 后 HTTP 409 且 reason_code=run_attempt_inactive
  等待预算: 0s
  留证: vitest 集成测试输出（同文件覆盖往返 + 409）
  Test: manual:bash -c 'cd packages/brain && DATABASE_URL="${DB_URL:?}" npx vitest run --config vitest.integration.config.js src/__tests__/integration/headed-attempts.pg.integration.test.js'

## Invariant 覆盖（铁律逐条映射）

- [ ] [BEHAVIOR] INV-1 [同闸门 c3617bdf] 签发口不放松闸语义：非 worktree-manage Bash 无 lock 仍 block、inactive attempt validate 仍 409（B-01/B-02/B-04 覆盖）
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-tool-guard.test.sh'
- [ ] [BEHAVIOR] INV-2 [端点鉴权] 签发口走既有 internal token 鉴权（workRoutingAuthorization），非裸开
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"packages/brain/src/routes/work-routing.js\",\"utf8\");if(!c.includes(\"workRoutingAuthorization\"))process.exit(1)"'
- [ ] [BEHAVIOR] INV-3 [禁写死环境] 端点/URL/base_sha 走 env 与 payload：worktree-manage 用 CECELIA_ROUTING_HEADED_URL/BRAIN_URL，不写死
  Test: manual:bash -c 'grep -Eq "CECELIA_ROUTING_HEADED_URL|BRAIN_URL" packages/engine/skills/dev/scripts/worktree-manage.sh'
- [ ] [BEHAVIOR] INV-4 [真环境验证] psql 查 harness_attempts headed 行 + hook 真返回非 block（E2E 验收点④③覆盖，真 Brain+真 PG）
  Test: manual:bash -c 'grep -q "harness_attempts" sprints/08160845-kernel-0ca4b234/contract-draft.md'
- INV-5 [session env 不继承] worktree-manage 显式 export CECELIA_ROUTING_VALIDATE_URL/CECELIA_ROUTING_VALIDATION_TOKEN 供 Claude session 内 hook 用（在 worktree-manage.sh --task-id 分支实现，E2E 通过 hook 读 env 间接验证）
- INV-6 [headed worktree_path] 签发口写 attempt 时把 worktree_path 随 workspace_spec 落 task_bundle（复用 createHeadedKernelAttempt 既有 jsonb 写法，B-03 断言 workspace_spec）
- INV-7 [headed base_repo] cp-branch 名带 task short id（slug）、repo 记入 lock 与 workspace_spec（B-03 + E2E 六字段 jq 覆盖）
- INV-8 [planner_role_branch] N/A：本 sprint 不涉及 planner 自行 checkout/switch，签发口只发 attempt 不动 planner 分支绑定
- INV-9 [租户隔离] N/A：签发口/validate 为内部端点，无多租户业务数据面，不触及租户资源隔离

## 已知约束回归（不得回退）

- [ ] [BEHAVIOR] REG-1 现有 routing-receipt-guard 回归全绿（scoped token / 六字段 / baseline 祖先 / Edit fail-closed / Read 放行）
  Test: manual:bash -c 'bash packages/engine/tests/integration/dev-mode-routing-receipt-guard.test.sh'
- [ ] [BEHAVIOR] REG-2 validate SQL 语义不改（含 attempt.callback_secret_hash = $7、读 x-harness-route-token）
  Test: manual:bash -c 'cd packages/brain && npx vitest run src/routes/__tests__/work-routing.test.js src/__tests__/work-routing-validation-route.integration.test.js'
