---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`；不修改任何业务代码或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文目标文档位于 `docs/current/attempt-run-bridge-guide.md`
  Test: node -e "const fs=require('fs');const p='docs/current/attempt-run-bridge-guide.md';const s=fs.readFileSync(p,'utf8');if(!s.includes('# attempt-run 桥接使用说明')||!/[一-鿿]/.test(s))process.exit(1)"

- [ ] [ARTIFACT] canonical 全仓 diff 仅含四个冻结合同产物与一页目标文档
  Test: bash -c 'BASE_SHA=807519cd97385f72f2e32d683b7430f84220116f; A=$(mktemp); E=$(mktemp); trap '\''rm -f "$A" "$E"'\'' EXIT; git diff --name-only "$BASE_SHA"...HEAD | sort > "$A"; printf "%s\n" docs/current/attempt-run-bridge-guide.md sprints/coding-harness-20260903232107-kjjvb6/contract-dod.md sprints/coding-harness-20260903232107-kjjvb6/contract-draft.md sprints/coding-harness-20260903232107-kjjvb6/task-plan.json sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts | sort > "$E"; diff -u "$E" "$A"; [ "$(wc -l < "$A" | tr -d " ")" -eq 5 ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 完整解析端点章节且主端点集合恰为两项
  动作: 读者打开文档的端点与用途章节。
  预期观察: `## 端点与用途` 内三级标题集合逐字等于指定 POST/GET，总数与去重数均为 2；重复、缺失、额外主端点均失败。
  等待预算: 0s
  留证: Vitest 详细输出中的端点集合相等与负向额外项断言。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "完整解析端点章节且主端点集合恰为 POST 与 GET 两项"'

- [ ] [BEHAVIOR] [L1] B-02: 宿主和远端分别要求 Bearer 且无泄密或免鉴权误导
  动作: 读者查看 loopback、宿主与远端鉴权说明。
  预期观察: `## 鉴权` 内宿主、远端各自一行逐字携带 Bearer 占位符；真实 token 及宿主或远端免鉴权表述均为 0。
  等待预算: 0s
  留证: Vitest 详细输出中的正向存在及两项负向匹配结果。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "宿主和远端分别要求 Bearer 且负向排除泄密与免鉴权"'

- [ ] [BEHAVIOR] [L1] B-03: 九项角色白名单现场计数与封闭集合一致
  动作: 读者逐项查看角色白名单。
  预期观察: 九个生产角色按权威顺序出现且唯一数为 9；别名和额外项为 0。
  等待预算: 0s
  留证: Vitest 详细输出中的数组相等和 Set 数量断言。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "角色白名单现场计数为九项且封闭集合无别名"'

- [ ] [BEHAVIOR] [L1] B-04: payload 三必填一可选且排除 base_sha 必填
  动作: 读者按字段章节构造 payload。
  预期观察: 必填集合恰为 3 项，可省略集合恰为 `base_sha` 1 项，并说明由生产 Brain 自解析。
  等待预算: 0s
  留证: Vitest 详细输出中的两个集合相等及 `base_sha` 负向断言。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "payload 必填三项可选一项并排除 base_sha 必填"'

- [ ] [BEHAVIOR] [L1] B-05: 三个失败回滚终态自动收敛且非调用方触发
  动作: 读者查看派发失败处理章节。
  预期观察: 三个终态逐字出现且唯一数为 3；错误终态和调用方触发表述均为 0。
  等待预算: 0s
  留证: Vitest 详细输出中的数组相等、Set 数量与负向语义断言。
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts -t "派发失败回滚现场计数为三个自动终态且排除调用方触发"'

- [ ] [BEHAVIOR] [L1] B-06: canonical 全仓范围只有五个枚举路径且业务代码零改动
  动作: 以冻结 implementation baseline 对候选 HEAD 执行全仓 diff。
  预期观察: 输出恰为四个 sprint 合同产物和一个 docs/current 目标文档；额外路径为 0。
  等待预算: 0s
  留证: `git diff --name-only`、`diff -u` 与现场计数输出。
  Test: manual:bash -c 'BASE_SHA=807519cd97385f72f2e32d683b7430f84220116f; A=$(mktemp); E=$(mktemp); trap '\''rm -f "$A" "$E"'\'' EXIT; git diff --name-only "$BASE_SHA"...HEAD | sort > "$A"; printf "%s\n" docs/current/attempt-run-bridge-guide.md sprints/coding-harness-20260903232107-kjjvb6/contract-dod.md sprints/coding-harness-20260903232107-kjjvb6/contract-draft.md sprints/coding-harness-20260903232107-kjjvb6/task-plan.json sprints/coding-harness-20260903232107-kjjvb6/tests/attempt-run-bridge-doc.contract.test.ts | sort > "$E"; diff -u "$E" "$A"; [ "$(wc -l < "$A" | tr -d " ")" -eq 5 ]'

## Invariant 映射

- 端点鉴权：B-02 正向要求 `internalAuthOrLoopback` 与 Bearer，负向拒绝远端免鉴权。
- 凭据安全：B-02 排除任何非占位符 Bearer 值。
- 环境假设：N/A；文档不新增环境值，仅使用环境变量名占位符。
- 真环境验证：N/A；本 sprint 不修改生产行为，仅验证与冻结源码事实一致的静态文档。
- 分支权威：N/A；不改变 Planner 或 Provider 分支行为。
- 基线判定：B-06 固定使用 authoritative implementation baseline SHA，不使用 workspace diff 替代。
- 失败语义：B-05 明确三个失败终态且排除调用方触发。
- 语义验收：B-01 至 B-05 逐项验证具体业务语义，不以通用 ok 判定。
