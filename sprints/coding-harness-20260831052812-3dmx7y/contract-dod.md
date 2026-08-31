---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改任何代码。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且以《attempt-run 桥接使用说明》为标题
  Test: node -e "const c=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!c.includes('# attempt-run 桥接使用说明'))process.exit(1)"
- [ ] [ARTIFACT] 实现范围相对冻结 baseline 仅包含一份 docs/current 文档
  Test: bash -c 'C=$(git diff --name-only 98bc3594876bcf53b428d4b1256d9c1e695494c2...HEAD | awk '"'"'index($0,"sprints/coding-harness-20260831052812-3dmx7y/")!=1'"'"'); [ "$C" = "docs/current/attempt-run-bridge-guide.md" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 端点用途节串联同一 attempt-run
  动作: 阅读“端点用途”独立章节，并按 POST 返回的 attempt_id 构造 GET 查询。
  预期观察: POST 被说明为异步派发，GET 被说明为查询该 POST 创建的同一 attempt-run，而非另建 run。
  等待预算: 0s
  留证: 校验器 stdout 中的 `PASS endpoints`
  Test: manual:bash -c 'node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs endpoints'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权方式节要求远端 Bearer
  动作: 阅读“鉴权方式”独立章节并检查宿主/远端调用说明。
  预期观察: 章节同时出现 internalAuthOrLoopback 与 Authorization: Bearer CECELIA_INTERNAL_TOKEN，并明确宿主/远端必须携带。
  等待预算: 0s
  留证: 校验器 stdout 中的 `PASS auth`
  Test: manual:bash -c 'node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs auth'

- [ ] [BEHAVIOR] [L2] B-03: 角色与 payload 节匹配九角色精确集合
  动作: 解析文档角色列表并与生产路由 ALLOWED_ROLES 的源码集合比较，同时读取 payload 字段义务。
  预期观察: 文档恰含 canary、planner、proposer、reviewer、generator、generator-fix、evaluator、evaluator-evidence-repair、judge，且三个字段必填、base_sha 可省略并由生产 Brain 自解析。
  等待预算: 0s
  留证: 校验器 stdout 中的 `PASS roles-payload` 与九角色 JSON
  Test: manual:bash -c 'node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs roles-payload'

- [ ] [BEHAVIOR] [L2] B-04: 失败回滚节包含三个终态
  动作: 阅读“派发失败自动回滚”独立章节并逐项检查 run、session、task。
  预期观察: 派发失败自动收敛为 run→failed、session→closed、task→cancelled，三项均未遗漏。
  等待预算: 0s
  留证: 校验器 stdout 中的 `PASS rollback`
  Test: manual:bash -c 'node sprints/coding-harness-20260831052812-3dmx7y/tests/verify-attempt-run-guide.mjs rollback'

## Invariant 映射

- INV-1 [规划分支]: N/A — 实现不触及 Planner workspace 或分支切换；E2E 固定以 implementation baseline 作 diff 基准。
- INV-2 [合同枚举]: B-03 从生产 `ALLOWED_ROLES` SSOT 解析集合并与文档精确比较，不以行数代替集合相等。
