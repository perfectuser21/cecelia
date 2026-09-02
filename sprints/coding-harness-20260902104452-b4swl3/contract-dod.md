---
skeleton: false
journey_type: autonomous
---
# Contract DoD — attempt-run 桥接使用说明

task_request_hash: 36b99953756db7bbfbaa29fd6871c56a549f04acbec458352388564d4538b039

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md`
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 中文说明文档存在且是相对冻结基线新增文件
  Test: bash -c 'test -f docs/current/attempt-run-bridge-guide.md && git diff --diff-filter=A --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3 HEAD -- docs/current/attempt-run-bridge-guide.md | grep -qx docs/current/attempt-run-bridge-guide.md'

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 阅读者看到两个端点的用途
  动作: 打开 attempt-run 桥接使用说明并阅读端点章节
  预期观察: POST 被说明为创建并派发一次运行，GET 被说明为按 id 查询运行状态
  等待预算: 0s
  留证: Vitest 详细输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "文档存在且为中文并说明两个端点用途"'

- [ ] [BEHAVIOR] [L2] B-02: 阅读者获得安全且完整的鉴权说明
  动作: 阅读两个端点的鉴权章节
  预期观察: 两端点均受 internalAuthOrLoopback 保护，宿主和远端必须携带 Bearer token 占位符且无真实凭据
  等待预算: 0s
  留证: Vitest 详细输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权说明覆盖两个端点且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] B-03: 阅读者看到严格等于冻结 PRD 的九项角色集合
  动作: 阅读角色白名单章节并逐项核对
  预期观察: 集合仅含 planner、proposer、critic、generator、generator-fix、evaluator、evaluator-fix、merger、reporter，不受生产代码当前集合影响
  等待预算: 0s
  留证: Vitest 精确集合断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "角色白名单严格等于冻结九项集合"'

- [ ] [BEHAVIOR] [L2] B-04: 阅读者正确构造 payload
  动作: 按 payload 章节识别必填与可省略字段
  预期观察: sprint_dir、base_repo、branch 标为必填，base_sha 明确可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 字段语义断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "payload 字段语义完整"'

- [ ] [BEHAVIOR] [L2] B-05: 阅读者识别派发失败后的三个终态
  动作: 阅读派发失败自动回滚章节
  预期观察: 文档明确 run → failed、session → closed、task → cancelled
  等待预算: 0s
  留证: Vitest 回滚语义断言输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "派发失败回滚三项终态"'

- [ ] [BEHAVIOR] [L2] B-06: 候选变更严格限制为一页文档
  动作: 对冻结实现基线与候选 HEAD 执行 canonical git diff
  预期观察: 排除本 Sprint 合同产物后仅新增 docs/current/attempt-run-bridge-guide.md，任何代码变更均失败
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'ACTUAL=$(git diff --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3 HEAD -- . ":(exclude)sprints/coding-harness-20260902104452-b4swl3/**"); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ] && git diff --diff-filter=A --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3 HEAD -- docs/current/attempt-run-bridge-guide.md | grep -qx docs/current/attempt-run-bridge-guide.md'

## Invariant 映射

- [ ] [BEHAVIOR] [L2] INV-1: 端点鉴权铁律在说明中未被破坏
  动作: 核对两个端点与 internalAuthOrLoopback、Authorization Bearer 要求
  预期观察: 两端点均没有被描述为匿名可访问
  等待预算: 0s
  留证: 鉴权测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权说明覆盖两个端点且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] INV-2: 凭据安全铁律未被破坏
  动作: 扫描目标文档中的 Bearer 示例
  预期观察: 只出现 CECELIA_INTERNAL_TOKEN 占位符，不出现字面真实 token
  等待预算: 0s
  留证: 凭据安全测试输出
  Test: manual:bash -c 'npx vitest run sprints/coding-harness-20260902104452-b4swl3/tests/attempt-run-bridge-guide.test.ts -t "鉴权说明覆盖两个端点且不泄露凭据"'

- [ ] [BEHAVIOR] [L2] INV-3: Planner 分支铁律不受影响
  动作: 检查冻结基线后的变更路径
  预期观察: 排除 Sprint 合同产物后仅有 docs/current 文档，不含 Planner 或 Brain 实现
  等待预算: 0s
  留证: git diff 文件列表
  Test: manual:bash -c 'ACTUAL=$(git diff --name-only 48f6fae42a05d9ecb3e32cd5354b2ba94bf591a3 HEAD -- . ":(exclude)sprints/coding-harness-20260902104452-b4swl3/**"); [ "$ACTUAL" = "docs/current/attempt-run-bridge-guide.md" ]'

