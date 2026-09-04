---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文目标文档位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const s=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[一-鿿]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] canonical 全仓 diff 仅含四个冻结合同产物和一页目标文档
  Test: bash -c 'BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; A=$(mktemp); E=$(mktemp); trap '\''rm -f "$A" "$E"'\'' EXIT; git diff --name-only "$BASE_SHA"...HEAD | sort > "$A"; printf "%s\n" docs/current/attempt-run-bridge-guide.md sprints/coding-harness-20260904034439-v1423a/contract-dod.md sprints/coding-harness-20260904034439-v1423a/contract-draft.md sprints/coding-harness-20260904034439-v1423a/task-plan.json sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts | sort > "$E"; diff -u "$E" "$A"; [ "$(wc -l < "$A" | tr -d " ")" -eq 5 ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 端点用途封闭集合为两项
  动作: 读者打开端点与用途章节。
  预期观察: POST 创建和 GET 查询逐项存在，重复、缺失和额外端点均失败。
  等待预算: 0s
  留证: Vitest 的端点数组、数量和用途断言输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "端点用途封闭集合为 POST 创建与 GET 查询且排除额外端点"'

- [ ] [BEHAVIOR] [L1] B-02: 宿主远端分别要求 Bearer
  动作: 读者查看 loopback、宿主和远端鉴权说明。
  预期观察: 两类非 loopback 来源分别要求 Bearer，占位符外 token 泄露和免鉴权误导均不存在。
  等待预算: 0s
  留证: Vitest 的正向 Bearer 与负向泄密/免鉴权断言输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "宿主和远端分别要求 Bearer 且排除泄密与免鉴权"'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色白名单封闭
  动作: 读者逐项查看角色白名单。
  预期观察: PRD 指定的九项原始拼写按顺序出现，总数和唯一数均为 9，额外角色为零。
  等待预算: 0s
  留证: Vitest 的角色数组与 Set 现场计数输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "角色白名单现场计数九项且封闭集合无额外角色"'

- [ ] [BEHAVIOR] [L1] B-04: payload 三必填一可选并保持实现基线
  动作: 读者按字段章节组装 payload 并理解两类 base_sha。
  预期观察: 必填恰为三项，base_sha 唯一可省略且由生产 Brain 自解析；实现基线不被 workspace checkout 替代。
  等待预算: 0s
  留证: Vitest 的必填/可选集合、基线语义及负向分类输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "payload 必填三项可选一项且排除 base_sha 必填"'

- [ ] [BEHAVIOR] [L1] B-05: 三个失败回滚终态自动收敛
  动作: 读者查看派发失败自动回滚章节。
  预期观察: 三个终态逐项存在且唯一，部分成功与调用方触发回滚的描述均不存在。
  等待预算: 0s
  留证: Vitest 的回滚数组、数量与负向语义输出。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts -t "派发失败回滚现场计数三个自动终态且排除部分成功"'

- [ ] [BEHAVIOR] [L1] B-06: canonical 全仓范围恰为五条路径
  动作: 以冻结 implementation baseline 对候选 HEAD 执行 canonical 全仓 diff。
  预期观察: 四个冻结合同产物与一页目标文档是完整封闭集合，代码路径为零。
  等待预算: 0s
  留证: `git diff --name-only`、现场计数和 `diff -u` 输出。
  Test: manual:bash -c 'BASE_SHA=bdaca81b5cbf78929fa3d8eeac2a24cae6113b98; A=$(mktemp); E=$(mktemp); trap '\''rm -f "$A" "$E"'\'' EXIT; git diff --name-only "$BASE_SHA"...HEAD | sort > "$A"; printf "%s\n" docs/current/attempt-run-bridge-guide.md sprints/coding-harness-20260904034439-v1423a/contract-dod.md sprints/coding-harness-20260904034439-v1423a/contract-draft.md sprints/coding-harness-20260904034439-v1423a/task-plan.json sprints/coding-harness-20260904034439-v1423a/tests/attempt-run-bridge-doc.contract.test.ts | sort > "$E"; diff -u "$E" "$A"; [ "$(wc -l < "$A" | tr -d " ")" -eq 5 ]'

## Invariant 映射

- 规划分支：N/A；本 Sprint 不改变 planner workspace 或 Provider 行为。
- 权威地址：N/A；本 Sprint 不改变 Dispatcher、Fleet Worker 或 HARNESS_BRAIN_URL。
- 基线权威：B-04 与 B-06 明确实现基线固定，并以 task payload 的冻结 SHA 做范围判定。
