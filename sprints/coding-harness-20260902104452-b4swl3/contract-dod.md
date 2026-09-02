---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`，不修改代码、配置或既有文档。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 新增中文说明且实现 diff 仅含目标文档
  Test: bash -c 'DOC=docs/current/attempt-run-bridge-guide.md; test -f "$DOC"; BASE_SHA=48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3; mapfile -t implementation_files < <(git diff --name-only "$BASE_SHA"...HEAD | grep -v "^sprints/coding-harness-20260902104452-b4swl3/"); [ "${#implementation_files[@]}" -eq 1 ] && [ "${implementation_files[0]}" = "$DOC" ]'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L1] B-01: 两个端点用途与鉴权正负约束
  动作: 打开说明并阅读端点用途与鉴权章节
  预期观察: POST/GET 用途与 Bearer 要求齐全，且无匿名远端或真实 token
  等待预算: 0s
  留证: 对应用例的 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含两个端点用途与鉴权要求，并拒绝匿名远端表述"'

- [ ] [BEHAVIOR] [L1] B-02: 九项角色白名单为封闭集合
  动作: 逐项阅读角色白名单
  预期观察: 权威实现的九项角色按固定顺序且仅出现一次，白名单外角色被排除
  等待预算: 0s
  留证: 对应用例的 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含且仅声明权威实现的九项角色白名单，并排除白名单外角色"'

- [ ] [BEHAVIOR] [L1] B-03: payload 必填集合与 base_sha 省略语义
  动作: 阅读 payload 字段章节
  预期观察: 三个字段逐项标为必填，base_sha 可省略且没有相反表述
  等待预算: 0s
  留证: 对应用例的 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含 payload 必填字段与 base_sha 省略语义，并拒绝错误必填表述"'

- [ ] [BEHAVIOR] [L1] B-04: 派发失败完整回滚且无活跃残留
  动作: 阅读派发失败自动回滚章节
  预期观察: run/session/task 三项终态齐全，且不把活跃状态描述为失败结果
  等待预算: 0s
  留证: 对应用例的 Vitest 输出
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "包含派发失败的三类回滚终态，并排除活跃残留"'

## Invariant 覆盖

- [ ] [ARTIFACT] INV-1 端点鉴权：文档逐字包含 `internalAuthOrLoopback` 与远端 Bearer 要求。
  Test: node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(!f.includes('internalAuthOrLoopback')||!f.includes('Authorization: Bearer $CECELIA_INTERNAL_TOKEN'))process.exit(1)"
- [ ] [ARTIFACT] INV-2 凭据安全：文档不含疑似硬编码 Bearer token。
  Test: node -e "const f=require('fs').readFileSync('docs/current/attempt-run-bridge-guide.md','utf8');if(/Bearer\\s+[A-Za-z0-9_-]{32,}/.test(f))process.exit(1)"
- [ ] [ARTIFACT] INV-3 Planner 分支：N/A，本 sprint 不修改 Planner 分支签发逻辑；proposer 保持当前签发分支。
