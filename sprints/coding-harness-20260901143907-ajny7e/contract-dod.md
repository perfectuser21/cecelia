---
skeleton: false
journey_type: dev_pipeline
---
# Contract DoD — Sprint: attempt-run 桥接使用说明

**范围**: 仅新增 `docs/current/attempt-run-bridge-guide.md` 中文说明页。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] 目标说明页是相对权威基线在 `docs/current/` 的唯一新增文件
  Test: bash -c "git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- docs/current/ | grep -qx 'docs/current/attempt-run-bridge-guide.md'"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: 文档说明 POST 发起与 GET 查询用途
  动作: 从仓库根读取 attempt-run 桥接使用说明并执行冻结内容测试
  预期观察: 中文标题存在，POST 被说明为发起/派发，GET 被说明为查询/轮询
  等待预算: 0s
  留证: Vitest 的目标用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "文档为中文且分别说明 POST 发起与 GET 查询用途"'

- [ ] [BEHAVIOR] [L2] B-02: 鉴权说明区分 loopback 与宿主远端
  动作: 执行鉴权章节冻结内容测试
  预期观察: 文档包含 internalAuthOrLoopback 与 Bearer CECELIA_INTERNAL_TOKEN，且未出现真实令牌值
  等待预算: 0s
  留证: Vitest 的目标用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌"'

- [ ] [BEHAVIOR] [L2] B-03: 角色白名单精确包含九项
  动作: 执行角色清单冻结内容测试
  预期观察: 九个基线角色逐项出现，计数为九，并明确白名单外不支持
  等待预算: 0s
  留证: Vitest 的目标用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "角色白名单完整列出九项且明确白名单外不支持"'

- [ ] [BEHAVIOR] [L2] B-04: payload 必填与可省略字段边界正确
  动作: 执行 payload 章节冻结内容测试
  预期观察: sprint_dir/base_repo/branch 均标为必填，base_sha 标为可省略并由生产 Brain 自解析
  等待预算: 0s
  留证: Vitest 的目标用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "payload 节声明三个必填字段及 base_sha 生产自解析"'

- [ ] [BEHAVIOR] [L2] B-05: 派发失败回滚链完整
  动作: 执行派发失败章节冻结内容测试
  预期观察: 文档精确包含 run→failed/session→closed/task→cancelled
  等待预算: 0s
  留证: Vitest 的目标用例输出与 exit code
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "派发失败节完整说明 run session task 的回滚终态和顺序"'

## Invariant 映射

- [ ] [BEHAVIOR] INV-1 权威实现基线保持 `5d25dcd6addb8ba30c742281b682589a3b95eaab`，不以 workspace checkout 之外的值替换。
  Test: manual:bash -c 'grep -Fq "authoritative implementation baseline: `perfectuser21/cecelia@5d25dcd6addb8ba30c742281b682589a3b95eaab`" sprints/coding-harness-20260901143907-ajny7e/contract-draft.md'
- [ ] [BEHAVIOR] INV-2 不修改代码路径。
  Test: manual:bash -c 'if git diff --name-only 5d25dcd6addb8ba30c742281b682589a3b95eaab...HEAD -- packages apps scripts | grep -q .; then exit 1; fi'
- [ ] [BEHAVIOR] INV-3 不写入真实内部令牌。
  Test: manual:bash -c 'npx vitest run --no-cache sprints/coding-harness-20260901143907-ajny7e/tests/attempt-run-bridge-guide.test.ts -t "鉴权节区分 loopback 与宿主远端 Bearer 要求且不泄露令牌"'

其余 PRD 注入的 area 历史铁律与本次纯文档唯一产品文件无交集，均显式 N/A；不得据此扩大 Sprint 范围。
